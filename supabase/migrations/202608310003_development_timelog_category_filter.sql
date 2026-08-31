-- Support clicking a "Hours spent by timelog category" bar and navigating to
-- the matching filtered project list, mirroring the existing developmentStatus
-- click-through filter. Splits the category identity (used for filtering) from
-- its display name (used for the chart label), and adds a timelogCategory
-- filter clause to the shared task-filtering function so both the analytics
-- and project-row RPCs honor it.
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
      and (not (filters ? 'timelogCategory') or exists (
        select 1 from public.wrike_time_entries entry
        left join public.wrike_timelog_categories category on category.organization_id=viewer.organization_id and category.wrike_id=entry.category
        where entry.task_id=task.id and entry.organization_id=viewer.organization_id and not entry.is_deleted and entry.minutes>0
          and case filters->>'timelogCategory'
            when '__uncategorized__' then entry.category is null or btrim(entry.category)='' or category.id is null or category.is_unresolved
            else entry.category=filters->>'timelogCategory'
          end
      ))
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
          then '__uncategorized__'
        else entry.category
      end as category_id,
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
    group by 1,2
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
    'hoursByCategory',coalesce((select jsonb_agg(jsonb_build_object('categoryId',category_id,'name',category_name,'minutes',minutes,'projectCount',project_count) order by minutes desc,category_name) from time_counts),'[]'::jsonb)
  );
$$;
