-- Logical custom fields derived from authoritative Wrike field IDs and values.

create table public.wrike_normalized_custom_fields (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  normalized_key text not null,
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, normalized_key)
);

create table public.wrike_normalized_custom_field_sources (
  normalized_field_id uuid not null references public.wrike_normalized_custom_fields(id) on delete cascade,
  custom_field_id uuid not null unique references public.wrike_custom_fields(id) on delete cascade,
  source_designation text check (source_designation in ('M','L')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (normalized_field_id, custom_field_id)
);

create table public.wrike_task_normalized_custom_field_values (
  task_id uuid not null references public.wrike_tasks(id) on delete cascade,
  normalized_field_id uuid not null references public.wrike_normalized_custom_fields(id) on delete cascade,
  display_values text[] not null default '{}',
  source_wrike_field_ids text[] not null default '{}',
  source_titles text[] not null default '{}',
  source_values jsonb not null default '[]'::jsonb,
  has_conflict boolean not null default false,
  conflict_metadata jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (task_id, normalized_field_id)
);

alter table public.wrike_folder_task_import_runs
  add column custom_field_conflict_count integer not null default 0,
  add column custom_field_normalization_diagnostics jsonb not null default '{}'::jsonb;

create index wrike_normalized_custom_fields_org_idx on public.wrike_normalized_custom_fields(organization_id, title);
create index wrike_normalized_sources_field_idx on public.wrike_normalized_custom_field_sources(custom_field_id, normalized_field_id);
create index wrike_task_normalized_values_field_idx on public.wrike_task_normalized_custom_field_values(normalized_field_id, task_id);
create index wrike_task_normalized_values_display_idx on public.wrike_task_normalized_custom_field_values using gin(display_values);

alter table public.wrike_normalized_custom_fields enable row level security;
alter table public.wrike_normalized_custom_field_sources enable row level security;
alter table public.wrike_task_normalized_custom_field_values enable row level security;

create policy "normalized custom fields org read" on public.wrike_normalized_custom_fields for select
  using (organization_id=public.current_organization_id());
create policy "normalized custom field sources org read" on public.wrike_normalized_custom_field_sources for select
  using (exists(select 1 from public.wrike_normalized_custom_fields field where field.id=normalized_field_id and field.organization_id=public.current_organization_id()));
create policy "normalized task custom values scoped read" on public.wrike_task_normalized_custom_field_values for select
  using (public.can_access_wrike_task(task_id));

grant select on public.wrike_normalized_custom_fields, public.wrike_normalized_custom_field_sources, public.wrike_task_normalized_custom_field_values to authenticated;
grant all on public.wrike_normalized_custom_fields, public.wrike_normalized_custom_field_sources, public.wrike_task_normalized_custom_field_values to service_role;

create or replace function public.matches_reporting_normalized_custom_fields(target_task_id uuid, requested jsonb)
returns boolean language sql stable set search_path=public as $$
  select requested is null or not exists (
    select 1 from jsonb_each_text(requested) wanted
    where not exists (
      select 1 from public.wrike_task_normalized_custom_field_values value
      where value.task_id=target_task_id
        and value.normalized_field_id::text=wanted.key
        and wanted.value=any(value.display_values)
    )
  );
$$;

create or replace function public.matches_reporting_normalized_custom_search(target_task_id uuid, query text)
returns boolean language sql stable set search_path=public as $$
  select exists (
    select 1
    from public.wrike_task_normalized_custom_field_values value
    join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
    where value.task_id=target_task_id
      and (field.title ilike '%' || query || '%' or exists(select 1 from unnest(value.display_values) item where item ilike '%' || query || '%'))
  );
$$;

create or replace function public.reporting_custom_field_options()
returns table (normalized_field_id uuid, normalized_title text, value text)
language sql stable set search_path=public as $$
  select distinct field.id, field.title, observed.value
  from public.wrike_normalized_custom_fields field
  join public.wrike_task_normalized_custom_field_values task_value on task_value.normalized_field_id=field.id
  join public.wrike_tasks task on task.id=task_value.task_id
  cross join lateral unnest(task_value.display_values) observed(value)
  where field.organization_id=public.current_organization_id()
    and not task.is_deleted
    and public.can_access_wrike_task(task.id)
    and exists (
      select 1 from public.wrike_normalized_custom_field_sources source
      join public.wrike_enabled_custom_fields enabled on enabled.custom_field_id=source.custom_field_id
      where source.normalized_field_id=field.id and enabled.organization_id=field.organization_id
    )
  order by field.title, observed.value;
$$;

grant execute on function public.reporting_custom_field_options() to authenticated, service_role;

create or replace function public.reporting_filtered_tasks(filters jsonb default '{}'::jsonb)
returns table (task_id uuid, visible_actual_minutes bigint)
language sql stable set search_path=public as $$
  with candidates as (
    select t.id as task_id,
      coalesce((select sum(e.minutes) from public.wrike_time_entries e
        where e.task_id=t.id and not e.is_deleted and public.can_access_wrike_time_entry(e.id)
          and (not (filters ? 'categoryIds') or e.category in (select jsonb_array_elements_text(filters->'categoryIds')))
          and (coalesce(filters->>'dateField','due') <> 'tracked' or not (filters ? 'from') or e.entry_date >= (filters->>'from')::date)
          and (coalesce(filters->>'dateField','due') <> 'tracked' or not (filters ? 'to') or e.entry_date <= (filters->>'to')::date)),0)::bigint as actual
    from public.wrike_tasks t
    where not t.is_deleted and public.can_access_wrike_task(t.id)
      and (not (filters ? 'taskIds') or t.id::text in (select jsonb_array_elements_text(filters->'taskIds')))
      and (not (filters ? 'q') or t.title ilike '%' || (filters->>'q') || '%' or coalesce(t.description,'') ilike '%' || (filters->>'q') || '%' or public.matches_reporting_normalized_custom_search(t.id,filters->>'q'))
      and (not (filters ? 'statuses') or public.matches_reporting_status(t.organization_id,t.status,t.custom_status_id,filters->'statuses'))
      and (not (filters ? 'state') or case filters->>'state'
        when 'completed' then t.completed_at is not null or lower(t.status)='completed'
        when 'cancelled' then lower(t.status)='cancelled'
        when 'open' then t.completed_at is null and lower(t.status) in ('active','deferred')
        when 'overdue' then t.completed_at is null and lower(t.status) in ('active','deferred') and t.due_date < current_date else true end)
      and (coalesce(filters->>'dateField','due')='tracked' or not (filters ? 'from') or case coalesce(filters->>'dateField','due') when 'start' then t.start_date when 'created' then t.created_at_wrike::date when 'completed' then t.completed_at::date else t.due_date end >= (filters->>'from')::date)
      and (coalesce(filters->>'dateField','due')='tracked' or not (filters ? 'to') or case coalesce(filters->>'dateField','due') when 'start' then t.start_date when 'created' then t.created_at_wrike::date when 'completed' then t.completed_at::date else t.due_date end <= (filters->>'to')::date)
      and (not (filters ? 'assigneeIds') or exists(select 1 from public.wrike_task_assignees a where a.task_id=t.id and a.user_id::text in (select jsonb_array_elements_text(filters->'assigneeIds'))))
      and (not (filters ? 'scopeIds') or exists(select 1 from public.wrike_scope_tasks st where st.task_id=t.id and st.scope_id::text in (select jsonb_array_elements_text(filters->'scopeIds'))))
      and (not (filters ? 'folderIds') or exists(select 1 from public.wrike_task_locations l where l.task_id=t.id and l.folder_id::text in (select jsonb_array_elements_text(filters->'folderIds'))))
      and (not (filters ? 'projectIds') or exists(select 1 from public.wrike_task_locations l where l.task_id=t.id and l.project_id::text in (select jsonb_array_elements_text(filters->'projectIds'))))
      and (not (filters ? 'customFields') or public.matches_reporting_normalized_custom_fields(t.id,filters->'customFields'))
  )
  select c.task_id,c.actual from candidates c
  where (coalesce(filters->>'dateField','due') <> 'tracked' or (not (filters ? 'from') and not (filters ? 'to')) or c.actual > 0)
    and (not (filters ? 'categoryIds') or c.actual > 0)
    and (not (filters ? 'timeState') or case filters->>'timeState' when 'with-time' then c.actual > 0 when 'no-time' then c.actual=0 else true end)
    and (not (filters ? 'minMinutes') or c.actual >= (filters->>'minMinutes')::bigint)
    and (not (filters ? 'maxMinutes') or c.actual <= (filters->>'maxMinutes')::bigint)
    and (not (filters ? 'minPlannedMinutes') or (select coalesce(t.planned_minutes,0) from public.wrike_tasks t where t.id=c.task_id) >= (filters->>'minPlannedMinutes')::integer)
    and (not (filters ? 'maxPlannedMinutes') or (select coalesce(t.planned_minutes,0) from public.wrike_tasks t where t.id=c.task_id) <= (filters->>'maxPlannedMinutes')::integer);
$$;

create or replace function public.reporting_task_rows(filters jsonb default '{}'::jsonb,result_limit integer default 50,result_offset integer default 0)
returns table (task_id uuid,title text,status text,custom_status_id text,due_date date,completed_at timestamptz,planned_minutes integer,actual_minutes bigint,updated_at_wrike timestamptz,assignees jsonb,locations jsonb,custom_values jsonb,total_count bigint)
language sql stable set search_path=public as $$
  with filtered as (select t.*,ft.visible_actual_minutes from public.reporting_filtered_tasks(filters) ft join public.wrike_tasks t on t.id=ft.task_id)
  select f.id,f.title,f.status,f.custom_status_id,f.due_date,f.completed_at,f.planned_minutes,f.visible_actual_minutes,f.updated_at_wrike,
    coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',u.display_name) order by u.display_name) from public.wrike_task_assignees a join public.wrike_users u on u.id=a.user_id where a.task_id=f.id),'[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('folderId',l.folder_id,'projectId',l.project_id,'wrikeId',l.wrike_location_id,'title',coalesce(folder.title,project.title,l.wrike_location_id),'scope',folder.scope,'resolved',(l.folder_id is not null or l.project_id is not null)) order by coalesce(folder.title,project.title,l.wrike_location_id)) from public.wrike_task_locations l left join public.wrike_folders folder on folder.id=l.folder_id left join public.wrike_projects project on project.id=l.project_id where l.task_id=f.id),'[]'::jsonb),
    coalesce((select jsonb_object_agg(value.normalized_field_id::text,jsonb_build_object('title',field.title,'values',value.display_values,'conflict',value.has_conflict,'sourceFieldIds',value.source_wrike_field_ids,'sourceTitles',value.source_titles)) from public.wrike_task_normalized_custom_field_values value join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id where value.task_id=f.id),'{}'::jsonb),
    count(*) over()
  from filtered f
  order by case when filters->>'sort'='title' then lower(f.title) end asc,case when filters->>'sort'='due' then f.due_date end asc nulls last,case when filters->>'sort'='actual' then f.visible_actual_minutes end desc,f.updated_at_wrike desc nulls last,f.id
  limit greatest(1,least(result_limit,200)) offset greatest(0,result_offset);
