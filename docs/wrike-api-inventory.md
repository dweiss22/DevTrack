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
| `GET /workflows` | Every combined import, before folder metadata and fact data. | Stores every account-wide workflow and custom status returned, including names, groups, standard/hidden flags, colors, order, and raw metadata. Workflow `IEACHQK7K4BHMLHM` remains the stable **Online Learning** dashboard scope. | [`lib/wrike/reference-data.ts`](../lib/wrike/reference-data.ts), configuration in [`lib/wrike/selected-workflow.ts`](../lib/wrike/selected-workflow.ts) | [Workflows API](https://developers.wrike.com/reference/getworkflowsempty) |
| `GET /spaces?withArchived=true` | Every combined import. | Stores available spaces and connects folder records to their resolved space ancestry. A returned `nextPageToken` is followed defensively. | [`lib/wrike/reference-data.ts`](../lib/wrike/reference-data.ts) | [Spaces API](https://developers.wrike.com/reference/getspacesempty) |
| `GET /users/{userId}` | For each distinct configured or encountered user that is missing, unresolved, or older than 24 hours, with concurrency four. | Stores authoritative identity metadata. Encountered IDs are deduplicated across tasks, project owners/authors, Contacts fields, and timelogs; the 13 configured names remain fallbacks rather than an API allowlist. | [`lib/wrike/reference-data.ts`](../lib/wrike/reference-data.ts), fallback configuration in [`lib/wrike/selected-users.ts`](../lib/wrike/selected-users.ts) | [Get user](https://developers.wrike.com/reference/getuserssingle) |
| `GET /timelog_categories` | Every combined import after users. | Stores category ID, name, hidden state, order, raw JSON, and sync time. Wrike currently documents no pagination parameters; DevTrack follows a returned `nextPageToken` defensively. | [`lib/wrike/reference-data.ts`](../lib/wrike/reference-data.ts) | [Timelog categories](https://developers.wrike.com/reference/gettimelog_categoriesempty) |
| `GET /folders/IEACHQK7I46YBWEN/folders` | Every combined import, before reporting data is changed. | Loads the Learning folder tree. DevTrack validates the `folderTree` response and consumes folder/project `id`, `title`, `childIds`, `scope`, and project metadata to resolve task locations and descendant folders. | [`lib/wrike/folder-task-import.ts`](../lib/wrike/folder-task-import.ts), path builder in [`lib/wrike/endpoints.ts`](../lib/wrike/endpoints.ts) | [Folders API](https://developers.wrike.com/reference/getfoldersempty) |
| `GET /customfields?title=%5BLCT%5D` | Every combined import. | Searches account custom fields for titles matching `[LCT]`; consumes field IDs, titles, types, settings, and response evidence. | [`lib/wrike/folder-task-import.ts`](../lib/wrike/folder-task-import.ts), query builder in [`lib/wrike/metadata.ts`](../lib/wrike/metadata.ts) | [Custom Fields API](https://developers.wrike.com/reference/getcustomfieldsempty) |
| `GET /customfields?title=LCT` | Every combined import. | Runs the second LCT title search and merges definitions by Wrike field ID. | [`lib/wrike/folder-task-import.ts`](../lib/wrike/folder-task-import.ts), query builder in [`lib/wrike/metadata.ts`](../lib/wrike/metadata.ts) | [Custom Fields API](https://developers.wrike.com/reference/getcustomfieldsempty) |
| `GET /customfields` | When the two title searches omit the required field or an imported task references any definition not already known locally. | Loads account definitions once for the run. Unknown IDs still retain placeholder definitions and raw values if this warning-only request fails. No per-field request is made. | [`lib/wrike/folder-task-import.ts`](../lib/wrike/folder-task-import.ts) | [Custom Fields API](https://developers.wrike.com/reference/getcustomfieldsempty) |
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
| `KUANTWID` | Koço Budo |
| `KUAPO5G4` | Greg Rogers |
| `KUAOGSL5` | Natalie Nelson |
| `KUATPQK3` | Melissa Maurath |
| `KUAFESPT` | Jon Dorman |
| `KUAOG6C6` | Katie Willis |
| `KUAMLCDM` | Rachel Frost |
| `KUAE45X3` | Meena Kishnani |
| `KUAKTTA2` | Emlyn Storrs |
| `KUAQCO2V` | Mallory Lozoya |
| `KUAQCQMG` | Jeffrey Dino |
| `KUAG3N3I` | Lawson Coke |

`GET /users/{userId}` requires `amReadOnlyUser`, so connections authorized only with `wsReadOnly` must reconnect. Wrike's returned name is authoritative. If it differs from the configured expected name, DevTrack retains Wrike's value and records both values as a warning. A configured fallback row is created only when no row exists and never overwrites previously synchronized data.

User display resolution is synchronized Wrike name → configured expected name → raw user ID. Category display resolution is synchronized category name → raw category ID. Ordered task `responsibleIds`, timelog `user_wrike_id`, and raw category IDs remain stored even when no readable row exists. Locally resolved task users are also rebuilt in `wrike_task_assignees`.

Timelog category storage includes ID, name, hidden state, order, raw response JSON, and synchronization time. Pagination is not currently documented by Wrike and has not been observed in this repository; the client follows a response token defensively without claiming that request pagination is supported. Reference failures remain warnings, and diagnostics record counts, failed IDs, mismatches, resolution results, and timing.

## Workflow and Task Status Reference

The focused importer calls `GET https://<account-host>/api/v4/workflows` (the relative application path is `GET /workflows`) to retrieve the account-wide workflow list and its custom statuses. Every returned workflow and status is stored. Workflow `IEACHQK7K4BHMLHM`, expected to be named **Online Learning**, is selected by stable ID only for dashboard membership and classification. Wrike does not provide a supported single-workflow `GET /workflows/{workflowId}` call.

Workflows are upserted by organization plus Wrike workflow ID in `wrike_workflows`. Custom statuses are upserted by organization plus Wrike custom-status ID in `wrike_workflow_statuses`, with a local foreign-key relationship back to the workflow. Both retain raw Wrike JSON and synchronization time.

Tasks retain authoritative `custom_status_id` values. Display resolution is synchronized custom-status name → raw custom-status ID → base Wrike task status when no custom status is present. Readable status names are used by task lists/details, Ask DevTrack, time-entry rows, filters, dashboard summaries, and team summaries without changing raw filtering keys.

For example, a task can retain `custom_status_id=IEACHQK7JMBHMLHM` while the interface displays the matching synchronized name such as `In Review`. Internal reporting data can carry both values; the ID remains the lookup and audit key.

If the Online Learning workflow is absent, malformed, or temporarily unavailable, a clear warning with the selected ID remains visible in diagnostics and structured server logs, and task synchronization continues with explicitly marked raw-ID fallbacks. Wrike documents `GET /workflows` as returning account-wide workflows; references not present in that response remain unresolved for later retry.

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

Field definitions still begin with `GET /customfields?title=%5BLCT%5D` and `GET /customfields?title=LCT`. The existing unfiltered fallback is also used once when imported tasks reveal an unknown field ID. Normalization occurs only after the returned Wrike ID has been resolved or an administrator mapping supplies a reviewed logical title.

## Wrike Reference Resolution and Unidentified Data

DevTrack resolves Wrike IDs during the combined server-side import and reuses the stored reference rows throughout the application. Pages, charts, filters, and table rows never call Wrike directly. The shared resolver returns the original ID, whether it is resolved, its typed value, a fallback label, the resolution source, and the last successful resolution time.

Resolution behavior by type is:

- Users use a synchronized Wrike identity, then a preserved historical name, then one of the 13 configured fallback names, and finally the raw user ID. Missing, unresolved, or more-than-24-hour-old encountered users are deduplicated and refreshed with concurrency four.
- Custom fields use an administrator mapping first, then the synchronized Wrike definition, then the raw field ID. Every task value remains stored even when its definition is unavailable.
- Custom statuses resolve through their synchronized status-to-workflow relationship. Names and colors come from Wrike; the raw custom-status ID remains the reporting and audit key.
- Folders, spaces, workflows, and timelog categories use their synchronized local reference row. Missing metadata retains the raw ID rather than inventing a title.

An unresolved ID is never presented as if it were a meaningful name. The interface displays it with a warning/help icon and an explanation available to mouse hover, keyboard focus, and screen readers. Dense custom-field columns put that explanation on the heading. Ask DevTrack describes an unresolved value as an unresolved Wrike reference rather than returning the bare ID as a name.

`wrike_unresolved_references` retains one organization-scoped record per reference type and Wrike ID, including safe sample values, related records, occurrences, attempts, timestamps, and the last error. Later API data marks the record resolved without deleting its history. Authentication failures, rate limits, and temporary server failures use the shared refresh/retry behavior; confirmed 403/404 responses are not repeatedly requested within the same import.

Administration provides a complete correction workflow for custom fields. An administrator can map an unknown field to an existing normalized field, create a new normalized field, or intentionally ignore it. `wrike_manual_mappings` remains separate from authoritative Wrike metadata and takes precedence during later imports. Saving or removing a mapping claims the organization import lease and rebuilds affected normalized task values from preserved local raw data; it does not call Wrike. Ignored values remain available in raw administrator metadata but are excluded from filters, search, grouping, and Ask DevTrack.

Online Learning dashboard membership uses workflow ID `IEACHQK7K4BHMLHM` from either the task or its synchronized custom-status relationship; status names are never used to infer membership. Status classifications are `active`, `completed`, `stalled_or_canceled`, or unclassified. Automatic initialization uses Wrike's synchronized status group only. A status such as Stalled or On Hold whose Wrike group remains Active must be explicitly classified by an administrator using its stable status ID; administrator choices persist across later workflow imports. Unclassified statuses remain visibly warned and are never inferred from their titles.

Migration `202607170004_wrike_reference_resolution.sql` and one post-deployment combined import are required to populate reference state, spaces, status classifications, unresolved queues, and dynamic users.

## Dashboard Analytics

The redesigned Dashboard adds no Wrike API calls. Server components call the RLS-aware `reporting_online_learning_dashboard_v2` database function, which aggregates already synchronized tasks, statuses, normalized custom-field values, and valid time entries. Membership is determined only by stable Online Learning workflow ID `IEACHQK7K4BHMLHM` on the task or its synchronized custom status.

Reporting years are derived only when the normalized **Reporting** values contain one unambiguous year in the supported `1900`–`2199` range; malformed or conflicting values remain **Unassigned**. Completed-project time is summed once per project before the yearly average is calculated. Course Type and Authoring Tool values are case/whitespace deduplicated and each project contributes one category; multiple tools become **Multiple Authoring Tools**. Vertical uses the controlled values `P1A`, `C1A`, `D1A`, `FR1A`, `EMS1`, `LGU`, `Lexipol`, and `Wellness`; `EMS1A` normalizes to `EMS1`. One associated value reports under that value, multiple approved values report once as **Cross Vertical**, and missing/unrecognized values are diagnosed as **Unresolved Vertical** and excluded from the primary pie. Source IDs, titles, raw values, and conflict diagnostics remain in the normalized-field persistence layer.

Migration `202607170005_dashboard_analytics.sql` creates the aggregation RPC, reporting-year helper, and supporting indexes. The `/projects` route is presentation-only: legacy `/tasks` routes redirect to it, while Wrike task IDs, API paths, database tables, and synchronization code retain their established names.

## Active DevTrack entry points

These are DevTrack's own server routes, not Wrike API v4 endpoints.

| DevTrack route | Access and trigger | External Wrike calls |
| --- | --- | --- |
| `GET /api/wrike/connect` | Administrator selects **Connect Wrike**. | Redirects to `GET /oauth2/authorize/v4`. |
| `GET /api/wrike/callback` | Wrike redirects back after consent. | `POST /oauth2/token`, then `GET /account`. |
| `GET /api/wrike/health` | Administrator selects **Run health check**. | Conditional token refresh, then `GET /account`. |
| `POST /api/wrike/import-folder-tasks` | Administrator selects **Import folder tasks and timelogs**. | Conditional token refresh, all account workflows, spaces, missing/stale encountered users, timelog categories, metadata calls, all paginated task and timelog requests, and conditional explicit descendant timelog requests. |
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

[`lib/wrike/sync.ts`](../lib/wrike/sync.ts) contains a broader synchronization implementation for contacts, spaces, account folders, workflows, custom fields, timelog categories, tasks, and timelogs. That implementation remains excluded because its multi-API sync, scope discovery, preview, account-wide import, and space-import routes return HTTP `410 Gone`. The active combined folder importer independently synchronizes account-wide workflow/status and space references, categories, encountered users, selected-folder tasks, and timelogs through [`lib/wrike/reference-data.ts`](../lib/wrike/reference-data.ts) and [`lib/wrike/folder-task-import.ts`](../lib/wrike/folder-task-import.ts).

When one of those workflows is re-enabled, update this inventory in the same change that makes its route callable.
