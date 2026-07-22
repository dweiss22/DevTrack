-- Simplify authenticated reporting access to one organization boundary.
-- Reporting-group configuration is intentionally retained for audit/history,
-- but no reporting read path consults it after this migration.

create index if not exists wrike_time_entries_org_task_minutes_active_idx
  on public.wrike_time_entries(organization_id,task_id)
  include (minutes,user_id,entry_date,category)
  where not is_deleted;

create or replace function public.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path=public
as $$
  select application_user.organization_id
  from public.application_users application_user
  where application_user.id=auth.uid()
  limit 1;
$$;

revoke all on function public.current_organization_id() from public;
grant execute on function public.current_organization_id() to authenticated,service_role;

-- Compatibility helpers remain available to older callers, but now perform a
-- single organization comparison instead of reporting-group traversal.
create or replace function public.can_access_wrike_task(target_task_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.wrike_tasks task
    where task.id=target_task_id and task.organization_id=public.current_organization_id());
$$;

create or replace function public.can_access_wrike_time_entry(target_entry_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.wrike_time_entries entry
    where entry.id=target_entry_id and entry.organization_id=public.current_organization_id());
$$;

create or replace function public.can_access_wrike_user(target_user_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.wrike_users wrike_user
    where wrike_user.id=target_user_id and wrike_user.organization_id=public.current_organization_id());
$$;

create or replace function public.can_access_wrike_folder(target_folder_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.wrike_folders folder
    where folder.id=target_folder_id and folder.organization_id=public.current_organization_id());
$$;

create or replace function public.can_access_wrike_project(target_project_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.wrike_projects project
    where project.id=target_project_id and project.organization_id=public.current_organization_id());
$$;

create or replace function public.can_access_wrike_space(target_space_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.wrike_spaces space
    where space.id=target_space_id and space.organization_id=public.current_organization_id());
$$;

create or replace function public.can_access_wrike_custom_field(target_field_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.wrike_custom_fields field
    where field.id=target_field_id and field.organization_id=public.current_organization_id());
$$;

create or replace function public.reporting_accessible_task_ids()
returns table (task_id uuid)
language sql stable security definer set search_path=public as $$
  with viewer as materialized (select public.current_organization_id() as organization_id)
  select task.id
  from viewer join public.wrike_tasks task on task.organization_id=viewer.organization_id
  where not task.is_deleted;
$$;

create or replace function public.reporting_accessible_time_entry_ids()
returns table (time_entry_id uuid)
language sql stable security definer set search_path=public as $$
  with viewer as materialized (select public.current_organization_id() as organization_id)
  select entry.id
  from viewer join public.wrike_time_entries entry on entry.organization_id=viewer.organization_id
  join public.wrike_tasks task on task.id=entry.task_id and task.organization_id=viewer.organization_id
  where not entry.is_deleted and not task.is_deleted;
$$;

revoke all on function public.can_access_wrike_task(uuid) from public;
revoke all on function public.can_access_wrike_time_entry(uuid) from public;
revoke all on function public.can_access_wrike_user(uuid) from public;
revoke all on function public.can_access_wrike_folder(uuid) from public;
revoke all on function public.can_access_wrike_project(uuid) from public;
revoke all on function public.can_access_wrike_space(uuid) from public;
revoke all on function public.can_access_wrike_custom_field(uuid) from public;
revoke all on function public.reporting_accessible_task_ids() from public;
revoke all on function public.reporting_accessible_time_entry_ids() from public;
grant execute on function public.reporting_accessible_task_ids() to authenticated,service_role;
grant execute on function public.reporting_accessible_time_entry_ids() to authenticated,service_role;

-- Replace fine-grained reporting RLS with direct organization predicates. The
-- scalar subquery lets PostgreSQL evaluate the organization lookup once.
drop policy if exists "scoped task read" on public.wrike_tasks;
drop policy if exists "org read wrike_tasks" on public.wrike_tasks;
create policy "organization reporting task read" on public.wrike_tasks for select
  using (organization_id=(select public.current_organization_id()));

drop policy if exists "scoped entry read" on public.wrike_time_entries;
drop policy if exists "org read wrike_time_entries" on public.wrike_time_entries;
create policy "organization reporting time entry read" on public.wrike_time_entries for select
  using (organization_id=(select public.current_organization_id()));

drop policy if exists "scoped wrike user read" on public.wrike_users;
drop policy if exists "org read wrike_users" on public.wrike_users;
create policy "organization reporting wrike user read" on public.wrike_users for select
  using (organization_id=(select public.current_organization_id()));

drop policy if exists "scoped folder read" on public.wrike_folders;
drop policy if exists "org read wrike_folders" on public.wrike_folders;
create policy "organization reporting folder read" on public.wrike_folders for select
  using (organization_id=(select public.current_organization_id()));

drop policy if exists "scoped project read" on public.wrike_projects;
drop policy if exists "org read wrike_projects" on public.wrike_projects;
create policy "organization reporting project read" on public.wrike_projects for select
  using (organization_id=(select public.current_organization_id()));

