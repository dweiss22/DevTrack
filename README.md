# DevTrack

DevTrack is a secure reporting application for online-course development work managed in Wrike. It replaces manual exports with a configurable Wrike synchronization process and dashboards that show work, workload, time, and delivery trends.

## Architecture

- **Next.js / TypeScript** powers the responsive application and server-side API routes.
- **Supabase** provides authentication, PostgreSQL, Row Level Security (RLS), and the application data store.
- **Wrike OAuth 2.0 + REST API** supplies task, user, and time-entry data. All OAuth exchange, token refresh, and synchronization operations occur on the server.
- **Recharts** renders accessible dashboard charts.
- **Vercel Cron** is available for later synchronization stages; the multi-API task/time sync is intentionally disabled while this first task endpoint is validated.

The ingestion layer is deliberately separate from reporting tables, so a transitional spreadsheet/file importer or additional source can be added later without replacing the Wrike integration.

## Included workflow

1. An administrator signs in with an administrator-created Supabase email/password account and connects Wrike from **Administration**.
2. The OAuth callback securely exchanges the code and stores AES-256-GCM encrypted access and refresh tokens. OAuth state is signed and expires after 10 minutes.
3. The administrator selects **Import folder tasks and timelogs**. The importer refreshes account workflows, spaces, timelog categories, folder/custom-field metadata, and every missing, unresolved, or stale person encountered in the data, then validates task and timelog requests for the 13 configured Wrike folders.
4. DevTrack retrieves every selected-folder response before reconciliation, then upserts tasks and timelogs by Wrike ID, deduplicates shared records, and preserves every selected source-folder association. Reference-data failures are visible warnings because raw-ID fallbacks remain available.
5. Reports show readable assignees, custom statuses, timelog authors, categories, spaces, folder titles, and custom-field titles. Any unresolved ID is explicitly marked with an accessible explanation rather than presented as a meaningful label.

## Local setup

1. Install Node.js 20 LTS or newer.
2. Copy `.env.example` to `.env.local` and fill in every required value.
3. Install dependencies and start the app:

   ```bash
   npm install
   npm run dev
   ```

4. In Supabase, run all files in `supabase/migrations` in filename order, preferably with `supabase db push`.
5. Create an organization and ensure the existing `dweiss@lexipol.com` Supabase Auth user has an `application_users` membership. Migration `202607230003_role_based_access_control.sql` promotes that fixed account to `super_admin`.

   ```sql
   insert into public.organizations (name) values ('Example team') returning id;
   insert into public.application_users (id, organization_id, role)
   values ('<dweiss-auth-user-uuid>', '<organization-uuid>', 'super_admin');
   ```

## Email and password sign-in

Authentication and application authorization are deliberately separate:

- `auth.users` is managed by Supabase Auth and contains email/password identities.
- `public.application_users` is DevTrack's access list. An authenticated person cannot read reporting data until their Auth user ID is assigned to an organization here.

DevTrack does not expose public registration. To add a user:

1. In Supabase, open **Authentication → Users**.
2. Select **Add user → Create new user**.
3. Enter the user's email and a strong initial password, enable automatic email confirmation, and create the user.
4. Copy the newly created user's UUID.
5. Assign that UUID to a DevTrack organization with:

```sql
insert into public.application_users (id, organization_id, display_name, role)
values (
  '<id-from-auth-users>',
  '<organization-id>',
  '<display-name>',
  'id'
)
on conflict (id) do update
set organization_id = excluded.organization_id,
    display_name = excluded.display_name,
    role = excluded.role;
```

Use User Management for normal invitations and assign only Admin, ID, or SME. The fixed SuperAdmin role belongs only to `dweiss@lexipol.com`; the migration and database guard enforce that rule. SuperAdmin, Admin, and ID can read synchronized reporting data in their organization. SME users can retrieve only tasks assigned to their administrator-mapped Wrike identity through the SME Dashboard. The application shows an **Access awaiting approval** screen until an Auth user is assigned here.

See [Role-based access control](docs/role-based-access-control.md) for the capability matrix and [Organization-wide reporting access](docs/organization-wide-reporting-access.md) for the database policy inventory.

