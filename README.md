# DevTrack

DevTrack is a secure reporting application for online-course development work managed in Wrike. It replaces manual exports with a configurable Wrike synchronization process and dashboards that show work, workload, time, and delivery trends.

## Architecture

- **Next.js / TypeScript** powers the responsive application and server-side API routes.
- **Supabase** provides authentication, PostgreSQL, Row Level Security (RLS), and the application data store.
- **Wrike OAuth 2.0 + REST API** supplies task, user, and time-entry data. All OAuth exchange, token refresh, and synchronization operations occur on the server.
- **Recharts** renders accessible dashboard charts.
- **Vercel Cron** calls the protected daily sync endpoint; Supabase scheduled functions can be substituted if preferred.

The ingestion layer is deliberately separate from reporting tables, so a transitional spreadsheet/file importer or additional source can be added later without replacing the Wrike integration.

## Included workflow

1. An administrator signs in with an administrator-created Supabase email/password account and connects Wrike from **Administration**.
2. The OAuth callback securely exchanges the code and stores AES-256-GCM encrypted access and refresh tokens. OAuth state is signed and expires after 10 minutes.
3. The administrator configures account, space, folder, project, parent-task, or task-list scopes and selects filterable custom fields.
4. One organization-level coordinator paginates and deduplicates records, refreshes tokens against the OAuth-provided Wrike data-center host, and records partial failures.
5. Administrators configure reporting groups by source and/or Wrike person before enabling strict reporting access.
6. The dashboard, Tasks, Team, Time Entries, and Ask DevTrack pages read the same RLS-protected reporting data.

## Local setup

1. Install Node.js 20 LTS or newer.
2. Copy `.env.example` to `.env.local` and fill in every required value.
3. Install dependencies and start the app:

   ```bash
   npm install
   npm run dev
   ```

4. In Supabase, run both files in `supabase/migrations` in filename order with the SQL Editor, or use `supabase db push`.
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

For local development this is `http://localhost:3000/api/wrike/callback`. Register the production HTTPS URL separately in Wrike. DevTrack requests the `wsReadOnly` OAuth scope. The connecting account needs permission to read the selected work, contacts, workflows, custom fields, and timelogs. Reconnect connections created before migration `202607160002` so the account-specific API host is stored.

The Administration health check verifies the account endpoint, data-center host, token state, latency, and most recent successful or partial synchronization without returning credentials.

## Data and metric definitions

- A task is **completed** when Wrike provides a completion timestamp or its status group is Completed.
- **Open** includes Active and Deferred; Cancelled is a separate state.
- An **overdue** task is open and has a due date before the current date.
- Completion trends use the Wrike completion timestamp; time trends use each time-entry’s tracked date.
- Actual effort is the sum of idempotently persisted time-entry minutes. Planned effort uses Wrike effort allocation when available.
- Shared tasks count once in task totals. Contributors remain visible individually; the application does not silently divide shared work among assignees.
- Inaccessible or removed records are preserved for history and can be marked deleted rather than hard-deleted.

## Filters and Ask DevTrack

Task and time filters are URL-backed and server-paginated. Available dimensions include text, status/state, person, reporting source, tracked dates, time presence, category, and administrator-selected custom fields. `[LCT]` is selected automatically when first discovered.

Ask DevTrack is a deterministic reporting parser, not an external language model. It supports task counts/lists, time totals and averages, breakdowns, planned-versus-actual comparisons, relative dates, and quoted task titles. It executes the same authorized Supabase reporting functions as the filter pages. Questions and answers are visible to their owner and organization administrators and are removed after 90 days.

## Scheduling and deployment

`vercel.json` schedules `GET /api/cron/wrike-sync` daily at 06:00 UTC and saved-history cleanup at 07:00 UTC. Configure the scheduler to send `Authorization: Bearer <CRON_SECRET>`. Daily syncs are incremental with a five-minute overlap; Sunday is a full reconciliation. Admins can run either mode manually. Full reconciliation removes stale relationships and marks missing records deleted without erasing history.

Deploy by setting the same production environment variables in Vercel (or another Next.js host), applying the Supabase migration, registering the production Wrike callback URL, and configuring the scheduler. Keep the service-role key server-only.

## Tests and verification

```bash
npm run test
npm run build
```

The unit suite covers metrics, filters, the deterministic question parser, Wrike hosts, pagination, task paths, and effort/time normalization. `supabase/tests/reporting_rls.sql` adds database integration coverage for organization isolation, compatibility access, intersection/union groups, and conversation auditing; run it against a local Supabase stack with `supabase test db`.

No live Wrike access is required for automated tests. Production acceptance still requires applying both migrations, reconnecting Wrike, running a health check, full-syncing a representative scope, comparing sampled task/timelog/custom-field values with Wrike, testing member groups, and only then enabling strict access and Ask DevTrack.

## Troubleshooting

- **“Wrike OAuth is not configured”**: check client ID, secret, app URL, and token encryption key.
- **Callback fails**: ensure the callback URL in Wrike exactly matches `NEXT_PUBLIC_APP_URL/api/wrike/callback`, including protocol.
- **Token refresh fails**: reconnect from Administration; an expired/revoked connection is marked accordingly without exposing the underlying token.
- **No data after sync**: verify the connecting administrator can see the selected source and timelogs in Wrike; inspect the sync-run error details in Administration.
- **User cannot see reports**: make sure their Auth user ID is in `application_users` for the correct organization. RLS intentionally prevents cross-organization reads.
