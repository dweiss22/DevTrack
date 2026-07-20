-- The portfolio Dashboard summarizes every valid Reporting course year. The
-- Development dashboard remains year-scoped through its dedicated RPCs.

create or replace function public.reporting_online_learning_dashboard_tasks()
returns table (
  task_id uuid,organization_id uuid,reporting_year integer,custom_status_id text,due_date date,
  status_name text,status_color text,dashboard_classification text
)
language sql
stable
security definer
set search_path=public
as $$
  select task.id,task.organization_id,reporting.reporting_year,task.custom_status_id,task.due_date,
    coalesce(status_ref.title,task.custom_status_id,task.status,'Unidentified'),status_ref.color,status_ref.dashboard_classification
  from public.wrike_tasks task
  left join public.wrike_workflow_statuses status_ref
    on status_ref.organization_id=task.organization_id and status_ref.wrike_id=task.custom_status_id
  join public.wrike_normalized_custom_fields reporting_field
    on reporting_field.organization_id=task.organization_id and reporting_field.normalized_key='reporting'
  join public.wrike_task_normalized_custom_field_values reporting
    on reporting.task_id=task.id and reporting.normalized_field_id=reporting_field.id
  where task.organization_id=public.current_organization_id()
    and not task.is_deleted
    and (task.workflow_id='IEACHQK7K4BHMLHM' or status_ref.workflow_id='IEACHQK7K4BHMLHM')
    and reporting.reporting_year is not null and not reporting.has_conflict
    and public.can_access_wrike_task(task.id);
$$;

create or replace function public.reporting_online_learning_dashboard_overview_v4()
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  with projects as materialized (
    select source.*,
      case when source.dashboard_classification='completed' then 'completed'
        when source.dashboard_classification='stalled_or_canceled' then 'stalled_or_canceled'
        else 'active' end as effective_classification
    from public.reporting_online_learning_dashboard_tasks() source
  ), field_values as (
    select value.task_id,field.normalized_key,value.display_values,value.has_conflict,
      value.vertical_reporting_category,value.has_unresolved_vertical
    from public.wrike_task_normalized_custom_field_values value
    join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
    join projects on projects.task_id=value.task_id
    where field.normalized_key in ('reporting','course type','authoring tool','vertical')
  ), project_fields as (
    select project.*,
      course.display_values as course_values,tool.display_values as tool_values,
      vertical.vertical_reporting_category,coalesce(vertical.has_unresolved_vertical,true) as unresolved_vertical,
      coalesce(reporting.has_conflict,false) or coalesce(course.has_conflict,false)
        or coalesce(tool.has_conflict,false) or coalesce(vertical.has_conflict,false) as field_conflict
    from projects project
    left join field_values reporting on reporting.task_id=project.task_id and reporting.normalized_key='reporting'
    left join field_values course on course.task_id=project.task_id and course.normalized_key='course type'
    left join field_values tool on tool.task_id=project.task_id and tool.normalized_key='authoring tool'
    left join field_values vertical on vertical.task_id=project.task_id and vertical.normalized_key='vertical'
  ), categories as (
    select task_id,'courseType'::text as kind,case when coalesce(cardinality(course_values),0)=0 then 'Unassigned' when cardinality(course_values)=1 then course_values[1] else 'Multiple Course Types' end as category from project_fields
    union all
    select task_id,'authoringTool',case when coalesce(cardinality(tool_values),0)=0 then 'Unassigned' when cardinality(tool_values)=1 then tool_values[1] else 'Multiple Authoring Tools' end from project_fields
    union all
    select task_id,'vertical',vertical_reporting_category from project_fields where vertical_reporting_category is distinct from 'Unresolved Vertical'
  ), category_counts as (
    select kind,category,count(*)::bigint as projects from categories where category is not null group by kind,category
  ), year_summary as (
    select reporting_year,
      count(*) filter(where effective_classification='stalled_or_canceled')::bigint as stalled,
      count(*) filter(where effective_classification='active')::bigint as active,
      count(*) filter(where effective_classification='completed')::bigint as completed,
      count(*)::bigint as total,
      coalesce(jsonb_agg(distinct status_name) filter(where effective_classification='stalled_or_canceled'),'[]'::jsonb) as stalled_statuses,
      coalesce(jsonb_agg(distinct status_name) filter(where effective_classification='active'),'[]'::jsonb) as active_statuses,
      coalesce(jsonb_agg(distinct status_name) filter(where effective_classification='completed'),'[]'::jsonb) as completed_statuses
    from project_fields group by reporting_year
  )
  select jsonb_build_object(
    'metrics',jsonb_build_object(
      'totalProjects',(select count(*) from project_fields),
      'activeProjects',(select count(*) from project_fields where effective_classification='active'),
      'completedProjects',(select count(*) from project_fields where effective_classification='completed'),
      'stalledOrCanceledProjects',(select count(*) from project_fields where effective_classification='stalled_or_canceled'),
      'unresolvedStatusProjects',(select count(*) from project_fields where dashboard_classification is null),
      'customFieldConflictProjects',(select count(*) from project_fields where field_conflict),
      'unresolvedVerticalProjects',(select count(*) from project_fields where unresolved_vertical)
    ),
    'projectsByReportingYear',coalesce((select jsonb_agg(jsonb_build_object(
      'label',reporting_year::text,'sortYear',reporting_year,'projects',completed
    ) order by reporting_year) from year_summary),'[]'::jsonb),
    'projectsByStatus',coalesce((select jsonb_agg(jsonb_build_object(
      'label',reporting_year::text,'sortYear',reporting_year,'stalledOrCanceled',stalled,'active',active,
      'completed',completed,'total',total,'stalledStatuses',stalled_statuses,
      'activeStatuses',active_statuses,'completedStatuses',completed_statuses
    ) order by reporting_year) from year_summary),'[]'::jsonb),
    'courseTypes',coalesce((select jsonb_agg(jsonb_build_object('name',category,'projects',projects) order by projects desc,category) from category_counts where kind='courseType' and category<>'Unassigned'),'[]'::jsonb),
    'authoringTools',coalesce((select jsonb_agg(jsonb_build_object('name',category,'projects',projects) order by projects desc,category) from category_counts where kind='authoringTool' and category<>'Unassigned'),'[]'::jsonb),
    'verticals',coalesce((select jsonb_agg(jsonb_build_object('name',category,'projects',projects) order by projects desc,category) from category_counts where kind='vertical'),'[]'::jsonb)
  );