drop policy if exists "scoped space read" on public.wrike_spaces;
drop policy if exists "org read wrike_spaces" on public.wrike_spaces;
create policy "organization reporting space read" on public.wrike_spaces for select
  using (organization_id=(select public.current_organization_id()));

drop policy if exists "scoped custom field read" on public.wrike_custom_fields;
drop policy if exists "org read wrike_custom_fields" on public.wrike_custom_fields;
create policy "organization reporting custom field read" on public.wrike_custom_fields for select
  using (organization_id=(select public.current_organization_id()));

drop policy if exists "scoped assignee read" on public.wrike_task_assignees;
drop policy if exists "task assignees read" on public.wrike_task_assignees;
create policy "organization reporting assignee read" on public.wrike_task_assignees for select using (
  exists(select 1 from public.wrike_tasks task where task.id=task_id
    and task.organization_id=(select public.current_organization_id()))
);

drop policy if exists "scoped task location read" on public.wrike_task_locations;
drop policy if exists "task locations read" on public.wrike_task_locations;
create policy "organization reporting task location read" on public.wrike_task_locations for select using (
  exists(select 1 from public.wrike_tasks task where task.id=task_id
    and task.organization_id=(select public.current_organization_id()))
);

drop policy if exists "scoped custom value read" on public.wrike_task_custom_field_values;
drop policy if exists "custom values read" on public.wrike_task_custom_field_values;
create policy "organization reporting task custom value read" on public.wrike_task_custom_field_values for select using (
  exists(select 1 from public.wrike_tasks task where task.id=task_id
    and task.organization_id=(select public.current_organization_id()))
);

drop policy if exists "scope task read" on public.wrike_scope_tasks;
create policy "organization reporting scope task read" on public.wrike_scope_tasks for select using (
  exists(select 1 from public.wrike_tasks task where task.id=task_id
    and task.organization_id=(select public.current_organization_id()))
);

drop policy if exists "authorized folder task sources" on public.wrike_folder_task_imports;
create policy "organization reporting folder task source read" on public.wrike_folder_task_imports for select
  using (organization_id=(select public.current_organization_id()));

drop policy if exists "authorized folder timelog sources" on public.wrike_folder_timelog_imports;
create policy "organization reporting folder timelog source read" on public.wrike_folder_timelog_imports for select
  using (organization_id=(select public.current_organization_id()));

drop policy if exists "normalized custom fields org read" on public.wrike_normalized_custom_fields;
create policy "organization reporting normalized field read" on public.wrike_normalized_custom_fields for select
  using (organization_id=(select public.current_organization_id()));

drop policy if exists "normalized custom field sources org read" on public.wrike_normalized_custom_field_sources;
create policy "organization reporting normalized field source read" on public.wrike_normalized_custom_field_sources for select using (
  exists(select 1 from public.wrike_normalized_custom_fields field where field.id=normalized_field_id
    and field.organization_id=(select public.current_organization_id()))
);

drop policy if exists "normalized task custom values scoped read" on public.wrike_task_normalized_custom_field_values;
create policy "organization reporting normalized task value read" on public.wrike_task_normalized_custom_field_values for select using (
  exists(select 1 from public.wrike_tasks task where task.id=task_id
    and task.organization_id=(select public.current_organization_id()))
);

-- Reporting-group data is retained but is no longer ordinary-member reporting
-- configuration. Only organization administrators can inspect or mutate it.
drop policy if exists "reporting groups member read" on public.reporting_groups;
create policy "deprecated reporting groups admin read" on public.reporting_groups for select
  using (organization_id=(select public.current_organization_id()) and public.is_org_admin());
drop policy if exists "reporting members read" on public.reporting_group_members;
create policy "deprecated reporting members admin read" on public.reporting_group_members for select
  using (public.is_reporting_group_admin(group_id));
drop policy if exists "reporting scopes read" on public.reporting_group_scopes;
create policy "deprecated reporting scopes admin read" on public.reporting_group_scopes for select
  using (public.is_reporting_group_admin(group_id));
drop policy if exists "reporting wrike users read" on public.reporting_group_wrike_users;
create policy "deprecated reporting wrike users admin read" on public.reporting_group_wrike_users for select
  using (public.is_reporting_group_admin(group_id));

comment on column public.organizations.reporting_access_enforced is
  'Deprecated compatibility setting. Reporting reads are organization-wide and no longer consult this value.';
comment on table public.reporting_groups is
  'Deprecated reporting authorization configuration retained for audit and possible migration; not consulted by reporting reads.';

