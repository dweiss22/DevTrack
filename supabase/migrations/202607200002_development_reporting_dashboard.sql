-- Reporting-year dashboard for the Online Learning Development page.

alter table public.wrike_task_normalized_custom_field_values
  add column if not exists reporting_year integer
  generated always as (public.wrike_reporting_year(display_values)) stored;

create index if not exists wrike_normalized_values_reporting_year_idx
  on public.wrike_task_normalized_custom_field_values(normalized_field_id,reporting_year,task_id);
create index if not exists wrike_statuses_development_group_idx
  on public.wrike_workflow_statuses(organization_id,workflow_id,dashboard_classification,wrike_id);

create or replace function public.reporting_development_filtered_tasks(filters jsonb default '{}'::jsonb)
returns table (task_id uuid, actual_minutes bigint)
language sql
stable
security definer
set search_path=public
as $$
  with authorized as (
    select source.task_id,source.visible_actual_minutes
    from public.reporting_filtered_tasks(
      (filters - array['reportingSelection','reportingYearMode','reportingYear','completionClassification','developmentStatus','priority','dueFrom','dueTo','completedFrom','completedTo','unresolvedOnly','sort'])
      || jsonb_build_object('workflowIds',jsonb_build_array('IEACHQK7K4BHMLHM'))
    ) source
  )
  select authorized.task_id,authorized.visible_actual_minutes
  from authorized
  join public.wrike_tasks task on task.id=authorized.task_id
  left join public.wrike_workflow_statuses status_ref
    on status_ref.organization_id=task.organization_id and status_ref.wrike_id=task.custom_status_id
  left join public.wrike_normalized_custom_fields reporting_field
    on reporting_field.organization_id=task.organization_id and reporting_field.normalized_key='reporting'
  left join public.wrike_task_normalized_custom_field_values reporting
    on reporting.task_id=task.id and reporting.normalized_field_id=reporting_field.id
  where case coalesce(filters->>'reportingYearMode','year')
      when 'missing' then reporting.task_id is null or reporting.reporting_year is null or reporting.has_conflict
      else reporting.reporting_year=(filters->>'reportingYear')::integer and not reporting.has_conflict
    end
    and (not (filters ? 'completionClassification') or case filters->>'completionClassification'
      when 'completed' then status_ref.dashboard_classification='completed'
      when 'incomplete' then status_ref.dashboard_classification is distinct from 'completed'
      else true end)
    and (not (filters ? 'developmentStatus') or case filters->>'developmentStatus'
      when '__unknown__' then status_ref.wrike_id is null or status_ref.is_unresolved
      else task.custom_status_id=filters->>'developmentStatus' end)
    and (not (filters ? 'priority') or lower(coalesce(task.importance,''))=lower(filters->>'priority'))
    and (not (filters ? 'dueFrom') or task.due_date >= (filters->>'dueFrom')::date)
    and (not (filters ? 'dueTo') or task.due_date <= (filters->>'dueTo')::date)
    and (not (filters ? 'completedFrom') or task.completed_at::date >= (filters->>'completedFrom')::date)
    and (not (filters ? 'completedTo') or task.completed_at::date <= (filters->>'completedTo')::date)
    and (coalesce((filters->>'unresolvedOnly')::boolean,false)=false or
      status_ref.wrike_id is null or status_ref.is_unresolved or reporting.has_conflict or
      exists(select 1 from public.wrike_task_custom_field_values raw_value where raw_value.task_id=task.id and not raw_value.resolved) or
      exists(select 1 from public.wrike_task_normalized_custom_field_values normalized where normalized.task_id=task.id and normalized.has_conflict) or
      exists(select 1 from public.wrike_task_locations location where location.task_id=task.id and location.folder_id is null and location.project_id is null));
$$;

