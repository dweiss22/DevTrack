# Active Wrike API inventory

This document lists the Wrike APIs that the current DevTrack application can call through its enabled OAuth, connection-health, and combined folder task/timelog import workflows. It is intended as a code-review map: each call includes its purpose, trigger, parameters, consumed response data, and implementation source.

## Integration boundaries

- Wrike REST requests use API v4 and the account-specific base URL returned by the OAuth token exchange: `https://<host>/api/v4`.
- DevTrack requests comma-delimited `wsReadOnly,amReadOnlyUser`. The additional `amReadOnlyUser` scope is required for the selected-user endpoint; existing connections must reconnect to grant it.
- REST requests send the access token in the `Authorization: Bearer <token>` header.
- OAuth credentials, access tokens, and refresh tokens remain server-side. Stored tokens are encrypted with AES-256-GCM before they are written to Supabase.
- The official references are the [Wrike API overview](https://developers.wrike.com/overview/) and [OAuth 2.0 authorization guide](https://developers.wrike.com/docs/oauth-20-authorization).

The source of truth for environment-specific base URLs is [`lib/env.ts`](../lib/env.ts). OAuth/session handling is in [`lib/wrike/oauth.ts`](../lib/wrike/oauth.ts), shared REST behavior is in [`lib/wrike/client.ts`](../lib/wrike/client.ts), and the focused import is in [`lib/wrike/folder-task-import.ts`](../lib/wrike/folder-task-import.ts).

## Active external API calls

| Method and endpoint | When DevTrack calls it | Purpose and response data used | Implementation | Official reference |
| --- | --- | --- | --- | --- |
| `GET {WRIKE_OAUTH_BASE_URL}/oauth2/authorize/v4` | An administrator selects **Connect Wrike**. | Starts the authorization-code flow with `scope=wsReadOnly,amReadOnlyUser` and signed state containing the application user and organization IDs. | [`app/api/wrike/connect/route.ts`](../app/api/wrike/connect/route.ts) | [OAuth authorization](https://developers.wrike.com/docs/oauth-20-authorization) |
| `POST {WRIKE_OAUTH_BASE_URL}/oauth2/token` | Wrike redirects to the DevTrack OAuth callback with an authorization code. | Exchanges the code for `access_token`, `refresh_token`, `expires_in`, and `host`. The returned host determines the account-specific API v4 base URL. | [`lib/wrike/oauth.ts`](../lib/wrike/oauth.ts), called by [`app/api/wrike/callback/route.ts`](../app/api/wrike/callback/route.ts) | [OAuth token exchange](https://developers.wrike.com/docs/oauth-20-authorization) |
| `POST https://<account-host>/oauth2/token` | A connected session is requested when its stored token has an expiry at or within 60 seconds of the current time. | Refreshes with the scopes recorded for that connection. Legacy connections retain `wsReadOnly`; newly reconnected sessions use `wsReadOnly,amReadOnlyUser`. | [`lib/wrike/oauth.ts`](../lib/wrike/oauth.ts) | [OAuth token refresh](https://developers.wrike.com/docs/oauth-20-authorization) |
| `GET /account` | Immediately after the OAuth code exchange and whenever an administrator runs the health check. | Reads the connected Wrike account `id` and `name`. The callback stores them; the health route returns them with host, expiry, latency, and local import status. | [`app/api/wrike/callback/route.ts`](../app/api/wrike/callback/route.ts), [`app/api/wrike/health/route.ts`](../app/api/wrike/health/route.ts) | [Wrike API overview](https://developers.wrike.com/overview/) |
| `GET /workflows` | Every combined import, before folder metadata and fact data. | Selects workflow `IEACHQK7K4BHMLHM` (expected name **Online Learning**) from the account response and stores its custom-status IDs, names, groups, standard/hidden flags, and colors. Other workflows are ignored. | [`lib/wrike/reference-data.ts`](../lib/wrike/reference-data.ts), configuration in [`lib/wrike/selected-workflow.ts`](../lib/wrike/selected-workflow.ts) | [Workflows API](https://developers.wrike.com/reference/getworkflowsempty) |
| `GET /users/{userId}` | Once for each of the 13 configured users during every combined import, with concurrency four. | Stores authoritative name, primary/account email, title, avatar, timezone, locale, profiles, active/deleted state, raw JSON, and sync time. A name difference is a non-fatal warning. | [`lib/wrike/reference-data.ts`](../lib/wrike/reference-data.ts), configuration in [`lib/wrike/selected-users.ts`](../lib/wrike/selected-users.ts) | [Get user](https://developers.wrike.com/reference/getuserssingle) |
| `GET /timelog_categories` | Every combined import after users. | Stores category ID, name, hidden state, order, raw JSON, and sync time. Wrike currently documents no pagination parameters; DevTrack follows a returned `nextPageToken` defensively. | [`lib/wrike/reference-data.ts`](../lib/wrike/reference-data.ts) | [Timelog categories](https://developers.wrike.com/reference/gettimelog_categoriesempty) |
| `GET /folders/IEACHQK7I46YBWEN/folders` | Every combined import, before reporting data is changed. | Loads the Learning folder tree. DevTrack validates the `folderTree` response and consumes folder/project `id`, `title`, `childIds`, `scope`, and project metadata to resolve task locations and descendant folders. | [`lib/wrike/folder-task-import.ts`](../lib/wrike/folder-task-import.ts), path builder in [`lib/wrike/endpoints.ts`](../lib/wrike/endpoints.ts) | [Folders API](https://developers.wrike.com/reference/getfoldersempty) |
| `GET /customfields?title=%5BLCT%5D` | Every combined import. | Searches account custom fields for titles matching `[LCT]`; consumes field IDs, titles, types, settings, and response evidence. | [`lib/wrike/folder-task-import.ts`](../lib/wrike/folder-task-import.ts), query builder in [`lib/wrike/metadata.ts`](../lib/wrike/metadata.ts) | [Custom Fields API](https://developers.wrike.com/reference/getcustomfieldsempty) |
| `GET /customfields?title=LCT` | Every combined import. | Runs the second LCT title search and merges definitions by Wrike field ID. | [`lib/wrike/folder-task-import.ts`](../lib/wrike/folder-task-import.ts), query builder in [`lib/wrike/metadata.ts`](../lib/wrike/metadata.ts) | [Custom Fields API](https://developers.wrike.com/reference/getcustomfieldsempty) |
| `GET /customfields` | Only when the two title searches do not return required field `IEACHQK7JUAHNWFH`. | Loads account custom fields as a fallback, then applies the local rule: exact `lct`, prefix `lct `, or prefix `[lct]`. | [`lib/wrike/folder-task-import.ts`](../lib/wrike/folder-task-import.ts) | [Custom Fields API](https://developers.wrike.com/reference/getcustomfieldsempty) |
| `GET /folders/{folderId}/tasks` | Once for each of the 13 configured folders during every combined import. Pagination can produce additional requests. | Loads descendant tasks and subtasks, including readable custom fields and responsible users. DevTrack deduplicates by task ID while retaining all selected source folders. | [`lib/wrike/folder-task-import.ts`](../lib/wrike/folder-task-import.ts), pagination in [`lib/wrike/client.ts`](../lib/wrike/client.ts) | [Tasks API](https://developers.wrike.com/reference/gettasksempty) |
| `GET /folders/{folderId}/timelogs?plainText=true` | Once for each configured folder; additional descendant-folder requests use `descendants=false` when the persisted strategy is `explicit_tree`. | Loads time-entry ID, task/user IDs, tracked date, hours, category, comment, and timestamps. DevTrack deduplicates by timelog ID and retains every selected source association. | [`lib/wrike/folder-task-import.ts`](../lib/wrike/folder-task-import.ts), pagination in [`lib/wrike/client.ts`](../lib/wrike/client.ts) | [Timelogs API](https://developers.wrike.com/reference/gettimelogsempty) |

All REST paths beginning with `/` in the table are appended to the validated account-specific base URL rather than assumed to use `www.wrike.com`.

## Folder-Based Task and Timelog Sync

Each configured folder uses this logical request:

```text
GET /folders/{folderId}/tasks
  ?descendants=true
  &plainTextCustomFields=true
  &subTasks=true
  &fields=["description","responsibleIds","parentIds","superTaskIds","subTaskIds","customFields","authorIds","effortAllocation"]
  &pageSize=100
  [&nextPageToken={token from previous response}]
```

In plain language, `descendants=true` includes work nested below the selected folder, `plainTextCustomFields=true` asks Wrike for readable custom-field text, and the `fields` JSON explicitly requests custom fields, responsible users, and DevTrack's other reporting fields. Before any network call, DevTrack verifies the selected ID is the only folder ID in the path and that all these options are present. Tasks are not required to have non-empty custom-field values.

Each folder also starts with:

```text
GET /folders/{folderId}/timelogs?plainText=true&pageSize=100
  [&nextPageToken={token from previous response}]
```

`URLSearchParams` URL-encodes the actual queries. The shared client adds `pageSize=100` and each `nextPageToken` without dropping the original options. Task and timelog work is limited to four concurrent requests.

The active folder allowlist, in request order, is:

| # | Folder title | Wrike folder ID |
| ---: | --- | --- |
| 1 | Cordico [New] | `IEACHQK7I4UOEPFL` |
| 2 | Custody [Maint] | `IEACHQK7I4PGHAIF` |
| 3 | Custody [New] | `IEACHQK7I4QUZOFS` |
| 4 | Dispatch [New] | `IEACHQK7I45QZU3G` |
| 5 | EMS [Maint] | `IEACHQK7I4PGHAD7` |
| 6 | EMS [New] | `IEACHQK7I4SCO46Z` |
| 7 | Fire [Maint] | `IEACHQK7I4PGHBAC` |
| 8 | Fire [New] | `IEACHQK7I4N7GGRM` |
| 9 | Law Enforcement [Maint] | `IEACHQK7I4PGHACI` |
| 10 | Law Enforcement [New] | `IEACHQK7I4N7GGQ4` |
| 11 | Local Gov [Maint] | `IEACHQK7I4PGG7Z2` |
| 12 | Local Gov [New] | `IEACHQK7I4SCPAAB` |
| 13 | Non-Vertical Content Projects [Maint] | `IEACHQK7I4N7GGRB` |

The single source of truth is [`lib/wrike/selected-folders.ts`](../lib/wrike/selected-folders.ts). Both import types, Administration, tests, and this inventory use those ID/title pairs. Normalized `wrike_folders` rows reuse these titles.

The first connected run records whether real top-folder responses prove that Wrike included descendant-task timelogs. Proven coverage persists as `folder_recursive`. Missing or inconclusive evidence persists the conservative `explicit_tree` strategy, which requests relevant descendant folders with `descendants=false` and deduplicates their entries. The live result is **pending** until a connected deployment completes this probe; this repository has no production credentials or response data from which to claim an observed outcome.

All selected-folder task and timelog requests must succeed before reconciliation starts. Tasks and timelogs are upserted by organization plus Wrike ID, shared records retain many-to-many source folders, stale task-source links are removed only after successful retrieval, and historical timelogs are not deleted merely because a later response omits them. The route remains named `import-folder-tasks` for compatibility.

## Wrike User and Timelog Category Reference Data

The task request field list has one source of truth in [`lib/wrike/task-fields.ts`](../lib/wrike/task-fields.ts). Active and disabled/legacy task builders retain `responsibleIds` alongside every other required field. The readable form is:

```text
fields=["description","responsibleIds","parentIds","superTaskIds","subTaskIds","customFields","authorIds","effortAllocation"]
```

The encoded query value is:

```text
fields=%5B%22description%22%2C%22responsibleIds%22%2C%22parentIds%22%2C%22superTaskIds%22%2C%22subTaskIds%22%2C%22customFields%22%2C%22authorIds%22%2C%22effortAllocation%22%5D
```

| Wrike user ID | Expected fallback name |
| --- | --- |
| `KUALR6DZ` | Devin Weiss |
| `KUANTWID` | Koco Budo |
| `KUAPO5G4` | Greg Rogers |
| `KUAOGSL5` | Natalie Nelson |
| `KUATPQK3` | Melissa Maurath |
| `KUAFESPT` | Jon Dorman |
| `KUAOG6C6` | Katie Willis |
| `KUAMLCDM` | Rachel Frost |
| `KUAE45X3` | Meena Kishnani |
| `KUAKTTA2` | Emlyn Storrs |
| `KUAQCO2V` | Mallory Lozoya |
| `KUAQCQMG` | Jeff Dino |
| `KUAG3N3I` | Lawson Coke |

`GET /users/{userId}` requires `amReadOnlyUser`, so connections authorized only with `wsReadOnly` must reconnect. Wrike's returned name is authoritative. If it differs from the configured expected name, DevTrack retains Wrike's value and records both values as a warning. A configured fallback row is created only when no row exists and never overwrites previously synchronized data.

User display resolution is synchronized Wrike name → configured expected name → raw user ID. Category display resolution is synchronized category name → raw category ID. Ordered task `responsibleIds`, timelog `user_wrike_id`, and raw category IDs remain stored even when no readable row exists. Locally resolved task users are also rebuilt in `wrike_task_assignees`.

Timelog category storage includes ID, name, hidden state, order, raw response JSON, and synchronization time. Pagination is not currently documented by Wrike and has not been observed in this repository; the client follows a response token defensively without claiming that request pagination is supported. Reference failures remain warnings, and diagnostics record counts, failed IDs, mismatches, resolution results, and timing.

## Workflow and Task Status Reference

The focused importer calls `GET https://<account-host>/api/v4/workflows` (the relative application path is `GET /workflows`) to retrieve the account-wide workflow list and its custom statuses. It selects by ID only: workflow `IEACHQK7K4BHMLHM`, expected to be named **Online Learning**. Other workflows are ignored for application processing. Wrike does not provide a supported single-workflow `GET /workflows/{workflowId}` call, so DevTrack selects the required workflow locally.

The selected workflow is upserted by organization plus Wrike workflow ID in `wrike_workflows`. Its custom statuses are upserted by organization plus Wrike custom-status ID in `wrike_workflow_statuses`. Both tables preserve the selected raw Wrike JSON and synchronization time.

Tasks retain authoritative `custom_status_id` values. Display resolution is synchronized custom-status name → raw custom-status ID → base Wrike task status when no custom status is present. Readable status names are used by task lists/details, Ask DevTrack, time-entry rows, filters, dashboard summaries, and team summaries without changing raw filtering keys.

For example, a task can retain `custom_status_id=IEACHQK7JMBHMLHM` while the interface displays the matching synchronized name such as `In Review`. Internal reporting data can carry both values; the ID remains the lookup and audit key.

If the selected workflow is absent, malformed, or temporarily unavailable, a clear warning with the selected ID remains visible in diagnostics and structured server logs, and task synchronization continues with raw-ID fallbacks. The known limitation is that only the Online Learning workflow is processed; statuses belonging only to other workflows intentionally remain unresolved.

## Custom Field Name Normalization

Many Learning Content Team custom fields contain legacy Wrike labels that are not meaningful in DevTrack. After Wrike field IDs have been matched to their original definitions, DevTrack removes a leading `[LCT]` marker and a trailing `(M)` or `(L)` marker before displaying the field. Matching is case-insensitive, repeated spaces are collapsed, and the remaining capitalization is preserved.

For example, both of these source fields become one logical **Authoring Tool** field:

```text
[LCT] Authoring Tool (M) → Authoring Tool
[LCT] Authoring Tool (L) → Authoring Tool
```

The same rule applies to every matching title. A small reviewed alias list also shortens `Authoring Tool Used`, `Course Development Type`, and `Primary Product Area` to **Authoring Tool**, **Course Type**, and **Product Area** respectively. The aliases are centralized rather than inferred dynamically.

Normalization does not replace Wrike's identifiers. DevTrack continues storing each original Wrike field ID, title, raw value, resolved display value, source designation, task relationship, and synchronization time. A separate logical-field layer maps those authoritative sources to a normalized title.

When only one source contains a value, that value is used. Matching values and equivalent multi-value sets are shown once. If populated sources disagree, all values, field IDs, and original titles are retained, the logical task value is marked as conflicted, and the import records a warning without failing synchronization.

Reports and filters expose one normalized field name. Filter choices come from distinct values actually present on tasks visible to the signed-in user; definition options that have never appeared on synchronized task data are not offered. Selecting a value matches any mapped source field, including either `(M)` or `(L)` and every preserved value in a conflict. General report search also checks normalized field names and values.

The external synchronization process is unchanged: field definitions still come from the existing `GET /customfields?title=%5BLCT%5D`, `GET /customfields?title=LCT`, and conditional unfiltered fallback calls. Normalization occurs only after the returned Wrike ID has been resolved to its original title.

## Active DevTrack entry points

These are DevTrack's own server routes, not Wrike API v4 endpoints.

| DevTrack route | Access and trigger | External Wrike calls |
| --- | --- | --- |
| `GET /api/wrike/connect` | Administrator selects **Connect Wrike**. | Redirects to `GET /oauth2/authorize/v4`. |
| `GET /api/wrike/callback` | Wrike redirects back after consent. | `POST /oauth2/token`, then `GET /account`. |
| `GET /api/wrike/health` | Administrator selects **Run health check**. | Conditional token refresh, then `GET /account`. |
| `POST /api/wrike/import-folder-tasks` | Administrator selects **Import folder tasks and timelogs**. | Conditional token refresh, workflows, 13 users, timelog categories, metadata calls, all paginated task and timelog requests, and conditional explicit descendant timelog requests. |
| `POST /api/wrike/disconnect` | Administrator selects **Disconnect**. | No external Wrike request. It marks the local connection disconnected and replaces stored encrypted credentials with `revoked`. |

The connect, health, import, and disconnect routes enforce the DevTrack administrator role. The callback validates signed OAuth state and confirms the returning authenticated Supabase user matches the administrator who started the connection.

## Shared request and credential behavior

- **Host validation:** the host returned by Wrike is normalized and accepted only when it is `wrike.com` or a `wrike.com` subdomain. REST calls use `https://<validated-host>/api/v4`.
- **Request headers:** the shared client sends `Authorization: Bearer <access token>` and `Accept: application/json`.
- **Caching:** Wrike OAuth and REST `fetch` calls use `cache: "no-store"`.
- **Retries:** `429` and `5xx` responses receive up to three retries after the initial attempt. The client honors `Retry-After` seconds or HTTP dates, otherwise it waits 250 ms, 500 ms, and 1,000 ms.
- **Unauthorized refresh:** concurrent `401` responses share one refresh operation; each request retries with the replacement access token at most once.
- **Errors:** non-retryable or exhausted requests throw a status-bearing `WrikeApiError`; Wrike's error description is truncated before inclusion.
- **Pagination:** `WrikeClient.all()` requests 100 records per page, preserves the original query parameters, supplies each returned `nextPageToken`, and combines all `data` arrays.
- **Diagnostics and logging:** run records store request/record/duplicate/failure counts, verified task-contract details, safe descendant evidence counts, strategy, and timing. Structured logs redact credential-shaped fields and never include response bodies or tokens.
- **Credential storage:** access and refresh tokens are encrypted with AES-256-GCM in [`lib/security.ts`](../lib/security.ts). The client ID, client secret, token encryption key, and tokens are never returned to browser code.
- **OAuth state:** connection state is HMAC-signed, contains the initiating user and organization IDs, and expires after 10 minutes.

## Deliberately excluded APIs

[`lib/wrike/sync.ts`](../lib/wrike/sync.ts) contains a broader synchronization implementation for contacts, spaces, account folders, workflows, custom fields, timelog categories, tasks, and timelogs. That broad implementation remains excluded because its multi-API sync, scope discovery, preview, account-wide import, and space-import routes return HTTP `410 Gone`. The narrowly selected workflow, users, and categories described above are active only through [`lib/wrike/reference-data.ts`](../lib/wrike/reference-data.ts) as part of the combined folder importer.

When one of those workflows is re-enabled, update this inventory in the same change that makes its route callable.
