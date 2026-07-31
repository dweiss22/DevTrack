# DevTrack

DevTrack is a secure, organization-scoped application for analyzing and managing online-course development work synchronized from Wrike. It combines reporting dashboards, assignment-specific ID and SME workspaces, course-development surveys, SME management, historical survey reconciliation, and audited administration in one application.

## What the application does

### Wrike synchronization and reporting

- Connects to Wrike through OAuth 2.0 and stores encrypted access and refresh tokens.
- Synchronizes configured folder tasks, projects, workflows, statuses, users, spaces, timelog categories, custom-field definitions, task custom-field values, and time entries.
- Preserves raw Wrike values while maintaining normalized reporting fields for Reporting Year, Vertical, Course Type, Authoring Tool, ID Assigned, SME, and other configured fields.
- Retains source-folder relationships, synchronization diagnostics, unresolved references, and custom-field conflicts instead of silently discarding uncertain data.
- Provides administrator tools for synchronization history, Vertical diagnostics and repair, status classification, and custom-field mapping.

### Dashboards

- **Dashboard** provides organization-wide course and effort summaries for authorized reporting users.
- **Development** provides year-scoped course-development reporting and sortable project metrics.
- **ID Dashboard** includes only projects whose synchronized **ID Assigned** field explicitly matches the selected verified ID identity. It includes assignment totals, status metrics, average development hours by course reporting year, workflow-category time, and project links.
- **SME Dashboard** includes only projects whose synchronized **SME** field explicitly matches the selected verified SME identity. It supports Recent and All Time scopes, status analytics, submitted billing trends, survey states, and restricted SME project details.
- **Projects** provides authorized internal reporting users with searchable project details, normalized custom fields, timelines, contributors, and time analytics.

ID and SME assignment checks are centralized in database functions. Application roles, time entries, earlier surveys, or general project visibility do not independently establish project assignment.

### Ask DevTrack

Organizations can enable **Ask DevTrack**, a conversational reporting workspace that answers supported questions from the caller's authorized synchronized reporting data. Conversation history is organization- and user-scoped, and the feature does not bypass the reporting functions or RLS policies used by the dashboards.

### Course-development surveys

DevTrack manages two survey families:

- **Lexipol Course Development Debrief** for assigned SMEs.
- **ID Review of SME** for assigned instructional designers.

Survey capabilities include:

- organization-scoped, administrator-managed templates;
- immutable published versions;
- drafts pinned to the version on which they began;
- server-resolved project, assignment, Reporting Year, Vertical, SME type, and identity context;
- Internal and External SME behavior, including external billing and private invoice requirements;
- immutable submitted answer and definition snapshots;
- revision and audit history;
- private file storage with reauthorized, short-lived downloads; and
- administrator review, correction, retry, and notification-delivery controls.

The browser cannot supply trusted organization, actor, project, assignment, billing classification, or reporting context. Pages, APIs, database functions, Row Level Security, and Storage policies enforce the same boundaries.

### SME management and notifications

Authorized SME Coordinators, Admins, and SuperAdmins can access **SME Management**. Depending on capability, this workspace supports SME account invitations, verified identity mapping, classification status, assignment summaries, survey completion, billing summaries, and submitted debrief review.

New SME debrief submissions create durable, idempotent notification deliveries for active SME Coordinators in the same organization. Resend is the initial email provider. Delivery failures do not roll back a submitted survey and can be retried by the scheduled worker or an authorized administrator.

### Historical survey imports

The Admin Data workspace links to a dedicated staged importer for supported historical CSV exports. The workflow:

1. Detects the survey type from the normalized CSV header signature.
2. Parses deterministic dates, timestamps, ratings, booleans, hours, currency, comments, and Vertical aliases.
3. Preserves the original row and normalization diagnostics during review.
4. Reconciles projects, people, assignments, duplicates, and repeat-response groups without creating authentication accounts.
5. Requires explicit administrator resolution for ambiguous evidence.
6. Finalizes approved rows as read-only historical survey records with provenance and audit history.

Preview and reconciliation do not create live survey submissions. Identical file uploads and finalized rows are idempotent. Historical principals are non-login records and never grant application or operational access.

## Access model

DevTrack uses additive operational and management roles. A person can perform operational work while temporarily holding an application-management role.

### Operational roles

| Role | Primary access |
| --- | --- |
| `id` | Standard reporting pages, ID Dashboard, assigned ID-review workflows, and personal survey access. |
| `sme` | Assignment-scoped SME Dashboard, restricted SME project details, and eligible SME debrief workflows. |

An account may hold both operational roles when the same verified Wrike identity supports both responsibilities.

### Management roles

| Role | Primary access |
| --- | --- |
| `sme_coordinator` | SME Management, SME selection, submitted SME debrief details, and coordinator notification access. Requires an active SME operational role. |
| `admin` | User Management, Data, integrations, survey administration, SME Management, and broader administrative controls. |
| `super_admin` | Protected fixed role with the complete administrative capability set, including protected role-management operations. |