create or replace function public.reporting_development_year_options()
returns table (reporting_year integer,project_count bigint,missing_count bigint)
language sql
stable
security definer
set search_path=public
as $$
  with authorized as (
    select source.task_id
    from public.reporting_filtered_tasks(jsonb_build_object('workflowIds',jsonb_build_array('IEACHQK7K4BHMLHM'))) source
  ), values_by_task as (
    select authorized.task_id,value.reporting_year,value.has_conflict
    from authorized
    join public.wrike_tasks task on task.id=authorized.task_id
    left join public.wrike_normalized_custom_fields field
      on field.organization_id=task.organization_id and field.normalized_key='reporting'
    left join public.wrike_task_normalized_custom_field_values value
      on value.task_id=task.id and value.normalized_field_id=field.id
  ), valid as (
    select value.reporting_year,count(*)::bigint as project_count
    from values_by_task value where value.reporting_year is not null and not value.has_conflict
    group by value.reporting_year
  ), missing as (
    select count(*)::bigint as count from values_by_task
    where reporting_year is null or has_conflict
  )
  select valid.reporting_year,valid.project_count,(select count from missing) from valid
  union all
  select null::integer,0::bigint,(select count from missing) where not exists(select 1 from valid)
  order by reporting_year desc nulls last;
$$;