$$;

create or replace function public.reporting_online_learning_dashboard_time_v4()
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  with completed as materialized (
    select source.task_id,source.reporting_year
    from public.reporting_online_learning_dashboard_tasks() source
    where source.dashboard_classification='completed'
  ), time_by_task as (
    select completed.task_id,completed.reporting_year,coalesce(sum(entry.minutes),0)::bigint as minutes
    from completed
    left join public.wrike_time_entries entry on entry.task_id=completed.task_id and not entry.is_deleted
      and public.can_access_wrike_time_entry(entry.id)
    group by completed.task_id,completed.reporting_year
  ), year_time as (
    select reporting_year,count(*)::bigint as project_count,coalesce(sum(minutes),0)::bigint as total_minutes,
      round(avg(minutes)::numeric,2) as average_minutes
    from time_by_task group by reporting_year
  ), sync_state as (
    select exists(select 1 from public.wrike_folder_task_import_runs run where run.organization_id=public.current_organization_id() and run.status='succeeded') as synchronized
  )
  select jsonb_build_object(
    'timeDataSynchronized',(select synchronized from sync_state),
    'averageTimeByReportingYear',case when (select synchronized from sync_state) then coalesce((select jsonb_agg(jsonb_build_object(
      'label',reporting_year::text,'sortYear',reporting_year,'projectCount',project_count,
      'totalMinutes',total_minutes,'averageMinutes',average_minutes,'timeDataSynchronized',true
    ) order by reporting_year) from year_time),'[]'::jsonb) else '[]'::jsonb end
  );
$$;

revoke all on function public.reporting_online_learning_dashboard_tasks() from public;
revoke all on function public.reporting_online_learning_dashboard_overview_v4() from public;
revoke all on function public.reporting_online_learning_dashboard_time_v4() from public;
grant execute on function public.reporting_online_learning_dashboard_overview_v4() to authenticated,service_role;
grant execute on function public.reporting_online_learning_dashboard_time_v4() to authenticated,service_role;

select pg_notify('pgrst','reload schema');