Navigation, pages, API routes, database functions, impersonation payloads, and RLS decisions consume the composed access profile rather than trusting a browser-supplied role. The legacy `application_users.role` field remains only for deployment compatibility.

For the complete capability and policy inventory, see [Role-based access control](docs/role-based-access-control.md), [Organization-wide reporting access](docs/organization-wide-reporting-access.md), and [Secure administration](docs/secure-administration.md).

## Architecture

| Layer | Technology and responsibility |
| --- | --- |
| Web application | Next.js 15 App Router, React 19, and TypeScript. |
| Server APIs | Next.js route handlers with Zod request validation and server-side capability checks. |
| Authentication | Supabase Auth with administrator-managed invitations and password recovery. Public registration is not used. |
| Database | Supabase PostgreSQL with organization-scoped RLS, caller-aware RPCs, immutable audit records, and migration-managed schema. |
| Storage | Private Supabase Storage for survey invoices and other allowed private survey files. |
| Source integration | Wrike OAuth 2.0 and REST API. Token exchange, refresh, and synchronization remain server-only. |
| Charts | Recharts with shared application formatting, status, and workflow-category definitions. |
| Notifications | Provider-neutral notification service with a Resend adapter and durable delivery rows. |
| Hosting and jobs | Vercel-compatible deployment with protected cron endpoints. |

## Repository layout

```text
app/                 Next.js pages, intercepted routes, and API handlers
components/          Dashboards, administration panels, forms, charts, and dialogs
docs/                Focused authorization, survey, notification, and Wrike runbooks
lib/                 Authentication, reporting, survey, Supabase, and Wrike services
scripts/             Verification and maintenance scripts
supabase/migrations/ Ordered PostgreSQL schema and data migrations
supabase/tests/      Database/RLS integration tests
tests/               Vitest unit, component, route, and contract tests
```

## Local development

### Prerequisites

- Node.js 20 LTS or newer.
- npm.
- A Supabase project, or Docker Desktop for a local Supabase stack.
- A Wrike OAuth application when testing synchronization.
- A Resend account only when testing outbound coordinator notifications.

### Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the environment template and enter the values for your environment:

   ```powershell
   Copy-Item .env.example .env.local
   ```

3. Apply every migration in `supabase/migrations` in filename order. For a linked Supabase project:

   ```bash
   npx supabase migration list
   npx supabase db push
   ```

4. Start the application:

   ```bash
   npm run dev
   ```

5. Open `http://localhost:3000` and sign in with an administrator-provisioned account.

Do not seed production users, organizations, role grants, or Wrike mappings from README examples. Use reviewed migrations and the application's administrative workflows.

## Environment variables

| Variable | Required | Purpose |
| --- | ---: | --- |
| `NEXT_PUBLIC_APP_URL` | Yes | Canonical public origin without a trailing path, such as `http://localhost:3000`. |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Browser-safe Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Browser-safe Supabase anonymous key. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only key used by trusted administrative and synchronization services. |
| `TOKEN_ENCRYPTION_KEY` | Yes | High-entropy secret used to encrypt stored Wrike tokens and sign OAuth state. Rotating it invalidates existing Wrike connections. |
| `WRIKE_CLIENT_ID` | For Wrike | Wrike OAuth client ID. |
| `WRIKE_CLIENT_SECRET` | For Wrike | Wrike OAuth client secret. |
| `WRIKE_OAUTH_BASE_URL` | No | Wrike OAuth host; the default is in `.env.example`. |
| `WRIKE_API_BASE_URL` | No | Wrike API host; the default is in `.env.example`. |
| `CRON_SECRET` | For scheduled jobs | Bearer secret that protects cron endpoints. |
| `RESEND_API_KEY` | For email | Server-only Resend API credential. |
| `NOTIFICATION_FROM_EMAIL` | For email | Verified notification sender. |
| `NOTIFICATION_REPLY_TO` | No | Optional monitored reply address. |

Never commit `.env.local`, service-role keys, OAuth credentials, encryption keys, API keys, access tokens, private storage URLs, or exported production CSV files.

## Authentication and account provisioning

Supabase authentication and DevTrack authorization are separate:

- `auth.users` contains the sign-in identity.
- `application_users` contains the organization membership and compatibility role.
- operational-persona and management-grant tables compose the effective access profile.
- application-to-Wrike mappings establish the verified identity used for assignment-scoped features.
- retained and historical principals preserve attribution without allowing sign-in.

DevTrack does not expose public registration. Authorized administrators invite users from **User Management**. The recipient uses the account setup or password-recovery flow to choose a password. Keep public email signup disabled in Supabase.

## Wrike configuration

Register this exact callback URL in the Wrike application:

```text
<NEXT_PUBLIC_APP_URL>/api/wrike/callback
```

The connecting account must be able to read every configured source folder and the required task, custom-field, user, workflow, status, space, category, and timelog data. DevTrack requests read-only Wrike scopes. Existing connections must be reconnected when a deployment adds a required scope.

The enabled Data action is **Import folder tasks and timelogs**. A combined import must retrieve all required selected-folder responses before reconciliation begins. Failed source retrieval does not silently erase previously synchronized reporting data.

See [Active Wrike API inventory](docs/wrike-api-inventory.md) for the endpoint-by-endpoint integration contract.

## Data definitions and safeguards

- Online Learning reporting membership is based on the configured Wrike workflow identity, not status text.
- Project status groups use administrator-managed Active, Completed, and Stalled/Canceled classifications. Unclassified statuses remain visible.
- Course Reporting Year comes from the authoritative normalized Wrike field; dates and time-entry years are not substitutes.
- Time metrics use persisted timelog minutes and exclude inaccessible or malformed entries according to the relevant reporting function.
- Shared projects count once in project totals.
- Custom-field conflicts retain all source values and remain unresolved until the source or an authorized mapping resolves them.
- Missing identity mappings or nonmatching assignment values return a valid empty state instead of unrelated projects.
- Historical imports do not infer people from approximate names or create login access.

## Scheduled jobs

`vercel.json` currently schedules:

| Route | Schedule | Purpose |
| --- | --- | --- |
| `/api/cron/reporting-cleanup` | Daily at 07:00 UTC | Reporting-history cleanup and maintenance. |
| `/api/cron/sme-debrief-notifications` | Daily at 07:15 UTC | Retry pending notification deliveries and clean eligible stale private draft objects. |

Both routes require `Authorization: Bearer <CRON_SECRET>`. Automatic Wrike synchronization is intentionally not scheduled; administrators run the combined import from Data after reviewing the source scope.

## Testing and verification

Run the application checks before deployment:

```bash
npm run test
npm run verify:auth-routes
npm run build
```

`verify:auth-routes` targets the configured production URL by default. Supply another origin when verifying a local or preview deployment:

```bash
npm run verify:auth-routes -- http://localhost:3000
```

Run database and RLS tests against a local Supabase stack:

```bash
npx supabase test db
```

The database test command requires Docker Desktop. No live Wrike access is required for the unit/component suite. Production smoke testing should verify authentication, role-specific navigation, strict ID/SME assignment filtering, one combined Wrike import, survey draft/submission behavior, private-file authorization, historical-import preview, notification retry status, and organization isolation.

## Deployment

1. Configure all production environment variables in the hosting platform.
2. Apply pending Supabase migrations before deploying application code that depends on them.
3. Deploy the verified production build.
4. Confirm the Wrike callback URL and reconnect if scopes changed.
5. Confirm the private survey storage bucket and Storage policies remain private.
6. Configure protected cron schedules.
7. Run authenticated smoke tests for each active operational and management role.

Migrations are forward-only. Do not edit a migration that has already been applied to a shared environment; add a new migration that replaces or extends the affected object.

## Additional documentation

- [User invitations and profiles](docs/user-invitations-and-profiles.md)
- [Role-based access control](docs/role-based-access-control.md)
- [Organization-wide reporting access](docs/organization-wide-reporting-access.md)
- [Role-aware course dashboards](docs/role-aware-course-dashboards.md)
- [Secure administration](docs/secure-administration.md)
- [Course-development surveys](docs/course-development-surveys.md)
- [SME debrief notifications](docs/sme-debrief-notifications.md)
- [Historical survey imports](docs/historical-survey-imports.md)
- [Active Wrike API inventory](docs/wrike-api-inventory.md)

## Troubleshooting

- **Wrike OAuth is not configured:** verify the client ID, client secret, public app URL, callback URL, and token encryption key.
- **Wrike callback fails:** confirm the registered callback exactly matches `<NEXT_PUBLIC_APP_URL>/api/wrike/callback`, including the protocol.
- **No reporting data after synchronization:** verify the configured folder scope, Wrike permissions, workflow identity, Reporting Year values, source-run diagnostics, and unresolved-reference warnings.
- **A user sees no ID or SME projects:** verify the account's operational role, application-to-Wrike mapping, and exact normalized value in the project's authoritative assignment field.
- **An administrator page reports a missing function or column:** compare local and linked migration history, apply pending migrations, and reload the PostgREST schema cache if needed.
- **Notification delivery fails:** verify Resend configuration, sender verification, recipient state, cron authorization, and the delivery's last provider error.
- **Historical CSV rows remain unresolved:** inspect project-title matches, source response IDs, person/assignment evidence, unfamiliar columns, duplicate groups, and row-level normalization issues. Do not resolve uncertain people with fuzzy matching.