-- Set-based base filter. This preserves every existing filter contract while
-- eliminating restricted/unrestricted branches and per-row permission calls.
create or replace function public.reporting_filtered_tasks_without_dashboard_drilldown(filters jsonb default '{}'::jsonb)
returns table (task_id uuid,visible_actual_minutes bigint)
language sql stable security definer set search_path=public as $$
  with viewer as materialized (
    select public.current_organization_id() as organization_id
  ), time_by_task as materialized (
    select entry.task_id,sum(entry.minutes)::bigint as actual
    from viewer join public.wrike_time_entries entry on entry.organization_id=viewer.organization_id
    where not entry.is_deleted
      and (not (filters ? 'categoryIds') or entry.category in (select jsonb_array_elements_text(filters->'categoryIds')))
      and (coalesce(filters->>'dateField','due')<>'tracked' or not (filters ? 'from') or entry.entry_date>=(filters->>'from')::date)
      and (coalesce(filters->>'dateField','due')<>'tracked' or not (filters ? 'to') or entry.entry_date<=(filters->>'to')::date)
    group by entry.task_id
  ), candidates as materialized (
    select task.id,task.planned_minutes,coalesce(time_by_task.actual,0)::bigint as actual
    from viewer join public.wrike_tasks task on task.organization_id=viewer.organization_id
    left join time_by_task on time_by_task.task_id=task.id
    where not task.is_deleted
      and (not (filters ? 'taskIds') or task.id::text in (select jsonb_array_elements_text(filters->'taskIds')))
      and (not (filters ? 'q') or task.title ilike '%'||(filters->>'q')||'%' or coalesce(task.description,'') ilike '%'||(filters->>'q')||'%' or public.matches_reporting_normalized_custom_search(task.id,filters->>'q'))
      and (not (filters ? 'statuses') or public.matches_reporting_status(task.organization_id,task.status,task.custom_status_id,filters->'statuses'))
      and (not (filters ? 'state') or case filters->>'state' when 'completed' then task.completed_at is not null or lower(task.status)='completed' when 'cancelled' then lower(task.status)='cancelled' when 'open' then task.completed_at is null and lower(task.status) in ('active','deferred') when 'overdue' then task.completed_at is null and lower(task.status) in ('active','deferred') and task.due_date<current_date else true end)
      and (coalesce(filters->>'dateField','due')='tracked' or not (filters ? 'from') or case coalesce(filters->>'dateField','due') when 'start' then task.start_date when 'created' then task.created_at_wrike::date when 'completed' then task.completed_at::date else task.due_date end >=(filters->>'from')::date)
      and (coalesce(filters->>'dateField','due')='tracked' or not (filters ? 'to') or case coalesce(filters->>'dateField','due') when 'start' then task.start_date when 'created' then task.created_at_wrike::date when 'completed' then task.completed_at::date else task.due_date end <=(filters->>'to')::date)
      and (not (filters ? 'assigneeIds') or exists(select 1 from public.wrike_task_assignees assignee where assignee.task_id=task.id and assignee.user_id::text in (select jsonb_array_elements_text(filters->'assigneeIds'))))
      and (not (filters ? 'scopeIds') or exists(select 1 from public.wrike_scope_tasks scoped_task where scoped_task.task_id=task.id and scoped_task.scope_id::text in (select jsonb_array_elements_text(filters->'scopeIds'))))
      and (not (filters ? 'folderIds') or exists(select 1 from public.wrike_task_locations location where location.task_id=task.id and location.folder_id::text in (select jsonb_array_elements_text(filters->'folderIds'))))
      and (not (filters ? 'projectIds') or exists(select 1 from public.wrike_task_locations location where location.task_id=task.id and location.project_id::text in (select jsonb_array_elements_text(filters->'projectIds'))))
      and (not (filters ? 'customFields') or public.matches_reporting_normalized_custom_fields(task.id,filters->'customFields'))
  )
  select candidate.id,candidate.actual
  from candidates candidate
  where (coalesce(filters->>'dateField','due')<>'tracked' or (not (filters ? 'from') and not (filters ? 'to')) or candidate.actual>0)
    and (not (filters ? 'categoryIds') or candidate.actual>0)
    and (not (filters ? 'timeState') or case filters->>'timeState' when 'with-time' then candidate.actual>0 when 'no-time' then candidate.actual=0 else true end)
    and (not (filters ? 'minMinutes') or candidate.actual>=(filters->>'minMinutes')::bigint)
    and (not (filters ? 'maxMinutes') or candidate.actual<=(filters->>'maxMinutes')::bigint)
    and (not (filters ? 'minPlannedMinutes') or coalesce(candidate.planned_minutes,0)>=(filters->>'minPlannedMinutes')::integer)
    and (not (filters ? 'maxPlannedMinutes') or coalesce(candidate.planned_minutes,0)<=(filters->>'maxPlannedMinutes')::integer);
$$;

revoke all on function public.reporting_filtered_tasks_without_dashboard_drilldown(jsonb) from public;

-- Row and summary RPCs use the organization-scoped task/entry sets directly.
alter function public.reporting_task_rows(jsonb,integer,integer) security definer;
revoke all on function public.reporting_task_rows(jsonb,integer,integer) from public;
grant execute on function public.reporting_task_rows(jsonb,integer,integer) to authenticated,service_role;