create or replace function public.reporting_development_analytics(filters jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  with projects as (
    select task.id,task.custom_status_id,filtered.actual_minutes,
      case when status_ref.wrike_id is null or status_ref.is_unresolved then 'Unknown Status' else status_ref.title end as status_name,
      case when status_ref.wrike_id is not null and not status_ref.is_unresolved then status_ref.color else null end as status_color,
      status_ref.wrike_id is not null and not status_ref.is_unresolved as status_resolved,
      status_ref.dashboard_classification,
      case when status_ref.dashboard_classification='completed' then 'completed' else 'incomplete' end as completion_classification
    from public.reporting_development_filtered_tasks(filters) filtered
    join public.wrike_tasks task on task.id=filtered.task_id
    left join public.wrike_workflow_statuses status_ref
      on status_ref.organization_id=task.organization_id and status_ref.wrike_id=task.custom_status_id
  ), status_counts as (
    select case when status_resolved then custom_status_id else '__unknown__' end as status_id,status_name,status_color,status_resolved,
      count(*)::bigint as projects
    from projects where completion_classification='incomplete'
    group by case when status_resolved then custom_status_id else '__unknown__' end,status_name,status_color,status_resolved
  ), time_counts as (
    -- Wrike timelogs do not contain a historical status snapshot. This intentionally
    -- attributes time to the task's current status until status-at-entry is persisted.
    select case when project.status_resolved then project.custom_status_id else '__unknown__' end as status_id,project.status_name,project.status_color,
      project.status_resolved,sum(project.actual_minutes)::bigint as minutes,count(*)::bigint as project_count
    from projects project where project.actual_minutes>0
    group by case when project.status_resolved then project.custom_status_id else '__unknown__' end,project.status_name,project.status_color,project.status_resolved
  )
  select jsonb_build_object(
    'metrics',jsonb_build_object(
      'totalCourses',(select count(*) from projects),
      'completedCourses',(select count(*) from projects where completion_classification='completed'),
      'incompleteCourses',(select count(*) from projects where completion_classification='incomplete'),
      'unmappedStatusCourses',(select count(*) from projects where dashboard_classification is null),
      'totalMinutes',(select coalesce(sum(actual_minutes),0) from projects)
    ),
    'activeStatuses',coalesce((select jsonb_agg(jsonb_build_object('statusId',status_id,'name',status_name,'color',status_color,'resolved',status_resolved,'projects',projects) order by projects desc,status_name) from status_counts),'[]'::jsonb),
    'hoursByStatus',coalesce((select jsonb_agg(jsonb_build_object('statusId',status_id,'name',status_name,'color',status_color,'resolved',status_resolved,'minutes',minutes,'projectCount',project_count) order by minutes desc,status_name) from time_counts),'[]'::jsonb),
    'timeStatusAttribution','current_task_status'
  );
$$;

create or replace function public.reporting_development_project_rows(filters jsonb default '{}'::jsonb,result_limit integer default 50,result_offset integer default 0)
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  with filtered as (
    select task.*,source.actual_minutes,
      reporting.reporting_year,
      case when status_ref.wrike_id is null or status_ref.is_unresolved then 'Unknown Status' else status_ref.title end as status_name,
      case when status_ref.wrike_id is not null and not status_ref.is_unresolved then status_ref.color else null end as status_color,
      status_ref.wrike_id is not null and not status_ref.is_unresolved as status_resolved,
      case when status_ref.dashboard_classification='completed' then 'completed' else 'incomplete' end as completion_classification,
      status_ref.dashboard_classification is null as status_unmapped
    from public.reporting_development_filtered_tasks(filters) source
    join public.wrike_tasks task on task.id=source.task_id
    left join public.wrike_workflow_statuses status_ref
      on status_ref.organization_id=task.organization_id and status_ref.wrike_id=task.custom_status_id
    left join public.wrike_normalized_custom_fields reporting_field
      on reporting_field.organization_id=task.organization_id and reporting_field.normalized_key='reporting'
    left join public.wrike_task_normalized_custom_field_values reporting
      on reporting.task_id=task.id and reporting.normalized_field_id=reporting_field.id
  ), ordered as (
    select filtered.*,count(*) over() as total_count
    from filtered
    order by
      case when filters->>'sort'='title' then lower(title) end asc,
      case when filters->>'sort'='status' then lower(status_name) end asc,
      case when filters->>'sort'='priority' then lower(coalesce(importance,'')) end asc,
      case when filters->>'sort'='start' then start_date end asc nulls last,
      case when filters->>'sort'='due' then due_date end asc nulls last,
      case when filters->>'sort'='completed' then completed_at end desc nulls last,
      case when filters->>'sort'='actual' then actual_minutes end desc,
      updated_at_wrike desc nulls last,id
    limit greatest(1,least(result_limit,200)) offset greatest(0,result_offset)
  ), rows as (
    select jsonb_build_object(
      'taskId',item.id,'title',item.title,'reportingYear',item.reporting_year,
      'status',jsonb_build_object('id',coalesce(item.custom_status_id,'__unknown__'),'name',item.status_name,'color',item.status_color,'resolved',item.status_resolved),
      'completionClassification',item.completion_classification,'statusUnmapped',item.status_unmapped,
      'assignees',coalesce((select jsonb_agg(jsonb_build_object('id',responsible.id,'name',coalesce(user_ref.display_name,responsible.id),'resolved',user_ref.wrike_id is not null and not user_ref.is_unresolved) order by responsible.ordinality)
        from unnest(item.responsible_wrike_ids) with ordinality responsible(id,ordinality)
        left join public.wrike_users user_ref on user_ref.organization_id=item.organization_id and user_ref.wrike_id=responsible.id),'[]'::jsonb),
      'priority',item.importance,'startDate',item.start_date,'dueDate',item.due_date,'completedAt',item.completed_at,
      'actualMinutes',item.actual_minutes,'permalink',item.permalink,'updatedAt',item.updated_at_wrike,
      'locations',coalesce((select jsonb_agg(jsonb_build_object('id',location.wrike_location_id,'name',coalesce(folder.title,project.title,location.wrike_location_id),'resolved',folder.id is not null or project.id is not null) order by coalesce(folder.title,project.title,location.wrike_location_id))
        from public.wrike_task_locations location left join public.wrike_folders folder on folder.id=location.folder_id left join public.wrike_projects project on project.id=location.project_id where location.task_id=item.id),'[]'::jsonb),
      'customValues',coalesce((select jsonb_object_agg(field.normalized_key,jsonb_build_object('title',field.title,'values',value.display_values,'conflict',value.has_conflict))
        from public.wrike_task_normalized_custom_field_values value join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id where value.task_id=item.id),'{}'::jsonb)
    ) as row,total_count
    from ordered item
  )
  select jsonb_build_object('rows',coalesce((select jsonb_agg(row) from rows),'[]'::jsonb),'total',coalesce((select max(total_count) from rows),0));
$$;

revoke all on function public.reporting_development_filtered_tasks(jsonb) from public;
revoke all on function public.reporting_development_year_options() from public;
revoke all on function public.reporting_development_analytics(jsonb) from public;
revoke all on function public.reporting_development_project_rows(jsonb,integer,integer) from public;
grant execute on function public.reporting_development_year_options() to authenticated,service_role;
grant execute on function public.reporting_development_analytics(jsonb) to authenticated,service_role;
grant execute on function public.reporting_development_project_rows(jsonb,integer,integer) to authenticated,service_role;

select pg_notify('pgrst','reload schema');
