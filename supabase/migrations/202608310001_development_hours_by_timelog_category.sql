-- The "Hours spent by status" chart previously attributed timelog minutes to
-- each task's *current* custom status, which skewed totals toward whatever
-- status tasks happen to sit in today (e.g. Completed tasks accumulating all
-- of their historical hours even though no time should be logged once a
-- task reaches that status). Wrike time entries carry their own `category`
-- field independent of task status, so group hours by that instead.
create or replace function public.reporting_development_analytics(filters jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  with filtered_tasks as (
    select * from public.reporting_development_filtered_tasks(filters)
  ), projects as (
    select task.id,task.custom_status_id,filtered_tasks.actual_minutes,
      case when status_ref.wrike_id is null or status_ref.is_unresolved then 'Unknown Status' else status_ref.title end as status_name,
      case when status_ref.wrike_id is not null and not status_ref.is_unresolved then status_ref.color else null end as status_color,
      status_ref.wrike_id is not null and not status_ref.is_unresolved as status_resolved,
      status_ref.dashboard_classification,
      case when status_ref.dashboard_classification='completed' then 'completed' else 'incomplete' end as completion_classification
    from filtered_tasks
    join public.wrike_tasks task on task.id=filtered_tasks.task_id
    left join public.wrike_workflow_statuses status_ref
      on status_ref.organization_id=task.organization_id and status_ref.wrike_id=task.custom_status_id
  ), status_counts as (
    select case when status_resolved then custom_status_id else '__unknown__' end as status_id,status_name,status_color,status_resolved,
      count(*)::bigint as projects
    from projects where completion_classification='incomplete'
    group by case when status_resolved then custom_status_id else '__unknown__' end,status_name,status_color,status_resolved
  ), time_counts as (
    select coalesce(nullif(trim(entry.category),''),'Uncategorized') as category_name,
      sum(entry.minutes)::bigint as minutes,count(distinct entry.task_id)::bigint as project_count
    from filtered_tasks
    join public.wrike_time_entries entry on entry.task_id=filtered_tasks.task_id and not entry.is_deleted
    where entry.minutes>0
    group by coalesce(nullif(trim(entry.category),''),'Uncategorized')
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
    'hoursByCategory',coalesce((select jsonb_agg(jsonb_build_object('categoryId',category_name,'name',category_name,'minutes',minutes,'projectCount',project_count) order by minutes desc,category_name) from time_counts),'[]'::jsonb)
  );
$$;