create or replace function public.reporting_time_rows(filters jsonb default '{}'::jsonb,result_limit integer default 50,result_offset integer default 0)
returns table (entry_id uuid,entry_date date,minutes integer,category text,comment text,task_id uuid,task_title text,task_status text,user_id uuid,user_name text,total_count bigint)
language sql stable security definer set search_path=public as $$
  with viewer as materialized (select public.current_organization_id() as organization_id)
  select entry.id,entry.entry_date,entry.minutes,entry.category,entry.comment,task.id,task.title,task.status,
    wrike_user.id,wrike_user.display_name,count(*) over()
  from viewer
  join public.wrike_time_entries entry on entry.organization_id=viewer.organization_id
  join public.wrike_tasks task on task.id=entry.task_id and task.organization_id=viewer.organization_id
  left join public.wrike_users wrike_user on wrike_user.id=entry.user_id and wrike_user.organization_id=viewer.organization_id
  where not entry.is_deleted and not task.is_deleted
    and (not (filters ? 'taskIds') or task.id::text in (select jsonb_array_elements_text(filters->'taskIds')))
    and (not (filters ? 'q') or task.title ilike '%'||(filters->>'q')||'%' or coalesce(entry.comment,'') ilike '%'||(filters->>'q')||'%' or public.matches_reporting_normalized_custom_search(task.id,filters->>'q'))
    and (not (filters ? 'from') or case coalesce(filters->>'dateField','tracked') when 'due' then task.due_date when 'start' then task.start_date when 'created' then task.created_at_wrike::date when 'completed' then task.completed_at::date else entry.entry_date end >=(filters->>'from')::date)
    and (not (filters ? 'to') or case coalesce(filters->>'dateField','tracked') when 'due' then task.due_date when 'start' then task.start_date when 'created' then task.created_at_wrike::date when 'completed' then task.completed_at::date else entry.entry_date end <=(filters->>'to')::date)
    and (not (filters ? 'statuses') or public.matches_reporting_status(task.organization_id,task.status,task.custom_status_id,filters->'statuses'))
    and (not (filters ? 'state') or case filters->>'state' when 'completed' then task.completed_at is not null or lower(task.status)='completed' when 'cancelled' then lower(task.status)='cancelled' when 'open' then task.completed_at is null and lower(task.status) in ('active','deferred') when 'overdue' then task.completed_at is null and lower(task.status) in ('active','deferred') and task.due_date<current_date else true end)
    and (not (filters ? 'assigneeIds') or entry.user_id::text in (select jsonb_array_elements_text(filters->'assigneeIds')))
    and (not (filters ? 'categoryIds') or entry.category in (select jsonb_array_elements_text(filters->'categoryIds')))
    and (not (filters ? 'scopeIds') or exists(select 1 from public.wrike_scope_tasks scoped_task where scoped_task.task_id=task.id and scoped_task.scope_id::text in (select jsonb_array_elements_text(filters->'scopeIds'))))
    and (not (filters ? 'folderIds') or exists(select 1 from public.wrike_task_locations location where location.task_id=task.id and location.folder_id::text in (select jsonb_array_elements_text(filters->'folderIds'))))
    and (not (filters ? 'projectIds') or exists(select 1 from public.wrike_task_locations location where location.task_id=task.id and location.project_id::text in (select jsonb_array_elements_text(filters->'projectIds'))))
    and (not (filters ? 'customFields') or public.matches_reporting_normalized_custom_fields(task.id,filters->'customFields'))
    and (not (filters ? 'timeState') or filters->>'timeState'<>'no-time')
    and (not (filters ? 'minMinutes') or entry.minutes>=(filters->>'minMinutes')::integer)
    and (not (filters ? 'maxMinutes') or entry.minutes<=(filters->>'maxMinutes')::integer)
    and (not (filters ? 'minPlannedMinutes') or coalesce(task.planned_minutes,0)>=(filters->>'minPlannedMinutes')::integer)
    and (not (filters ? 'maxPlannedMinutes') or coalesce(task.planned_minutes,0)<=(filters->>'maxPlannedMinutes')::integer)
  order by case when filters->>'sort'='title' then lower(task.title) end asc,
    case when filters->>'sort'='due' then task.due_date end asc nulls last,
    case when filters->>'sort'='actual' then entry.minutes end desc,entry.entry_date desc,entry.id
  limit greatest(1,least(result_limit,200)) offset greatest(0,result_offset);
$$;

