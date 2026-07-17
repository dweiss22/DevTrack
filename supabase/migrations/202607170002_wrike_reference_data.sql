-- Readable Wrike users, timelog categories, and selected workflow status reference data.

alter table public.wrike_connections
  add column if not exists oauth_scopes text[] not null default array['wsReadOnly']::text[];

alter table public.wrike_users
  add column if not exists title text,
  add column if not exists avatar_url text,
  add column if not exists timezone text,
  add column if not exists locale text,
  add column if not exists profiles jsonb not null default '[]'::jsonb,
  add column if not exists synced_at timestamptz;

alter table public.wrike_timelog_categories
  add column if not exists hidden boolean not null default false,
  add column if not exists sort_order integer,
  add column if not exists synced_at timestamptz;

create table if not exists public.wrike_workflows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  wrike_id text not null,
  name text not null,
  description text,
  hidden boolean not null default false,
  raw_data jsonb not null default '{}'::jsonb,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, wrike_id)
);

alter table public.wrike_workflow_statuses
  add column if not exists standard boolean,
  add column if not exists hidden boolean,
  add column if not exists color text,
  add column if not exists synced_at timestamptz;

alter table public.wrike_tasks
  add column if not exists responsible_wrike_ids text[] not null default '{}';

update public.wrike_tasks task
set responsible_wrike_ids = coalesce((
  select array_agg(value order by ordinal)
  from jsonb_array_elements_text(
    case when jsonb_typeof(task.raw_data->'responsibleIds') = 'array'
      then task.raw_data->'responsibleIds' else '[]'::jsonb end
  ) with ordinality as responsible(value, ordinal)
), '{}')
where task.responsible_wrike_ids = '{}';

alter table public.wrike_folder_task_import_runs
  add column if not exists reference_data_diagnostics jsonb not null default '{}'::jsonb,
  add column if not exists reference_warning_count integer not null default 0;

update public.wrike_users set synced_at=updated_at
where synced_at is null and raw_data->>'referenceSource' is distinct from 'configured_fallback';
update public.wrike_timelog_categories set synced_at=updated_at where synced_at is null;
update public.wrike_workflow_statuses set synced_at=updated_at where synced_at is null;

create index if not exists wrike_tasks_responsible_ids_idx on public.wrike_tasks using gin(responsible_wrike_ids);
create index if not exists wrike_workflow_statuses_workflow_idx on public.wrike_workflow_statuses(organization_id, workflow_id, wrike_id);

alter table public.wrike_workflows enable row level security;
drop policy if exists "workflow org read" on public.wrike_workflows;
create policy "workflow org read" on public.wrike_workflows for select
  using (organization_id = public.current_organization_id());
grant select on public.wrike_workflows to authenticated;
grant all on public.wrike_workflows to service_role;

comment on column public.wrike_connections.oauth_scopes is 'OAuth scopes recorded when the current Wrike connection was authorized.';
comment on column public.wrike_tasks.responsible_wrike_ids is 'Original ordered responsibleIds returned by Wrike; unresolved IDs are retained.';
comment on column public.wrike_folder_task_import_runs.reference_data_diagnostics is 'Safe counts and warnings for workflow, user, category, and readable-ID resolution.';

-- Keep existing reporting filter keys while returning readable status labels.
create or replace function public.reporting_task_status_summary(filters jsonb default '{}'::jsonb)
returns table (name text, tasks bigint)
language sql
stable
set search_path = public
as $$
  select coalesce(status_ref.title, t.custom_status_id, t.status), count(*)
  from public.reporting_filtered_tasks(filters) ft
  join public.wrike_tasks t on t.id=ft.task_id
  left join public.wrike_workflow_statuses status_ref
    on status_ref.organization_id=t.organization_id and status_ref.wrike_id=t.custom_status_id
  group by coalesce(status_ref.title, t.custom_status_id, t.status)
  order by count(*) desc, coalesce(status_ref.title, t.custom_status_id, t.status);
$$;

