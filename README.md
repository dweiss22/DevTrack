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

1. An administrator signs in with Supabase Auth and connects Wrike from **Administration**.
2. The OAuth callback securely exchanges the code and stores AES-256-GCM encrypted access and refresh tokens. OAuth state is signed and expires after 10 minutes.
3. The administrator configures one or more account, space, folder, project, parent-task, or task-list scopes, previews them, and runs a manual sync.
4. The sync service paginates records, upserts users/tasks/time entries by organization plus Wrike ID, records partial failures, and refreshes an expiring token automatically.
5. The dashboard and detailed Tasks, Team, and Time Entries reports read the normalized reporting tables through RLS.

## Local setup

1. Install Node.js 20 LTS or newer.
2. Copy `.env.example` to `.env.local` and fill in every required value.
3. Install dependencies and start the app:

   ```bash
   npm install
   npm run dev
   ```

4. In Supabase, run `supabase/migrations/202607160001_initial_schema.sql` with the SQL Editor or `supabase db push`.
5. Create an organization, then add each permitted Supabase Auth user to `application_users`. Set at least one user’s `role` to `admin`.

   ```sql
   insert into public.organizations (name) values ('Example team') returning id;
   insert into public.application_users (id, organization_id, role)
   values ('<auth-user-uuid>', '<organization-uuid>', 'admin');
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

For local development this is `http://localhost:3000/api/wrike/callback`. Register the production HTTPS URL separately in Wrike. The connecting administrator needs permission to access the selected spaces/folders/projects, task details, contacts, and timelogs. Some Wrike plans or account settings limit group/custom-field/approval endpoints; those fields are retained in `raw_data` when supplied and can be expanded safely as account permissions allow.

## Data and metric definitions

- A task is **completed** when Wrike provides `completed_at` or its status matches completed/closed/done.
- An **active** task is any non-completed task.
- An **overdue** task is active and has a due date before the current date.
- Completion trends use the Wrike completion timestamp; time trends use each time-entry’s tracked date.
- Actual effort is the sum of idempotently persisted time-entry minutes. Planned effort uses Wrike effort allocation when available.
- Shared tasks count once in task totals. Contributors remain visible individually; the application does not silently divide shared work among assignees.
- Inaccessible or removed records are preserved for history and can be marked deleted rather than hard-deleted.

## Scheduling and deployment

`vercel.json` schedules `GET /api/cron/wrike-sync` daily at 06:00 UTC. Configure Vercel to send `Authorization: Bearer <CRON_SECRET>` (or invoke this protected endpoint from an external scheduler that can send the header). Each active scope is processed independently, and runs are recorded in `wrike_sync_runs`.

Deploy by setting the same production environment variables in Vercel (or another Next.js host), applying the Supabase migration, registering the production Wrike callback URL, and configuring the scheduler. Keep the service-role key server-only.

## Tests and verification

```bash
npm run test
npm run build
```

The included metric tests cover overdue status, planned-versus-actual detection, and shared-task contributor counting. Add mocked Wrike HTTP tests for your account-specific endpoint shapes before changing synchronization behavior. No live Wrike access is required for unit tests.

## Troubleshooting

- **“Wrike OAuth is not configured”**: check client ID, secret, app URL, and token encryption key.
- **Callback fails**: ensure the callback URL in Wrike exactly matches `NEXT_PUBLIC_APP_URL/api/wrike/callback`, including protocol.
- **Token refresh fails**: reconnect from Administration; an expired/revoked connection is marked accordingly without exposing the underlying token.
- **No data after sync**: verify the connecting administrator can see the selected source and timelogs in Wrike; inspect the sync-run error details in Administration.
- **User cannot see reports**: make sure their Auth user ID is in `application_users` for the correct organization. RLS intentionally prevents cross-organization reads.
