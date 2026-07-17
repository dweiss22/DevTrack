-- Aggregated, RLS-aware Online Learning dashboard analytics.

create index if not exists wrike_tasks_workflow_active_idx
  on public.wrike_tasks(organization_id, workflow_id, custom_status_id)
  where not is_deleted;
create index if not exists wrike_time_entries_task_active_idx
  on public.wrike_time_entries(task_id)
  where not is_deleted;
create index if not exists wrike_normalized_fields_key_idx
  on public.wrike_normalized_custom_fields(organization_id, normalized_key);

-- Recalculate only automatic classifications from Wrike's stable status group.
-- Title-based guesses are deliberately avoided; administrators can explicitly
-- classify statuses such as On Hold or Stalled by their synchronized ID.
update public.wrike_workflow_statuses
set dashboard_classification=case
      when lower(coalesce(status_group,'')) in ('cancelled','canceled') then 'stalled_or_canceled'
      when lower(coalesce(status_group,''))='completed' then 'completed'
      when lower(coalesce(status_group,'')) in ('active','deferred') then 'active'
      else null end,
    classification_source=case
      when lower(coalesce(status_group,'')) in ('cancelled','canceled','completed','active','deferred') then 'automatic'
      else null end,
    classification_updated_at=now()
where classification_source is distinct from 'manual';

create or replace function public.wrike_reporting_year(source_values text[])
returns integer
language sql
immutable
set search_path=public
as $$
  with matches as (
    select distinct ((regexp_match(value, '(^|[^0-9])((19[0-9]{2}|20[0-9]{2}|21[0-9]{2}))([^0-9]|$)'))[2])::integer as year
    from unnest(coalesce(source_values, '{}'::text[])) value
    where trim(value) <> ''
      and value ~ '(^|[^0-9])(19[0-9]{2}|20[0-9]{2}|21[0-9]{2})([^0-9]|$)'
  )
  select case when count(*)=1 then min(year) else null end from matches;
$$;

