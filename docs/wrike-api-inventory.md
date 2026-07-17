# Active Wrike API inventory

This document lists the Wrike APIs that the current DevTrack application can call through its enabled OAuth, connection-health, and focused folder-task import workflows. It is intended as a code-review map: each call includes its purpose, trigger, parameters, consumed response data, and implementation source.

## Integration boundaries

- Wrike REST requests use API v4 and the account-specific base URL returned by the OAuth token exchange: `https://<host>/api/v4`.
- DevTrack requests the read-only `wsReadOnly` OAuth scope.
- REST requests send the access token in the `Authorization: Bearer <token>` header.
- OAuth credentials, access tokens, and refresh tokens remain server-side. Stored tokens are encrypted with AES-256-GCM before they are written to Supabase.
- The official references are the [Wrike API overview](https://developers.wrike.com/overview/) and [OAuth 2.0 authorization guide](https://developers.wrike.com/docs/oauth-20-authorization).

The source of truth for environment-specific base URLs is [`lib/env.ts`](../lib/env.ts). OAuth/session handling is in [`lib/wrike/oauth.ts`](../lib/wrike/oauth.ts), shared REST behavior is in [`lib/wrike/client.ts`](../lib/wrike/client.ts), and the focused import is in [`lib/wrike/folder-task-import.ts`](../lib/wrike/folder-task-import.ts).

## Active external API calls

| Method and endpoint | When DevTrack calls it | Purpose and response data used | Implementation | Official reference |
| --- | --- | --- | --- | --- |
| `GET {WRIKE_OAUTH_BASE_URL}/oauth2/authorize/v4` | An administrator selects **Connect Wrike**. | Starts the authorization-code flow. DevTrack sends `client_id`, `response_type=code`, the callback URL, `scope=wsReadOnly`, and signed state containing the application user and organization IDs. | [`app/api/wrike/connect/route.ts`](../app/api/wrike/connect/route.ts) | [OAuth authorization](https://developers.wrike.com/docs/oauth-20-authorization) |
| `POST {WRIKE_OAUTH_BASE_URL}/oauth2/token` | Wrike redirects to the DevTrack OAuth callback with an authorization code. | Exchanges the code for `access_token`, `refresh_token`, `expires_in`, and `host`. The returned host determines the account-specific API v4 base URL. | [`lib/wrike/oauth.ts`](../lib/wrike/oauth.ts), called by [`app/api/wrike/callback/route.ts`](../app/api/wrike/callback/route.ts) | [OAuth token exchange](https://developers.wrike.com/docs/oauth-20-authorization) |
| `POST https://<account-host>/oauth2/token` | A connected session is requested when its stored token has an expiry at or within 60 seconds of the current time. | Refreshes the access/refresh token pair with `grant_type=refresh_token`, the stored refresh token, and `scope=wsReadOnly`. DevTrack stores the replacement tokens, expiry, and any refreshed host. | [`lib/wrike/oauth.ts`](../lib/wrike/oauth.ts) | [OAuth token refresh](https://developers.wrike.com/docs/oauth-20-authorization) |
| `GET /account` | Immediately after the OAuth code exchange and whenever an administrator runs the health check. | Reads the connected Wrike account `id` and `name`. The callback stores them; the health route returns them with host, expiry, latency, and local import status. | [`app/api/wrike/callback/route.ts`](../app/api/wrike/callback/route.ts), [`app/api/wrike/health/route.ts`](../app/api/wrike/health/route.ts) | [Wrike API overview](https://developers.wrike.com/overview/) |
| `GET /folders/IEACHQK7I46YBWEN/folders` | Every focused folder-task import, before existing reporting data is reset. | Loads the Learning folder tree. DevTrack validates the `folderTree` response and consumes folder/project `id`, `title`, `childIds`, `scope`, and project metadata to resolve task locations. | [`lib/wrike/folder-task-import.ts`](../lib/wrike/folder-task-import.ts), path builder in [`lib/wrike/endpoints.ts`](../lib/wrike/endpoints.ts) | [Folders API](https://developers.wrike.com/reference/getfoldersempty) |
| `GET /customfields?title=%5BLCT%5D` | Every focused folder-task import. | Searches account custom fields for titles matching `[LCT]`; consumes field IDs, titles, types, settings, and response evidence. | [`lib/wrike/folder-task-import.ts`](../lib/wrike/folder-task-import.ts), query builder in [`lib/wrike/metadata.ts`](../lib/wrike/metadata.ts) | [Custom Fields API](https://developers.wrike.com/reference/getcustomfieldsempty) |
| `GET /customfields?title=LCT` | Every focused folder-task import. | Runs the second LCT title search and merges definitions by Wrike field ID. | [`lib/wrike/folder-task-import.ts`](../lib/wrike/folder-task-import.ts), query builder in [`lib/wrike/metadata.ts`](../lib/wrike/metadata.ts) | [Custom Fields API](https://developers.wrike.com/reference/getcustomfieldsempty) |
| `GET /customfields` | Only when the two title searches do not return required field `IEACHQK7JUAHNWFH`. | Loads account custom fields as a fallback, then applies the local rule: exact `lct`, prefix `lct `, or prefix `[lct]`. | [`lib/wrike/folder-task-import.ts`](../lib/wrike/folder-task-import.ts) | [Custom Fields API](https://developers.wrike.com/reference/getcustomfieldsempty) |
| `GET /folders/{folderId}/tasks` | Once for each of the 13 configured folders during every focused import. Pagination can produce additional requests for a folder. | Loads descendant tasks and subtasks. DevTrack deduplicates tasks by ID and stores task details, effort, hierarchy, folder locations, and LCT values. | [`lib/wrike/folder-task-import.ts`](../lib/wrike/folder-task-import.ts), pagination in [`lib/wrike/client.ts`](../lib/wrike/client.ts) | [Tasks API](https://developers.wrike.com/reference/gettasksempty) |

All REST paths beginning with `/` in the table are appended to the validated account-specific base URL rather than assumed to use `www.wrike.com`.

## Folder-task request configuration

Each configured folder uses this logical request:

```text
GET /folders/{folderId}/tasks
  ?descendants=true
  &subTasks=true
  &fields=["description","responsibleIds","parentIds","superTaskIds","subTaskIds","customFields","authorIds","effortAllocation"]
  &pageSize=100
  [&nextPageToken={token from previous response}]
```

`URLSearchParams` URL-encodes the actual query. `pageSize=100` is added by `WrikeClient.all()`, and `nextPageToken` is added until Wrike returns no further token. The optional `fields` value is retained on every page.

The active folder allowlist, in request order, is:

| # | Wrike folder ID |
| ---: | --- |
| 1 | `IEACHQK7I4UOEPFL` |
| 2 | `IEACHQK7I4PGHAIF` |
| 3 | `IEACHQK7I4QUZOFS` |
| 4 | `IEACHQK7I45QZU3G` |
| 5 | `IEACHQK7I4PGHAD7` |
| 6 | `IEACHQK7I4SCO46Z` |
| 7 | `IEACHQK7I4PGHBAC` |
| 8 | `IEACHQK7I4N7GGRM` |
| 9 | `IEACHQK7I4PGHACI` |
| 10 | `IEACHQK7I4N7GGQ4` |
| 11 | `IEACHQK7I4PGG7Z2` |
| 12 | `IEACHQK7I4SCPAAB` |
| 13 | `IEACHQK7I4N7GGRB` |

These IDs are defined by `TASK_IMPORT_FOLDER_IDS` in [`lib/wrike/folder-task-import.ts`](../lib/wrike/folder-task-import.ts). Their readable titles come from the folder-tree response and are stored in `wrike_folders`; they are not duplicated as static configuration.

## Active DevTrack entry points

These are DevTrack's own server routes, not Wrike API v4 endpoints.

| DevTrack route | Access and trigger | External Wrike calls |
| --- | --- | --- |
| `GET /api/wrike/connect` | Administrator selects **Connect Wrike**. | Redirects to `GET /oauth2/authorize/v4`. |
| `GET /api/wrike/callback` | Wrike redirects back after consent. | `POST /oauth2/token`, then `GET /account`. |
| `GET /api/wrike/health` | Administrator selects **Run health check**. | Conditional token refresh, then `GET /account`. |
| `POST /api/wrike/import-folder-tasks` | Administrator selects **Reset and import folder tasks**. | Conditional token refresh, folder-tree request, two custom-field searches, optional custom-field fallback, and all paginated folder-task requests. |
| `POST /api/wrike/disconnect` | Administrator selects **Disconnect**. | No external Wrike request. It marks the local connection disconnected and replaces stored encrypted credentials with `revoked`. |

The connect, health, import, and disconnect routes enforce the DevTrack administrator role. The callback validates signed OAuth state and confirms the returning authenticated Supabase user matches the administrator who started the connection.

## Shared request and credential behavior

- **Host validation:** the host returned by Wrike is normalized and accepted only when it is `wrike.com` or a `wrike.com` subdomain. REST calls use `https://<validated-host>/api/v4`.
- **Request headers:** the shared client sends `Authorization: Bearer <access token>` and `Accept: application/json`.
- **Caching:** Wrike OAuth and REST `fetch` calls use `cache: "no-store"`.
- **Retries:** `429` and `5xx` responses receive up to three retries after the initial attempt. The client honors `Retry-After` seconds or HTTP dates, otherwise it waits 250 ms, 500 ms, and 1,000 ms.
- **Errors:** non-retryable or exhausted requests throw a status-bearing `WrikeApiError`; Wrike's error description is truncated before inclusion.
- **Pagination:** `WrikeClient.all()` requests 100 records per page, preserves the original query parameters, supplies each returned `nextPageToken`, and combines all `data` arrays.
- **Credential storage:** access and refresh tokens are encrypted with AES-256-GCM in [`lib/security.ts`](../lib/security.ts). The client ID, client secret, token encryption key, and tokens are never returned to browser code.
- **OAuth state:** connection state is HMAC-signed, contains the initiating user and organization IDs, and expires after 10 minutes.

## Deliberately excluded APIs

[`lib/wrike/sync.ts`](../lib/wrike/sync.ts) contains a broader synchronization implementation for contacts, spaces, account folders, workflows, custom fields, timelog categories, tasks, and timelogs. It is not part of this active inventory because the application routes that formerly exposed multi-API sync, scope discovery, preview, account-wide import, and space import currently return HTTP `410 Gone` instead of invoking it.

Likewise, the named workflow and timelog paths in [`lib/wrike/endpoints.ts`](../lib/wrike/endpoints.ts) are definitions and test fixtures, not calls reachable through the current enabled workflow.

When one of those workflows is re-enabled, update this inventory in the same change that makes its route callable.