create or replace function public.reporting_time_summary(filters jsonb default '{}'::jsonb,group_by text default 'total')
returns table (group_key text,label text,minutes bigint,entry_count bigint)
language sql stable security definer set search_path=public as $$
  with viewer as materialized (select public.current_organization_id() as organization_id), visible as materialized (
    select entry.*,task.title as task_title,coalesce(status_ref.title,task.custom_status_id,task.status) as task_status,
      coalesce(wrike_user.display_name,entry.user_wrike_id) as user_name,
      (select project.title from public.wrike_task_locations location join public.wrike_projects project on project.id=location.project_id where location.task_id=task.id order by project.title limit 1) as project_title,
      (select array_to_string(value.display_values,', ') from public.wrike_task_normalized_custom_field_values value where value.task_id=task.id and value.normalized_field_id::text=filters->>'groupCustomFieldId') as custom_group
    from viewer
    join public.wrike_time_entries entry on entry.organization_id=viewer.organization_id
    join public.wrike_tasks task on task.id=entry.task_id and task.organization_id=viewer.organization_id
    left join public.wrike_users wrike_user on wrike_user.id=entry.user_id and wrike_user.organization_id=viewer.organization_id
    left join public.wrike_workflow_statuses status_ref on status_ref.organization_id=viewer.organization_id and status_ref.wrike_id=task.custom_status_id
    where not entry.is_deleted and not task.is_deleted
      and (not (filters ? 'taskIds') or task.id::text in (select jsonb_array_elements_text(filters->'taskIds')))
      and (not (filters ? 'q') or task.title ilike '%'||(filters->>'q')||'%' or coalesce(entry.comment,'') ilike '%'||(filters->>'q')||'%' or public.matches_reporting_normalized_custom_search(task.id,filters->>'q'))
      and (not (filters ? 'from') or case coalesce(filters->>'dateField','tracked') when 'due' then task.due_date when 'start' then task.start_date when 'created' then task.created_at_wrike::date when 'completed' then task.completed_at::date else entry.entry_date end >=(filters->>'from')::date)
      and (not (filters ? 'to') or case coalesce(filters->>'dateField','tracked') when 'due' then task.due_date when 'start' then task.start_date when 'created' then task.created_at_wrike::date when 'completed' then task.completed_at::date else entry.entry_date end <=(filters->>'to')::date)
      and (not (filters ? 'statuses') or public.matches_reporting_status(task.organization_id,task.status,task.custom_status_id,filters->'statuses'))
      and (not (filters ? 'state') or case filters->>'state' when 'completed' then task.completed_at is not null or lower(task.status)='completed' when 'cancelled' then lower(task.status)='cancelled' when 'open' then task.completed_at is null and lower(task.status) in ('active','deferred') when 'overdue' then task.completed_at is null and lower(task.status) in ('active','deferred') and task.due_date<current_date else true end)
      and (not (filters ? 'assigneeIds') or entry.user_id::text in (select jsonb_array_elements_text(filters->'assigneeIds')))
      and (not (filters ? 'categoryIds') or entry.category in (select jsonb_array_elements_text(filters->'categoryIds')))
      and (not (filters ? 'scopeIds') or exists(select 1 from public.wrike_scope_tasks scoped_task where scoped_task.task_id=task.id and scoped_task.scope_id::text in (select jsonb_array_elements_text(filters->'scopeIds'))))
      and (not (filters ? 'folderIds') or exists(select 1 from public.wrike_task_locations location where location.task_id=task.id and location.folder_id::text in (select jsonb_array_elements_text(filters->'folderIds'))))
      and (not (filters ? 'projectIds') or exists(select 1 from public.wrike_task_locations location where location.task_id=task.id and location.project_id::text in (select jsonb_array_elements_text(filters->'projectIds'))))
      and (not (filters ? 'customFields') or public.matches_reporting_normalized_custom_fields(task.id,filters->'customFields'))
      and (not (filters ? 'timeState') or filters->>'timeState'<>'no-time')
      and (not (filters ? 'minMinutes') or entry.minutes>=(filters->>'minMinutes')::integer)
      and (not (filters ? 'maxMinutes') or entry.minutes<=(filters->>'maxMinutes')::integer)
      and (not (filters ? 'minPlannedMinutes') or coalesce(task.planned_minutes,0)>=(filters->>'minPlannedMinutes')::integer)
      and (not (filters ? 'maxPlannedMinutes') or coalesce(task.planned_minutes,0)<=(filters->>'maxPlannedMinutes')::integer)
  ), grouped as (
    select case group_by when 'person' then coalesce(user_id::text,user_wrike_id,'unknown') when 'task' then task_id::text when 'status' then task_status when 'project' then coalesce(project_title,'No project') when 'day' then entry_date::text when 'week' then date_trunc('week',entry_date)::date::text when 'month' then to_char(entry_date,'YYYY-MM') when 'custom' then coalesce(custom_group,'Not set') else 'total' end as key,
      case group_by when 'person' then coalesce(user_name,user_wrike_id,'Unknown') when 'task' then task_title when 'status' then task_status when 'project' then coalesce(project_title,'No project') when 'day' then entry_date::text when 'week' then date_trunc('week',entry_date)::date::text when 'month' then to_char(entry_date,'YYYY-MM') when 'custom' then coalesce(custom_group,'Not set') else 'Total' end as display,
      visible.minutes from visible
  )
  select key,display,sum(grouped.minutes)::bigint,count(*)::bigint
  from grouped group by key,display order by sum(grouped.minutes) desc,display limit 200;
$$;

revoke all on function public.reporting_time_rows(jsonb,integer,integer) from public;
revoke all on function public.reporting_time_summary(jsonb,text) from public;
grant execute on function public.reporting_time_rows(jsonb,integer,integer) to authenticated,service_role;
grant execute on function public.reporting_time_summary(jsonb,text) to authenticated,service_role;