$$;

create or replace function public.reporting_time_rows(filters jsonb default '{}'::jsonb,result_limit integer default 50,result_offset integer default 0)
returns table (entry_id uuid,entry_date date,minutes integer,category text,comment text,task_id uuid,task_title text,task_status text,user_id uuid,user_name text,total_count bigint)
language sql stable set search_path=public as $$
  select e.id,e.entry_date,e.minutes,e.category,e.comment,t.id,t.title,t.status,u.id,u.display_name,count(*) over()
  from public.wrike_time_entries e join public.wrike_tasks t on t.id=e.task_id left join public.wrike_users u on u.id=e.user_id
  where not e.is_deleted and not t.is_deleted and public.can_access_wrike_time_entry(e.id)
    and (not (filters ? 'taskIds') or t.id::text in (select jsonb_array_elements_text(filters->'taskIds')))
    and (not (filters ? 'q') or t.title ilike '%' || (filters->>'q') || '%' or coalesce(e.comment,'') ilike '%' || (filters->>'q') || '%' or public.matches_reporting_normalized_custom_search(t.id,filters->>'q'))
    and (not (filters ? 'from') or case coalesce(filters->>'dateField','tracked') when 'due' then t.due_date when 'start' then t.start_date when 'created' then t.created_at_wrike::date when 'completed' then t.completed_at::date else e.entry_date end >= (filters->>'from')::date)
    and (not (filters ? 'to') or case coalesce(filters->>'dateField','tracked') when 'due' then t.due_date when 'start' then t.start_date when 'created' then t.created_at_wrike::date when 'completed' then t.completed_at::date else e.entry_date end <= (filters->>'to')::date)
    and (not (filters ? 'statuses') or public.matches_reporting_status(t.organization_id,t.status,t.custom_status_id,filters->'statuses'))
    and (not (filters ? 'state') or case filters->>'state' when 'completed' then t.completed_at is not null or lower(t.status)='completed' when 'cancelled' then lower(t.status)='cancelled' when 'open' then t.completed_at is null and lower(t.status) in ('active','deferred') when 'overdue' then t.completed_at is null and lower(t.status) in ('active','deferred') and t.due_date<current_date else true end)
    and (not (filters ? 'assigneeIds') or e.user_id::text in (select jsonb_array_elements_text(filters->'assigneeIds')))
    and (not (filters ? 'categoryIds') or e.category in (select jsonb_array_elements_text(filters->'categoryIds')))
    and (not (filters ? 'scopeIds') or exists(select 1 from public.wrike_scope_tasks st where st.task_id=t.id and st.scope_id::text in (select jsonb_array_elements_text(filters->'scopeIds'))))
    and (not (filters ? 'folderIds') or exists(select 1 from public.wrike_task_locations l where l.task_id=t.id and l.folder_id::text in (select jsonb_array_elements_text(filters->'folderIds'))))
    and (not (filters ? 'projectIds') or exists(select 1 from public.wrike_task_locations l where l.task_id=t.id and l.project_id::text in (select jsonb_array_elements_text(filters->'projectIds'))))
    and (not (filters ? 'customFields') or public.matches_reporting_normalized_custom_fields(t.id,filters->'customFields'))
    and (not (filters ? 'timeState') or filters->>'timeState'<>'no-time')
    and (not (filters ? 'minMinutes') or e.minutes >= (filters->>'minMinutes')::integer)
    and (not (filters ? 'maxMinutes') or e.minutes <= (filters->>'maxMinutes')::integer)
    and (not (filters ? 'minPlannedMinutes') or coalesce(t.planned_minutes,0) >= (filters->>'minPlannedMinutes')::integer)
    and (not (filters ? 'maxPlannedMinutes') or coalesce(t.planned_minutes,0) <= (filters->>'maxPlannedMinutes')::integer)
  order by case when filters->>'sort'='title' then lower(t.title) end asc,case when filters->>'sort'='due' then t.due_date end asc nulls last,case when filters->>'sort'='actual' then e.minutes end desc,e.entry_date desc,e.id
  limit greatest(1,least(result_limit,200)) offset greatest(0,result_offset);
