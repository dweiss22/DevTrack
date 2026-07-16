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
3. The administrator selects **Reset and import folder tasks**. The importer validates the Learning folder tree, both LCT custom-field title searches, and the 13 configured Wrike folder-task GET endpoints.
4. DevTrack retrieves and validates every response before changing Supabase, then resets prior Wrike-derived reporting rows, deduplicates tasks, and stores task details with resolved folder and LCT labels.
5. The Tasks page and task detail show readable folder/custom-field titles while retaining Wrike IDs internally. Timelogs, contacts, workflows, and other Wrike APIs remain deferred.

## Local setup

1. Install Node.js 20 LTS or newer.
2. Copy `.env.example` to `.env.local` and fill in every required value.
3. Install dependencies and start the app:

   ```bash
   npm install
   npm run dev
   ```

4. In Supabase, run all files in `supabase/migrations` in filename order, preferably with `supabase db push`.
5. Create an organization, then add each permitted Supabase Auth user to `application_users`. Set at least one user’s `role` to `admin`.

   ```sql
   insert into public.organizations (name) values ('Example team') returning id;
   insert into public.application_users (id, organization_id, role)
   values ('<auth-user-uuid>', '<organization-uuid>', 'admin');
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
  'member'
)
on conflict (id) do update
set organization_id = excluded.organization_id,
    display_name = excluded.display_name,
    role = excluded.role;
```

Give the first administrator the `admin` role and ordinary reporting users the `member` role. Configure and test reporting groups before enabling strict access from Administration. The application shows an **Access awaiting approval** screen until an Auth user is assigned here.

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

## Wrike OAuth configuration

Create a Wrike API application and set its redirect/callback URL exactly to:

```text
<NEXT_PUBLIC_APP_URL>/api/wrike/callback
```

For local development this is `http://localhost:3000/api/wrike/callback`. Register the production HTTPS URL separately in Wrike. DevTrack requests the `wsReadOnly` OAuth scope. For this stage, the connecting account must be able to read all 13 configured folders and their descendant tasks. Reconnect connections created before migration `202607160002` so the account-specific API host is stored.

The Administration health check verifies the account endpoint, data-center host, token state, latency, and most recent focused folder-task import without returning credentials.

### Focused folder task import

The only enabled bulk-import action in Administration is **Reset and import folder tasks**. It calls:

- `GET /folders/IEACHQK7I46YBWEN/folders` for the real `folderTree` metadata response.
- `GET /customfields?title=%5BLCT%5D` and `GET /customfields?title=LCT`; if neither returns the required `LCT Reporting` field, it falls back to `GET /customfields` and applies a narrow local prefix rule.
- `GET /folders/{folderId}/tasks` with `descendants=true`, subtasks, optional reporting fields, and pagination for the explicit 13-folder allowlist in `lib/wrike/folder-task-import.ts`.

Custom-field URLs are constructed with `URL` and `URLSearchParams`. Dropdown values are treated as the readable strings Wrike actually returns; the importer does not manufacture option IDs. The application endpoint remains `POST /api/wrike/import-folder-tasks` because clicking it changes Supabase data.

The folder tree, custom-field metadata, and all 13 task responses must validate before existing Wrike-derived data is reset. The importer keeps the OAuth connection, organization, and application users; stores raw responses plus normalized folders, projects, LCT definitions, locations, and values; and records title-search evidence in `public.wrike_folder_task_import_runs.metadata_diagnostics`:

```sql
select t.title,t.status,f.wrike_id as folder_id,f.title as folder_title,m.imported_at
from public.wrike_tasks t
join public.wrike_folder_task_imports m on m.task_id=t.id
left join public.wrike_folders f on f.id=m.folder_id
order by m.imported_at desc,t.title;
```

After the first production import, open the Administration import history to record whether `[LCT]` returned `LCT Reporting`, what the `LCT` query returned, whether the unfiltered fallback was required, and the final matched titles. Wrike exposes the `title` parameter but does not document its exact matching semantics, so the stored live response evidence is authoritative for this account.

## Data and metric definitions

- A task is **completed** when Wrike provides a completion timestamp or its status group is Completed.
- **Open** includes Active and Deferred; Cancelled is a separate state.
- An **overdue** task is open and has a due date before the current date.
- Completion trends use the Wrike completion timestamp; time trends use each time-entry’s tracked date.
- Actual effort is the sum of idempotently persisted time-entry minutes. Planned effort uses Wrike effort allocation when available.
- Shared tasks count once in task totals. Contributors remain visible individually; the application does not silently divide shared work among assignees.
- Inaccessible or removed records are preserved for history and can be marked deleted rather than hard-deleted.

## Later reporting stages

The current navigation intentionally exposes only Overview, Tasks, and Administration. Task filters are URL-backed and server-paginated. Folder names and LCT custom-field definitions are now resolved; people, time-entry, workflow, reporting-group, and Ask DevTrack features remain outside this stage.

They should be enabled one API at a time only after the 13-folder task counts and sample task fields have been checked against Wrike.

## Scheduling and deployment

The older Wrike synchronization schedule has been removed from `vercel.json`, and `GET /api/cron/wrike-sync` returns a protected `skipped` response if called manually. Only the saved-history cleanup remains scheduled at 07:00 UTC. Configure the scheduler to send `Authorization: Bearer <CRON_SECRET>`.

Deploy by setting the same production environment variables in Vercel (or another Next.js host), applying the Supabase migration, registering the production Wrike callback URL, and configuring the scheduler. Keep the service-role key server-only.

## Tests and verification

```bash
npm run test
npm run build
```

The unit suite covers metrics, filters, the deterministic question parser, Wrike hosts, pagination, task paths, and effort/time normalization. `supabase/tests/reporting_rls.sql` adds database integration coverage for organization isolation, compatibility access, intersection/union groups, and conversation auditing; run it against a local Supabase stack with `supabase test db`.

No live Wrike access is required for automated tests. Production validation for this stage requires applying all migrations through `202607160005_real_wrike_metadata.sql`, deploying the server-side credentials, reconnecting Wrike if necessary, running the health check, selecting **Reset and import folder tasks**, inspecting the recorded title-search diagnostics, and comparing sampled task folders and LCT values with Wrike.

## Troubleshooting

- **“Wrike OAuth is not configured”**: check client ID, secret, app URL, and token encryption key.
- **Callback fails**: ensure the callback URL in Wrike exactly matches `NEXT_PUBLIC_APP_URL/api/wrike/callback`, including protocol.
- **Token refresh fails**: reconnect from Administration; an expired/revoked connection is marked accordingly without exposing the underlying token.
- **No data after import**: first apply migrations through `202607160005_real_wrike_metadata.sql`. Then verify the connecting administrator can read the Learning folder tree, `LCT Reporting`, and every configured task folder before selecting **Reset and import folder tasks**. A successful OAuth connection alone does not run the APIs.
- **User cannot see reports**: make sure their Auth user ID is in `application_users` for the correct organization. RLS intentionally prevents cross-organization reads.