create or replace function public.reporting_custom_field_options()
returns table (normalized_field_id uuid,normalized_title text,value text)
language sql stable security definer set search_path=public as $$
  with viewer as materialized (select public.current_organization_id() as organization_id),
  visible_tasks as materialized (
    select task.id from viewer join public.wrike_tasks task on task.organization_id=viewer.organization_id where not task.is_deleted
  ), enabled_fields as materialized (
    select field.id,field.title
    from viewer join public.wrike_normalized_custom_fields field on field.organization_id=viewer.organization_id
    where exists(select 1 from public.wrike_normalized_custom_field_sources source
      join public.wrike_enabled_custom_fields enabled on enabled.custom_field_id=source.custom_field_id and enabled.organization_id=viewer.organization_id
      where source.normalized_field_id=field.id)
  )
  select field.id,field.title,observed.value
  from enabled_fields field
  join public.wrike_task_normalized_custom_field_values task_value on task_value.normalized_field_id=field.id
  join visible_tasks task on task.id=task_value.task_id
  cross join lateral unnest(task_value.display_values) observed(value)
  where trim(observed.value)<>''
  group by field.id,field.title,observed.value order by field.title,observed.value;
$$;

revoke all on function public.reporting_custom_field_options() from public;
grant execute on function public.reporting_custom_field_options() to authenticated,service_role;

create or replace function public.reporting_online_learning_dashboard_tasks()
returns table (
  task_id uuid,organization_id uuid,reporting_year integer,custom_status_id text,due_date date,
  status_name text,status_color text,dashboard_classification text
)
language sql stable security definer set search_path=public as $$
  with viewer as materialized (select public.current_organization_id() as organization_id)
  select task.id,task.organization_id,reporting.reporting_year,task.custom_status_id,task.due_date,
    coalesce(status_ref.title,task.custom_status_id,task.status,'Unidentified'),status_ref.color,status_ref.dashboard_classification
  from viewer
  join public.wrike_tasks task on task.organization_id=viewer.organization_id
  left join public.wrike_workflow_statuses status_ref on status_ref.organization_id=viewer.organization_id and status_ref.wrike_id=task.custom_status_id
  join public.wrike_normalized_custom_fields reporting_field on reporting_field.organization_id=viewer.organization_id and reporting_field.normalized_key='reporting'
  join public.wrike_task_normalized_custom_field_values reporting on reporting.task_id=task.id and reporting.normalized_field_id=reporting_field.id
  where not task.is_deleted
    and (task.workflow_id='IEACHQK7K4BHMLHM' or status_ref.workflow_id='IEACHQK7K4BHMLHM')
    and reporting.reporting_year is not null and not reporting.has_conflict;
$$;

create or replace function public.reporting_online_learning_dashboard_time_v4()
returns jsonb language sql stable security definer set search_path=public as $$
  with viewer as materialized (select public.current_organization_id() as organization_id), completed as materialized (
    select source.task_id,source.reporting_year from public.reporting_online_learning_dashboard_tasks() source
    where source.dashboard_classification='completed'
  ), time_by_task as materialized (
    select completed.task_id,completed.reporting_year,coalesce(sum(entry.minutes),0)::bigint as minutes
    from completed
    left join public.wrike_time_entries entry on entry.task_id=completed.task_id
      and entry.organization_id=(select organization_id from viewer) and not entry.is_deleted
    group by completed.task_id,completed.reporting_year
  ), year_time as (
    select reporting_year,count(*)::bigint as project_count,coalesce(sum(minutes),0)::bigint as total_minutes,
      round(avg(minutes)::numeric,2) as average_minutes from time_by_task group by reporting_year
  ), sync_state as (
    select exists(select 1 from public.wrike_folder_task_import_runs run
      where run.organization_id=(select organization_id from viewer) and run.status='succeeded') as synchronized
  )
  select jsonb_build_object(
    'timeDataSynchronized',(select synchronized from sync_state),
    'averageTimeByReportingYear',case when (select synchronized from sync_state) then coalesce((select jsonb_agg(jsonb_build_object(
      'label',reporting_year::text,'sortYear',reporting_year,'projectCount',project_count,
      'totalMinutes',total_minutes,'averageMinutes',average_minutes,'timeDataSynchronized',true
    ) order by reporting_year) from year_time),'[]'::jsonb) else '[]'::jsonb end
  );
$$;

-- Overview v4 is already sourced exclusively from the organization-scoped
-- dashboard task RPC. Re-assert SECURITY DEFINER so all nested reads share it.
alter function public.reporting_online_learning_dashboard_overview_v4() security definer;

revoke all on function public.reporting_online_learning_dashboard_tasks() from public;
revoke all on function public.reporting_online_learning_dashboard_overview_v4() from public;
revoke all on function public.reporting_online_learning_dashboard_time_v4() from public;
grant execute on function public.reporting_online_learning_dashboard_overview_v4() to authenticated,service_role;
grant execute on function public.reporting_online_learning_dashboard_time_v4() to authenticated,service_role;