$$;

create or replace function public.reporting_time_summary(filters jsonb default '{}'::jsonb,group_by text default 'total')
returns table (group_key text,label text,minutes bigint,entry_count bigint)
language sql stable set search_path=public as $$
  with visible as (
    select e.*,t.title as task_title,coalesce(status_ref.title,t.custom_status_id,t.status) as task_status,coalesce(u.display_name,e.user_wrike_id) as user_name,
      (select p.title from public.wrike_task_locations l join public.wrike_projects p on p.id=l.project_id where l.task_id=t.id order by p.title limit 1) as project_title,
      (select array_to_string(value.display_values,', ') from public.wrike_task_normalized_custom_field_values value where value.task_id=t.id and value.normalized_field_id::text=filters->>'groupCustomFieldId') as custom_group
    from public.wrike_time_entries e join public.wrike_tasks t on t.id=e.task_id left join public.wrike_users u on u.id=e.user_id left join public.wrike_workflow_statuses status_ref on status_ref.organization_id=t.organization_id and status_ref.wrike_id=t.custom_status_id
    where not e.is_deleted and not t.is_deleted and public.can_access_wrike_time_entry(e.id)
      and (not (filters ? 'taskIds') or t.id::text in (select jsonb_array_elements_text(filters->'taskIds')))
      and (not (filters ? 'q') or t.title ilike '%' || (filters->>'q') || '%' or coalesce(e.comment,'') ilike '%' || (filters->>'q') || '%' or public.matches_reporting_normalized_custom_search(t.id,filters->>'q'))
      and (not (filters ? 'from') or case coalesce(filters->>'dateField','tracked') when 'due' then t.due_date when 'start' then t.start_date when 'created' then t.created_at_wrike::date when 'completed' then t.completed_at::date else e.entry_date end >= (filters->>'from')::date)
      and (not (filters ? 'to') or case coalesce(filters->>'dateField','tracked') when 'due' then t.due_date when 'start' then t.start_date when 'created' then t.created_at_wrike::date when 'completed' then t.completed_at::date else e.entry_date end <= (filters->>'to')::date)
      and (not (filters ? 'statuses') or public.matches_reporting_status(t.organization_id,t.status,t.custom_status_id,filters->'statuses'))
      and (not (filters ? 'state') or case filters->>'state' when 'completed' then t.completed_at is not null or lower(t.status)='completed' when 'cancelled' then lower(t.status)='cancelled' when 'open' then t.completed_at is null and lower(t.status) in ('active','deferred') when 'overdue' then t.completed_at is null and lower(t.status) in ('active','deferred') and t.due_date<current_date else true end)
      and (not (filters ? 'assigneeIds') or e.user_id::text in (select jsonb_array_elements_text(filters->'assigneeIds')))
      and (not (filters ? 'categoryIds') or e.category in (select jsonb_array_elements_text(filters->'categoryIds')))
      and (not (filters ? 'scopeIds') or exists(select 1 from public.wrike_scope_tasks st where st.task_id=t.id and st.scope_id::text in (select jsonb_array_elements_text(filters->'scopeIds'))))
      and (not (filters ? 'folderIds') or exists(select 1 from public.wrike_task_locations l where l.task_id=t.id and l.folder_id::text in (select jsonb_array_elements_text(filters->'folderIds'))))
      and (not (filters ? 'projectIds') or exists(select 1 from public.wrike_task_locations l where l.task_id=t.id and l.project_id::text in (select jsonb_array_elements_text(filters->'projectIds'))))
      and (not (filters ? 'customFields') or public.matches_reporting_normalized_custom_fields(t.id,filters->'customFields'))
      and (not (filters ? 'timeState') or filters->>'timeState'<>'no-time')
      and (not (filters ? 'minMinutes') or e.minutes >= (filters->>'minMinutes')::integer)
      and (not (filters ? 'maxMinutes') or e.minutes <= (filters->>'maxMinutes')::integer)
      and (not (filters ? 'minPlannedMinutes') or coalesce(t.planned_minutes,0) >= (filters->>'minPlannedMinutes')::integer)
      and (not (filters ? 'maxPlannedMinutes') or coalesce(t.planned_minutes,0) <= (filters->>'maxPlannedMinutes')::integer)
  ),grouped as (
    select case group_by when 'person' then coalesce(user_id::text,user_wrike_id,'unknown') when 'task' then task_id::text when 'status' then task_status when 'project' then coalesce(project_title,'No project') when 'day' then entry_date::text when 'week' then date_trunc('week',entry_date)::date::text when 'month' then to_char(entry_date,'YYYY-MM') when 'custom' then coalesce(custom_group,'Not set') else 'total' end as key,
      case group_by when 'person' then coalesce(user_name,user_wrike_id,'Unknown') when 'task' then task_title when 'status' then task_status when 'project' then coalesce(project_title,'No project') when 'day' then entry_date::text when 'week' then date_trunc('week',entry_date)::date::text when 'month' then to_char(entry_date,'YYYY-MM') when 'custom' then coalesce(custom_group,'Not set') else 'Total' end as display,minutes from visible
  )
  select key,display,sum(grouped.minutes)::bigint,count(*)::bigint from grouped group by key,display order by sum(grouped.minutes) desc,display limit 200;
$$;

comment on table public.wrike_normalized_custom_fields is 'Application-level logical fields; Wrike field IDs remain authoritative in source tables.';
comment on column public.wrike_task_normalized_custom_field_values.has_conflict is 'True when populated source fields mapped to one logical field contain different value sets.';