create or replace function public.reporting_time_summary(
  filters jsonb default '{}'::jsonb,
  group_by text default 'total'
)
returns table (group_key text, label text, minutes bigint, entry_count bigint)
language sql
stable
set search_path = public
as $$
  with visible as (
    select e.*, t.title as task_title,
      coalesce(status_ref.title,t.custom_status_id,t.status) as task_status,
      coalesce(u.display_name,e.user_wrike_id) as user_name,
      (select p.title from public.wrike_task_locations l join public.wrike_projects p on p.id=l.project_id where l.task_id=t.id order by p.title limit 1) as project_title,
      (select cv.text_value from public.wrike_task_custom_field_values cv where cv.task_id=t.id and cv.custom_field_id::text=filters->>'groupCustomFieldId' limit 1) as custom_group
    from public.wrike_time_entries e
    join public.wrike_tasks t on t.id=e.task_id
    left join public.wrike_users u on u.id=e.user_id
    left join public.wrike_workflow_statuses status_ref on status_ref.organization_id=t.organization_id and status_ref.wrike_id=t.custom_status_id
    where not e.is_deleted and not t.is_deleted and public.can_access_wrike_time_entry(e.id)
      and (not (filters ? 'taskIds') or t.id::text in (select jsonb_array_elements_text(filters->'taskIds')))
      and (not (filters ? 'q') or t.title ilike '%' || (filters->>'q') || '%' or coalesce(e.comment,'') ilike '%' || (filters->>'q') || '%')
      and (not (filters ? 'from') or case coalesce(filters->>'dateField','tracked') when 'due' then t.due_date when 'start' then t.start_date when 'created' then t.created_at_wrike::date when 'completed' then t.completed_at::date else e.entry_date end >= (filters->>'from')::date)
      and (not (filters ? 'to') or case coalesce(filters->>'dateField','tracked') when 'due' then t.due_date when 'start' then t.start_date when 'created' then t.created_at_wrike::date when 'completed' then t.completed_at::date else e.entry_date end <= (filters->>'to')::date)
      and (not (filters ? 'statuses') or public.matches_reporting_status(t.organization_id,t.status,t.custom_status_id,filters->'statuses'))
      and (not (filters ? 'state') or case filters->>'state'
        when 'completed' then t.completed_at is not null or lower(t.status)='completed'
        when 'cancelled' then lower(t.status)='cancelled'
        when 'open' then t.completed_at is null and lower(t.status) in ('active','deferred')
        when 'overdue' then t.completed_at is null and lower(t.status) in ('active','deferred') and t.due_date < current_date
        else true end)
      and (not (filters ? 'assigneeIds') or e.user_id::text in (select jsonb_array_elements_text(filters->'assigneeIds')))
      and (not (filters ? 'categoryIds') or e.category in (select jsonb_array_elements_text(filters->'categoryIds')))
      and (not (filters ? 'scopeIds') or exists(select 1 from public.wrike_scope_tasks st where st.task_id=t.id and st.scope_id::text in (select jsonb_array_elements_text(filters->'scopeIds'))))
      and (not (filters ? 'folderIds') or exists(select 1 from public.wrike_task_locations l where l.task_id=t.id and l.folder_id::text in (select jsonb_array_elements_text(filters->'folderIds'))))
      and (not (filters ? 'projectIds') or exists(select 1 from public.wrike_task_locations l where l.task_id=t.id and l.project_id::text in (select jsonb_array_elements_text(filters->'projectIds'))))
      and (not (filters ? 'customFields') or not exists (
        select 1 from jsonb_each_text(filters->'customFields') requested where not exists (
          select 1 from public.wrike_task_custom_field_values cv where cv.task_id=t.id and cv.custom_field_id::text=requested.key
            and coalesce(cv.text_value,cv.numeric_value::text,cv.date_value::text,array_to_string(cv.option_ids,','),'') ilike '%' || requested.value || '%'
        )
      ))
      and (not (filters ? 'timeState') or filters->>'timeState' <> 'no-time')
      and (not (filters ? 'minMinutes') or e.minutes >= (filters->>'minMinutes')::integer)
      and (not (filters ? 'maxMinutes') or e.minutes <= (filters->>'maxMinutes')::integer)
      and (not (filters ? 'minPlannedMinutes') or coalesce(t.planned_minutes,0) >= (filters->>'minPlannedMinutes')::integer)
      and (not (filters ? 'maxPlannedMinutes') or coalesce(t.planned_minutes,0) <= (filters->>'maxPlannedMinutes')::integer)
  ), grouped as (
    select case group_by
      when 'person' then coalesce(user_id::text,user_wrike_id,'unknown')
      when 'task' then task_id::text when 'status' then task_status
      when 'project' then coalesce(project_title,'No project') when 'day' then entry_date::text
      when 'week' then date_trunc('week',entry_date)::date::text when 'month' then to_char(entry_date,'YYYY-MM')
      when 'custom' then coalesce(custom_group,'Not set') else 'total' end as key,
    case group_by
      when 'person' then coalesce(user_name,user_wrike_id,'Unknown') when 'task' then task_title when 'status' then task_status
      when 'project' then coalesce(project_title,'No project') when 'day' then entry_date::text
      when 'week' then date_trunc('week',entry_date)::date::text when 'month' then to_char(entry_date,'YYYY-MM')
      when 'custom' then coalesce(custom_group,'Not set') else 'Total' end as display,
    minutes from visible
  )
  select key, display, sum(grouped.minutes)::bigint, count(*)::bigint
  from grouped group by key, display order by sum(grouped.minutes) desc, display limit 200;
$$;