create or replace function public.reporting_development_filtered_tasks(filters jsonb default '{}'::jsonb)
returns table (task_id uuid,actual_minutes bigint)
language sql stable security definer set search_path=public as $$
  with viewer as materialized (select public.current_organization_id() as organization_id), candidates as materialized (
    select task.id
    from viewer join public.wrike_tasks task on task.organization_id=viewer.organization_id
    left join public.wrike_workflow_statuses status_ref on status_ref.organization_id=viewer.organization_id and status_ref.wrike_id=task.custom_status_id
    left join public.wrike_normalized_custom_fields reporting_field on reporting_field.organization_id=viewer.organization_id and reporting_field.normalized_key='reporting'
    left join public.wrike_task_normalized_custom_field_values reporting on reporting.task_id=task.id and reporting.normalized_field_id=reporting_field.id
    where not task.is_deleted
      and (task.workflow_id='IEACHQK7K4BHMLHM' or status_ref.workflow_id='IEACHQK7K4BHMLHM')
      and case coalesce(filters->>'reportingYearMode','year') when 'missing' then reporting.task_id is null or reporting.reporting_year is null or reporting.has_conflict else reporting.reporting_year=(filters->>'reportingYear')::integer and not reporting.has_conflict end
      and (not (filters ? 'q') or task.title ilike '%'||(filters->>'q')||'%' or coalesce(task.description,'') ilike '%'||(filters->>'q')||'%' or public.matches_reporting_normalized_custom_search(task.id,filters->>'q'))
      and (not (filters ? 'completionClassification') or case filters->>'completionClassification' when 'completed' then status_ref.dashboard_classification='completed' when 'incomplete' then status_ref.dashboard_classification is distinct from 'completed' else true end)
      and (not (filters ? 'developmentStatus') or case filters->>'developmentStatus' when '__unknown__' then status_ref.wrike_id is null or status_ref.is_unresolved else task.custom_status_id=filters->>'developmentStatus' end)
      and (not (filters ? 'assigneeIds') or exists(select 1 from public.wrike_task_assignees assignee where assignee.task_id=task.id and assignee.user_id::text in (select jsonb_array_elements_text(filters->'assigneeIds'))))
      and (not (filters ? 'folderIds') or exists(select 1 from public.wrike_task_locations location where location.task_id=task.id and location.folder_id::text in (select jsonb_array_elements_text(filters->'folderIds'))))
      and (not (filters ? 'projectIds') or exists(select 1 from public.wrike_task_locations location where location.task_id=task.id and location.project_id::text in (select jsonb_array_elements_text(filters->'projectIds'))))
      and (not (filters ? 'customFields') or public.matches_reporting_normalized_custom_fields(task.id,filters->'customFields'))
      and public.matches_reporting_vertical_filters(task.id,filters)
      and (not (filters ? 'priority') or lower(coalesce(task.importance,''))=lower(filters->>'priority'))
      and (not (filters ? 'dueFrom') or task.due_date>=(filters->>'dueFrom')::date)
      and (not (filters ? 'dueTo') or task.due_date<=(filters->>'dueTo')::date)
      and (not (filters ? 'completedFrom') or task.completed_at::date>=(filters->>'completedFrom')::date)
      and (not (filters ? 'completedTo') or task.completed_at::date<=(filters->>'completedTo')::date)
      and (not coalesce((filters->>'unresolvedOnly')::boolean,false) or status_ref.wrike_id is null or status_ref.is_unresolved or coalesce(reporting.has_conflict,false)
        or exists(select 1 from public.wrike_task_custom_field_values raw_value where raw_value.task_id=task.id and not raw_value.resolved)
        or exists(select 1 from public.wrike_task_normalized_custom_field_values normalized where normalized.task_id=task.id and normalized.has_conflict)
        or exists(select 1 from public.wrike_task_locations location where location.task_id=task.id and location.folder_id is null and location.project_id is null))
  ), time_by_task as materialized (
    select candidate.id,coalesce(sum(entry.minutes) filter(where entry.id is not null and not entry.is_deleted),0)::bigint as minutes
    from candidates candidate
    left join public.wrike_time_entries entry on entry.task_id=candidate.id and entry.organization_id=(select organization_id from viewer)
    group by candidate.id
  )
  select time_by_task.id,time_by_task.minutes from time_by_task
  where not (filters ? 'timeState') or case filters->>'timeState' when 'with-time' then minutes>0 when 'no-time' then minutes=0 else true end;
$$;