Keep public signup disabled under **Authentication → Sign In / Providers → Email**. User creation should be performed by an administrator through the Supabase Dashboard. Provide passwords through an approved secure channel; never include them in source code or SQL saved in the repository.

To audit authentication and application access together:

```sql
select
  auth_user.id,
  auth_user.email,
  auth_user.last_sign_in_at,
  app_user.organization_id,
  app_user.display_name,
  app_user.role
from auth.users auth_user
left join public.application_users app_user on app_user.id = auth_user.id
order by auth_user.email;
```

## Environment variables

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | Canonical application URL, for example `http://localhost:3000`. |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser-safe Supabase project details. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key used for sync upserts; never expose it to the browser. |
| `TOKEN_ENCRYPTION_KEY` | A high-entropy secret (at least 32 characters) for encrypting stored Wrike tokens and signing OAuth state. Rotate deliberately; rotating it invalidates existing connections. |
| `WRIKE_CLIENT_ID` / `WRIKE_CLIENT_SECRET` | Wrike OAuth app credentials, server-only. |
| `WRIKE_OAUTH_BASE_URL` / `WRIKE_API_BASE_URL` | Wrike endpoints; defaults are already supplied. |
| `CRON_SECRET` | Long random secret that authorizes the scheduled sync endpoint. |

Never commit `.env.local`, tokens, service-role keys, or OAuth secrets.

Administrator-managed Supabase invitations, first-time account setup, personal profiles, redirect allowlists, email-template requirements, and the Vercel Deployment Protection limitation are documented in [`docs/user-invitations-and-profiles.md`](docs/user-invitations-and-profiles.md).

## Wrike OAuth configuration

For a call-by-call review of the enabled integration, see the **[Active Wrike API inventory](docs/wrike-api-inventory.md)**. It maps every current OAuth, health-check, workflow, user, category, metadata, folder-task, and folder-timelog request to its trigger and implementation source.

Create a Wrike API application and set its redirect/callback URL exactly to:

```text
<NEXT_PUBLIC_APP_URL>/api/wrike/callback
```

For local development this is `http://localhost:3000/api/wrike/callback`. Register the production HTTPS URL separately in Wrike. DevTrack requests comma-delimited `wsReadOnly,amReadOnlyUser`: workspace read access covers tasks, timelogs, categories, and workflows; account-management user read access covers `GET /users/{userId}`. Existing `wsReadOnly`-only connections must reconnect after migration `202607170002_wrike_reference_data.sql`. The connecting account must be able to read all 13 configured folders, descendant tasks, and timelogs.

The Administration health check verifies the account endpoint, data-center host, token state, latency, and most recent combined import without returning credentials.

### Combined folder task and timelog import

The enabled bulk-import action in Administration is **Import folder tasks and timelogs**. It calls:

- `GET /folders/IEACHQK7I46YBWEN/folders` for the real `folderTree` metadata response.
- `GET /customfields?title=%5BLCT%5D` and `GET /customfields?title=LCT`; if neither returns the required `LCT Reporting` field, it falls back to `GET /customfields` and applies a narrow local prefix rule.
- `GET /folders/{folderId}/tasks` with `descendants=true`, `plainTextCustomFields=true`, `subTasks=true`, all required reporting fields, and pagination.
- `GET /folders/{folderId}/timelogs?plainText=true` with pagination. When live response evidence cannot prove recursive coverage, the importer conservatively queries relevant descendant folders with `descendants=false`.

`descendants=true` includes nested task work, `plainTextCustomFields=true` requests readable custom-field text, and the task `fields` JSON explicitly includes `customFields`, `responsibleIds`, and all other DevTrack fields. The importer verifies this contract before making a task request. Custom-field URLs are constructed with `URL` and `URLSearchParams`; dropdown values remain the strings Wrike returns. The application endpoint remains `POST /api/wrike/import-folder-tasks` for compatibility.