create or replace function public.reporting_online_learning_dashboard_v2(filters jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
set search_path=public
as $$
  with visible as (
    select task.id,
      task.organization_id,
      task.custom_status_id,
      task.due_date,
      coalesce(status_ref.title,task.custom_status_id,task.status,'Unidentified') as status_name,
      status_ref.color as status_color,
      status_ref.dashboard_classification,
      case
        when status_ref.dashboard_classification='completed' then 'completed'
        when status_ref.dashboard_classification='stalled_or_canceled' then 'stalled_or_canceled'
        else 'active'
      end as effective_classification,
      filtered.visible_actual_minutes as actual_minutes
    from public.reporting_filtered_tasks(filters - 'state') filtered
    join public.wrike_tasks task on task.id=filtered.task_id
    left join public.wrike_workflow_statuses status_ref
      on status_ref.organization_id=task.organization_id and status_ref.wrike_id=task.custom_status_id
    where (task.workflow_id='IEACHQK7K4BHMLHM' or status_ref.workflow_id='IEACHQK7K4BHMLHM')
      and (not (filters ? 'state') or case filters->>'state'
        when 'completed' then status_ref.dashboard_classification='completed'
        when 'cancelled' then status_ref.dashboard_classification='stalled_or_canceled'
        when 'open' then coalesce(status_ref.dashboard_classification,'active')='active'
        when 'overdue' then coalesce(status_ref.dashboard_classification,'active')='active' and task.due_date<current_date
        else true end)
  ), normalized_values as (
    select value.task_id,
      field.normalized_key,
      lower(trim(regexp_replace(observed.value,'\s+',' ','g'))) as canonical_value,
      min(trim(regexp_replace(observed.value,'\s+',' ','g'))) as display_value,
      bool_or(value.has_conflict) as has_conflict
    from public.wrike_task_normalized_custom_field_values value
    join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
    join visible on visible.id=value.task_id
    cross join lateral unnest(value.display_values) observed(value)
    where field.normalized_key in ('reporting','course type','authoring tool','vertical')
      and trim(observed.value)<>''
    group by value.task_id,field.normalized_key,lower(trim(regexp_replace(observed.value,'\s+',' ','g')))
  ), field_sets as (
    select task_id,normalized_key,array_agg(display_value order by canonical_value) as values,bool_or(has_conflict) as has_conflict
    from normalized_values
    group by task_id,normalized_key
  ), projects as (
    select visible.*,
      reporting.values as reporting_values,
      course_type.values as course_type_values,
      authoring_tool.values as authoring_tool_values,
      vertical.values as vertical_values,
      public.wrike_reporting_year(reporting.values) as reporting_year,
      coalesce(reporting.has_conflict,false) or coalesce(course_type.has_conflict,false)
        or coalesce(authoring_tool.has_conflict,false) or coalesce(vertical.has_conflict,false) as has_dashboard_field_conflict
    from visible
    left join field_sets reporting on reporting.task_id=visible.id and reporting.normalized_key='reporting'
    left join field_sets course_type on course_type.task_id=visible.id and course_type.normalized_key='course type'
    left join field_sets authoring_tool on authoring_tool.task_id=visible.id and authoring_tool.normalized_key='authoring tool'
    left join field_sets vertical on vertical.task_id=visible.id and vertical.normalized_key='vertical'
  ), year_counts as (
    select coalesce(reporting_year::text,'Unassigned') as label,
      coalesce(reporting_year,2147483647) as sort_year,
      count(*)::bigint as projects
    from projects
    where effective_classification='completed'
    group by reporting_year
  ), time_sync as (
    select exists(
      select 1 from public.wrike_folder_task_import_runs run
      where run.organization_id=public.current_organization_id() and run.status='succeeded'
    ) as synchronized
  ), year_time as (
    select coalesce(reporting_year::text,'Unassigned') as label,
      coalesce(reporting_year,2147483647) as sort_year,
      count(*)::bigint as project_count,
      sum(actual_minutes)::bigint as total_minutes,
      case when (select synchronized from time_sync) then round(avg(actual_minutes)::numeric,2) else null end as average_minutes
    from projects
    where effective_classification='completed'
    group by reporting_year
  ), status_groups as (
    select coalesce(reporting_year::text,'Unassigned') as label,
      coalesce(reporting_year,2147483647) as sort_year,
      effective_classification,
      count(*)::bigint as projects,
      jsonb_agg(distinct status_name order by status_name) as statuses
    from projects
    group by reporting_year,effective_classification
  ), status_years as (
    select label,sort_year,
      coalesce(sum(projects) filter(where effective_classification='stalled_or_canceled'),0)::bigint as stalled_or_canceled,
      coalesce(sum(projects) filter(where effective_classification='active'),0)::bigint as active,
      coalesce(sum(projects) filter(where effective_classification='completed'),0)::bigint as completed,
      coalesce(sum(projects),0)::bigint as total,
      coalesce((jsonb_agg(statuses) filter(where effective_classification='stalled_or_canceled'))->0,'[]'::jsonb) as stalled_statuses,
      coalesce((jsonb_agg(statuses) filter(where effective_classification='active'))->0,'[]'::jsonb) as active_statuses,
      coalesce((jsonb_agg(statuses) filter(where effective_classification='completed'))->0,'[]'::jsonb) as completed_statuses
    from status_groups
    group by label,sort_year
  ), project_categories as (
    select id,'courseType'::text as kind,
      case when coalesce(cardinality(course_type_values),0)=0 then 'Unassigned'
        when cardinality(course_type_values)=1 then course_type_values[1]
        else 'Multiple Course Types' end as category
    from projects
    union all
    select id,'authoringTool',
      case when coalesce(cardinality(authoring_tool_values),0)=0 then 'Unassigned'
        when cardinality(authoring_tool_values)=1 then authoring_tool_values[1]
        else 'Multiple Authoring Tools' end
    from projects
    union all
    select id,'vertical',
      case when coalesce(cardinality(vertical_values),0)=0 then 'Unassigned'
        when cardinality(vertical_values)=1 then vertical_values[1]
        else 'Cross Vertical' end
    from projects
  ), category_counts as (
    select kind,lower(category) as category_key,min(category) as category,count(*)::bigint as projects
    from project_categories
    group by kind,lower(category)
  )
  select jsonb_build_object(
    'metrics',jsonb_build_object(
      'totalProjects',(select count(*) from projects),
      'activeProjects',(select count(*) from projects where effective_classification='active'),
      'completedProjects',(select count(*) from projects where effective_classification='completed'),
      'stalledOrCanceledProjects',(select count(*) from projects where effective_classification='stalled_or_canceled'),
      'unresolvedStatusProjects',(select count(*) from projects where dashboard_classification is null),
      'customFieldConflictProjects',(select count(*) from projects where has_dashboard_field_conflict),
      'timeDataSynchronized',(select synchronized from time_sync)
    ),
    'projectsByReportingYear',coalesce((select jsonb_agg(jsonb_build_object('label',label,'sortYear',sort_year,'projects',projects) order by sort_year) from year_counts),'[]'::jsonb),
    'averageTimeByReportingYear',coalesce((select jsonb_agg(jsonb_build_object('label',label,'sortYear',sort_year,'projectCount',project_count,'totalMinutes',total_minutes,'averageMinutes',average_minutes,'timeDataSynchronized',(select synchronized from time_sync)) order by sort_year) from year_time),'[]'::jsonb),
    'projectsByStatus',coalesce((select jsonb_agg(jsonb_build_object('label',label,'sortYear',sort_year,'stalledOrCanceled',stalled_or_canceled,'active',active,'completed',completed,'total',total,'stalledStatuses',stalled_statuses,'activeStatuses',active_statuses,'completedStatuses',completed_statuses) order by sort_year) from status_years),'[]'::jsonb),
    'courseTypes',coalesce((select jsonb_agg(jsonb_build_object('name',category,'projects',projects) order by projects desc,category) from category_counts where kind='courseType'),'[]'::jsonb),
    'authoringTools',coalesce((select jsonb_agg(jsonb_build_object('name',category,'projects',projects) order by projects desc,category) from category_counts where kind='authoringTool'),'[]'::jsonb),
    'verticals',coalesce((select jsonb_agg(jsonb_build_object('name',category,'projects',projects) order by projects desc,category) from category_counts where kind='vertical'),'[]'::jsonb)
  );
$$;

grant execute on function public.wrike_reporting_year(text[]) to authenticated,service_role;
grant execute on function public.reporting_online_learning_dashboard_v2(jsonb) to authenticated,service_role;

comment on function public.reporting_online_learning_dashboard_v2(jsonb) is 'RLS-aware Online Learning project analytics aggregated from synchronized task, status, normalized custom-field, and timelog data.';

select pg_notify('pgrst','reload schema');