create or replace function public.reporting_development_year_options()
returns table (reporting_year integer,project_count bigint,missing_count bigint)
language sql stable security definer set search_path=public as $$
  with viewer as materialized (select public.current_organization_id() as organization_id), scoped as materialized (
    select task.id,reporting.reporting_year,coalesce(reporting.has_conflict,false) as has_conflict
    from viewer join public.wrike_tasks task on task.organization_id=viewer.organization_id
    left join public.wrike_workflow_statuses status_ref on status_ref.organization_id=viewer.organization_id and status_ref.wrike_id=task.custom_status_id
    left join public.wrike_normalized_custom_fields reporting_field on reporting_field.organization_id=viewer.organization_id and reporting_field.normalized_key='reporting'
    left join public.wrike_task_normalized_custom_field_values reporting on reporting.task_id=task.id and reporting.normalized_field_id=reporting_field.id
    where not task.is_deleted and (task.workflow_id='IEACHQK7K4BHMLHM' or status_ref.workflow_id='IEACHQK7K4BHMLHM')
  ), missing as (select count(*)::bigint as count from scoped where reporting_year is null or has_conflict)
  select scoped.reporting_year,count(*)::bigint,(select count from missing)
  from scoped where reporting_year is not null and not has_conflict group by scoped.reporting_year
  union all select null::integer,0::bigint,(select count from missing)
    where not exists(select 1 from scoped where reporting_year is not null and not has_conflict)
  order by reporting_year desc nulls last;
$$;

revoke all on function public.reporting_development_filtered_tasks(jsonb) from public;
revoke all on function public.reporting_development_year_options() from public;
grant execute on function public.reporting_development_filtered_tasks(jsonb) to authenticated,service_role;
grant execute on function public.reporting_development_year_options() to authenticated,service_role;

create or replace function public.reporting_project_length_percentiles(target_task_ids uuid[])
returns table (
  task_id uuid,length_minutes integer,target_minutes bigint,cohort_average_minutes numeric,
  cohort_size bigint,lower_count bigint,tie_count bigint
)
language sql stable security definer set search_path=public as $$
  with requested as materialized (
    select distinct requested_id as task_id
    from unnest(coalesce(target_task_ids[1:200],'{}'::uuid[])) requested_id
  ), viewer as materialized (
    select public.current_organization_id() as organization_id
  ), visible_tasks as materialized (
    select task.id
    from viewer join public.wrike_tasks task on task.organization_id=viewer.organization_id
    where not task.is_deleted and task.custom_fields_sync_state='complete'
  ), course_length_fields as materialized (
    select field.id from viewer join public.wrike_normalized_custom_fields field on field.organization_id=viewer.organization_id
    where field.normalized_key in ('course length','course duration','estimated course length')
  ), length_values as materialized (
    select task.id as task_id,array_agg(item.value order by item.value) as source_values
    from visible_tasks task
    join public.wrike_task_normalized_custom_field_values field_value on field_value.task_id=task.id
    join course_length_fields field on field.id=field_value.normalized_field_id
    cross join lateral unnest(field_value.display_values) item(value)
    group by task.id
  ), courses as materialized (
    select task_id,public.wrike_course_length_minutes(source_values) as length_minutes from length_values
  ), requested_lengths as materialized (
    select distinct course.length_minutes from courses course join requested on requested.task_id=course.task_id
    where course.length_minutes is not null
  ), comparable as materialized (
    select course.task_id,course.length_minutes from courses course
    join requested_lengths requested_length on requested_length.length_minutes=course.length_minutes
  ), time_by_task as materialized (
    select comparable.task_id,comparable.length_minutes,
      coalesce(sum(entry.minutes) filter(where entry.id is not null and not entry.is_deleted and entry.minutes>=0),0)::bigint as minutes
    from comparable
    left join public.wrike_time_entries entry on entry.task_id=comparable.task_id
      and entry.organization_id=(select organization_id from viewer)
    group by comparable.task_id,comparable.length_minutes
  ), ranked as materialized (
    select time_by_task.*,
      round(avg(minutes) over(partition by length_minutes)::numeric,2) as cohort_average_minutes,
      count(*) over(partition by length_minutes)::bigint as cohort_size,
      (rank() over(partition by length_minutes order by minutes)-1)::bigint as lower_count,
      count(*) over(partition by length_minutes,minutes)::bigint as tie_count
    from time_by_task
  )
  select ranked.task_id,ranked.length_minutes,ranked.minutes,ranked.cohort_average_minutes,
    ranked.cohort_size,ranked.lower_count,ranked.tie_count
  from ranked join requested on requested.task_id=ranked.task_id;
$$;

alter function public.reporting_project_length_percentile(uuid) security definer;
revoke all on function public.reporting_project_length_percentiles(uuid[]) from public;
revoke all on function public.reporting_project_length_percentile(uuid) from public;
grant execute on function public.reporting_project_length_percentiles(uuid[]) to authenticated,service_role;
grant execute on function public.reporting_project_length_percentile(uuid) to authenticated,service_role;

comment on function public.reporting_accessible_task_ids() is
  'Active synchronized task IDs for the authenticated user organization; reporting groups are not consulted.';
comment on function public.reporting_accessible_time_entry_ids() is
  'Active synchronized time-entry IDs for the authenticated user organization; reporting groups are not consulted.';
comment on function public.reporting_filtered_tasks_without_dashboard_drilldown(jsonb) is
  'Organization-wide set-based task filter used by reporting pages and dashboard drill-downs.';
comment on function public.reporting_project_length_percentiles(uuid[]) is
  'Same-length percentile cohorts for up to 200 tasks using all active reporting data in the authenticated user organization.';

select pg_notify('pgrst','reload schema');