After resolving each custom-field ID to its original Wrike title, DevTrack removes legacy `[LCT]`, `(M)`, and `(L)` markers for display and reporting. Source fields that normalize to the same title become one logical field, while original IDs, titles, and values remain stored. Conflicting populated sources retain every value and are flagged rather than silently overwritten. Filter choices are generated from values actually observed on visible synchronized tasks.

The importer also requests all account-wide workflows, `GET /spaces`, `GET /timelog_categories`, and distinct encountered users. Resolved users refresh after 24 hours; the configured 13 names remain fallbacks rather than limiting which IDs can be synchronized. A reference failure is recorded as a warning and retains prior data, historical names, configured fallbacks, or an explicitly marked raw ID. The folder tree and every selected-folder task and timelog response must succeed before reporting reconciliation starts. A folder-list `customFields` array is detail-verified before it may replace stored field relationships; a matching verification fingerprint avoids repeat detail calls on later imports. Changed, empty, omitted, malformed, conflicting, and older unverified list payloads are hydrated in task-by-ID batches of at most 100. If hydration fails, prior fields remain stored and are labeled incomplete rather than current. The importer upserts stable task/time-entry IDs, preserves many-to-many source folders, only removes stale task-source associations after successful retrieval, and never deletes historical timelogs merely because a later response omits them. It records request counts, warnings, failures, task-contract evidence, metadata evidence, reference resolution, and descendant-timelog diagnostics in `public.wrike_folder_task_import_runs`:

```sql
select t.title,t.status,f.wrike_id as folder_id,f.title as folder_title,m.imported_at
from public.wrike_tasks t
join public.wrike_folder_task_imports m on m.task_id=t.id
left join public.wrike_folders f on f.id=m.folder_id
order by m.imported_at desc,t.title;
```

On the first connected deployment run, DevTrack records `folder_recursive` only when actual responses prove top-folder timelog coverage includes descendant tasks. Missing or inconclusive evidence records `explicit_tree` and keeps explicit traversal for later runs. Until that run completes, the repository documentation reports the live result as pending.

## Data and metric definitions

- The Dashboard includes only projects related to Online Learning workflow ID `IEACHQK7K4BHMLHM`; status names never determine membership.
- Dashboard statuses use the centralized **active**, **completed**, or **stalled or canceled** classification. Administrator classifications survive later imports, and unresolved statuses remain visibly warned rather than being inferred from their names.
- Completed Dashboard charts use the explicit completed classification and normalized Reporting value; time is summed from valid synchronized project entries before averaging.
- Actual effort is the sum of idempotently persisted time-entry minutes. Planned effort uses Wrike effort allocation when available.
- Shared tasks count once in task totals. Contributors remain visible individually; the application does not silently divide shared work among assignees.
- Inaccessible or removed records are preserved for history and can be marked deleted rather than hard-deleted.

## Dashboard and navigation

The left navigation is capability-driven. SuperAdmin and Admin see the full product plus User Management and Data; ID sees standard read-only pages and the SME Dashboard; SME sees only the SME Dashboard and their profile. `/projects` is the user-facing project route; existing `/tasks` URLs redirect for compatibility without renaming Wrike or database entities. The persistent footer provides the Lexipol brand and a Supabase-backed Logout action.

The Dashboard uses RLS-aware overview and time RPCs across all valid Reporting Years rather than loading raw facts into the browser. The Development dashboard has one manual Reporting Year filter, displayed in the synchronized `YYYY Courses` format. Overview metrics and categorical charts stream independently from recorded-time analytics so a slow time query does not blank the page. Reporting, Course Type, Authoring Tool, and Vertical use the normalized custom-field layer, so `(M)` and `(L)` sources are merged and conflicts remain available for administrative review.

Apply all migrations through `202607210001_vertical_completeness_and_repair.sql`. The Reporting performance migrations require values to match `YYYY Courses`, recompute stored years, keep Development year-scoped, aggregate the main Dashboard across every valid year with reconciling chart drill-downs, and keep custom-field filter discovery below the hosted statement timeout.

### Associated Vertical production runbook

The migration and deployment do not run a Wrike import or Vertical repair automatically. Production totals and the final root cause for **De-escalation Strategies and Techniques** remain pending until an administrator performs this read-only-first procedure:

1. Apply `202607210001_vertical_completeness_and_repair.sql` and deploy the application.
2. Open **Data → Associated Vertical** and save the baseline organization-scoped diagnostic output. Do not select Repair yet.
3. Select **Run read-only comparison** under Custom-field acquisition. Compare the bounded list, task-detail, definition, parent-folder, selected-payload, readable-row, normalized-row, and enrichment evidence for `MAAAAAECJ2DX` and `MAAAAAAEMqHAo`. This action does not write Wrike or DevTrack data and does not return tokens or complete payloads.
4. Inspect whether task detail adds fields, all live task responses remain sparse, parent context contains candidate values, definitions are unavailable because of scope/access, or persistence rows disagree with the selected payload. Treat inheritance as confirmed only when the live evidence establishes it.
5. Select **Repair Vertical data** or run one normal, fully successful combined import. Repair reprocesses detail-verified stored arrays locally and hydrates incomplete or older list-only records; it keeps manual mappings, folder associations, and time entries.
6. Save the post-repair diagnostic output and reconcile each Dashboard Vertical slice with its filtered Projects drill-down.

`General`, `Cross Vertical`, `Cross-Vertical`, and `All Verticals` are the only semantic all-Vertical aliases. They expand to the approved membership set for Associated Vertical filtering while their original source values remain unchanged. Missing, unrecognized, and synchronization-incomplete data remain distinct states; legacy unresolved links continue to match all three.

## Course-development surveys

DevTrack includes route-backed SME debrief and internal ID-review workflows with trusted Wrike context, drafts, locked submissions, revisions, audit history, and private invoice storage. See [`docs/course-development-surveys.md`](docs/course-development-surveys.md) for authorization, migration, Storage, retention, and deployment details.

## Scheduling and deployment

The older Wrike synchronization schedule has been removed from `vercel.json`, and `GET /api/cron/wrike-sync` returns a protected `skipped` response if called manually. Only the saved-history cleanup remains scheduled at 07:00 UTC. Configure the scheduler to send `Authorization: Bearer <CRON_SECRET>`.

Deploy by setting the same production environment variables in Vercel (or another Next.js host), applying the Supabase migration, registering the production Wrike callback URL, and configuring the scheduler. Keep the service-role key server-only.

## Tests and verification

```bash
npm run test
npm run build
```

The unit suite covers metrics, filters, the deterministic question parser, Wrike hosts, pagination, task paths, and effort/time normalization. `supabase/tests/reporting_rls.sql` adds database integration coverage for organization isolation, compatibility access, intersection/union groups, and conversation auditing; run it against a local Supabase stack with `supabase test db`.

No live Wrike access is required for automated tests. Production validation requires applying all migrations through `202607200009_reporting_filter_options_performance.sql`, deploying server-side credentials, reconnecting Wrike to grant `amReadOnlyUser`, running the health check, selecting **Import folder tasks and timelogs**, and inspecting unresolved-reference, workflow-classification, custom-field conflict, task-contract, descendant, and Dashboard diagnostics before comparing sampled records with Wrike.

## Troubleshooting

- **“Wrike OAuth is not configured”**: check client ID, secret, app URL, and token encryption key.
- **Callback fails**: ensure the callback URL in Wrike exactly matches `NEXT_PUBLIC_APP_URL/api/wrike/callback`, including protocol.
- **Token refresh fails**: reconnect from Administration; an expired/revoked connection is marked accordingly without exposing the underlying token.
- **No data after import**: first apply migrations through `202607210001_vertical_completeness_and_repair.sql`. Then verify Reporting values use `YYYY Courses` and that the connecting administrator can read workflows, spaces, the Learning folder tree, custom-field definitions, and every configured task/timelog folder before selecting **Import folder tasks and timelogs**. Reconnect if Data administration reports that `amReadOnlyUser` is missing. A successful OAuth connection alone does not run the APIs.
- **User cannot see reports**: make sure their Auth user ID is in `application_users` for the correct organization. RLS intentionally prevents cross-organization reads.
