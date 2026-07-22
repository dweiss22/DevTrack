# Organization-wide reporting access

## Effective model

After migration `202607210006_organization_wide_reporting_access.sql`, an authenticated DevTrack user with an `application_users` row can read all synchronized reporting records whose `organization_id` matches that application row. A user with no application row reads none. Records from every other organization remain hidden.

The `admin` role continues to control mutations and operational configuration. The service role continues to bypass RLS for server-side import, repair, and maintenance. Reporting-group rows and `organizations.reporting_access_enforced` are retained for compatibility and audit history, but no reporting read or RPC consults them.

## Authorization inventory

| Data or operation | Previous dependency | Effective access after migration |
| --- | --- | --- |
| Tasks, time entries, Wrike people, folders, projects, spaces, and custom-field definitions | `can_access_wrike_*`, reporting groups, and `reporting_access_enforced` | Read all rows in the authenticated user's organization |
| Task assignees, locations, scope mappings, raw/normalized field values, and folder import source mappings | Parent task/entry permission helper | Read when the parent task or source row belongs to the user's organization |
| Projects, Dashboard, Development, time reports, filter options, and percentile RPCs | Mixed group traversal and per-task/per-entry permission calls | Set-based organization predicate resolved once per RPC |
| Reporting-group configuration | Member or administrator read; administrator write | Deprecated, retained, administrator-only read/write |
| Organization, application-user, workflow, category, and enabled-field reference data | Organization RLS | Existing organization-scoped reads retained |
| Wrike OAuth connection and secrets | Administrator RLS plus server-only encryption | Unchanged; administrator/server only |
| Imports, repair, custom-field mappings, status classifications, and user administration | Application `requireAdmin` and/or admin/service-role database policy | Unchanged; administrator only |
| Ask conversations and messages | Owner or organization administrator | Unchanged; ordinary users see only their own history |
| Sync leases and background maintenance | Service role | Unchanged |

The legacy `/api/admin/reporting-groups` endpoints remain only as compatibility endpoints; no current administration page links to them and their data has no authorization effect. The reporting settings endpoint no longer writes `reporting_access_enforced`.

## RPC changes

The migration preserves public signatures and response shapes. It replaces the internal authorization source for:

- `reporting_accessible_task_ids` and the new companion `reporting_accessible_time_entry_ids`
- `reporting_filtered_tasks_without_dashboard_drilldown`, which continues to feed `reporting_filtered_tasks` and `reporting_task_rows`
- `reporting_time_rows` and `reporting_time_summary`
- Dashboard task and v4 time RPCs; overview v4 remains sourced from the task RPC
- Development filtered tasks and reporting-year options; analytics and project rows remain sourced from them
- `reporting_custom_field_options`
- batch and single-project development percentiles

Compatibility `can_access_wrike_*` functions now perform only a direct organization comparison. Priority reporting RPCs do not call them.

## Application and database enforcement

The browser and server-component Supabase clients use the authenticated user's JWT and depend on RLS or caller-aware RPCs for read isolation. Administrative routes call `requireAdmin()` before using the service-role client. This application check is essential because the service role bypasses RLS.

Database policies independently prevent authenticated members from writing synchronized reporting tables: those roles receive `SELECT`, while sync writes use the service role. Administrator-only configuration tables retain their existing administrator policies. OAuth credentials remain in `wrike_connections`, protected by administrator RLS and encrypted token storage.

## Deployment sequence

1. Back up the database and capture current reporting-group counts for audit purposes.
2. Apply all pending migrations through `202607210006_organization_wide_reporting_access.sql` in a staging environment.
3. Reload the PostgREST schema cache (the migration sends the reload notification).
4. Run `supabase/tests/reporting_rls.sql` against staging.
5. Sign in as an ordinary member and verify Projects, Dashboard, Development, time reporting, filter options, and project detail show the complete organization dataset.
6. Verify a user assigned to another organization cannot read the first organization's rows or obtain them through RPCs.
7. Verify admin imports, Vertical repair, user administration, OAuth connection management, and service-role jobs still work.
8. Compare representative query plans and latency using the checks below.
9. Deploy the application. No import, repair, backfill, or production mutation is required by this access migration.

Do not apply this migration to production until separately authorized.

## Performance validation

Use an authenticated member JWT in staging so the plan represents the real reporting path. Representative checks:

```sql
explain (analyze, buffers, settings)
select * from public.reporting_task_rows('{"sort":"updated"}'::jsonb,100,0);

explain (analyze, buffers, settings)
select * from public.reporting_time_summary('{}'::jsonb,'total');

explain (analyze, buffers, settings)
select * from public.reporting_project_length_percentiles(array[
  '<representative-task-id-1>'::uuid,
  '<representative-task-id-2>'::uuid
]);
```

Confirm plans use organization/task indexes and contain no scans or joins of `reporting_groups`, `reporting_group_members`, `reporting_group_scopes`, or `reporting_group_wrike_users`. Confirm there are no repeated calls to `can_access_wrike_task` or `can_access_wrike_time_entry`. Record execution time, shared-buffer hits/reads, rows returned, and the Supabase statement-timeout setting before and after deployment.

## Rollback and future cleanup

The migration is forward-only and does not delete legacy access configuration. If rollout must be reversed, deploy a new migration that restores the prior policies and RPC definitions; the retained reporting-group rows make that possible. Do not roll back by deleting organization reporting data.

After an agreed retention period, a separate authorized cleanup may remove the unused reporting-group APIs, tables, enum, helper functions, and `reporting_access_enforced` column. That cleanup is intentionally outside this change.
