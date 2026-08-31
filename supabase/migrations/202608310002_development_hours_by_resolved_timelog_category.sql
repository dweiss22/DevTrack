-- The Development "hours by timelog category" chart introduced in
-- 202608310001 grouped by the raw category code stored on each time entry
-- (wrike_time_entries.category), rather than the human-readable name Wrike
-- returns from GET /timelog_categories. Resolve it through the existing
-- wrike_timelog_categories reference table, matching the same join pattern
-- already used by the ID dashboard analytics functions.
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
    select
      case
        when entry.category is null or btrim(entry.category)=''
          or category.id is null or category.is_unresolved
          then 'Uncategorized'
        else category.title
      end as category_name,
      sum(entry.minutes)::bigint as minutes,count(distinct entry.task_id)::bigint as project_count
    from filtered_tasks
    join public.wrike_time_entries entry on entry.task_id=filtered_tasks.task_id and not entry.is_deleted
    left join public.wrike_timelog_categories category
      on category.organization_id=entry.organization_id and category.wrike_id=entry.category
    where entry.minutes>0
    group by
      case
        when entry.category is null or btrim(entry.category)=''
          or category.id is null or category.is_unresolved
          then 'Uncategorized'
        else category.title
      end
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
