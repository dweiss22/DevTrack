-- Strict Reporting-course years and year-first dashboard queries.

create or replace function public.wrike_reporting_year(source_values text[])
returns integer
language sql
immutable
set search_path=public
as $$
  with normalized as (
    select trim(regexp_replace(value,'\s+',' ','g')) as value
    from unnest(coalesce(source_values,'{}'::text[])) value
    where trim(value)<>''
  ), parsed as (
    select value,(regexp_match(value,'^((19|20|21)[0-9]{2}) Courses$','i'))[1]::integer as year
    from normalized
  )
  select case
    when count(*)>0 and count(*)=count(year) and count(distinct year)=1 then min(year)
    else null
  end
  from parsed;
$$;

-- Recompute the stored generated column with the strict parser.
update public.wrike_task_normalized_custom_field_values value
set display_values=value.display_values,updated_at=value.updated_at
from public.wrike_normalized_custom_fields field
where field.id=value.normalized_field_id and field.normalized_key='reporting';

create index if not exists wrike_tasks_online_learning_scope_idx
  on public.wrike_tasks(organization_id,workflow_id,id)
  where not is_deleted;
create index if not exists wrike_normalized_reporting_year_lookup_idx
  on public.wrike_task_normalized_custom_field_values(normalized_field_id,reporting_year,task_id)
  where reporting_year is not null and not has_conflict;

create or replace function public.reporting_online_learning_year_tasks(target_year integer)
returns table (
  task_id uuid,organization_id uuid,custom_status_id text,due_date date,
  status_name text,status_color text,dashboard_classification text
)
language sql
stable
security definer
set search_path=public
as $$
  select task.id,task.organization_id,task.custom_status_id,task.due_date,
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
    and reporting.reporting_year=target_year and not reporting.has_conflict
    and public.can_access_wrike_task(task.id);
$$;

create or replace function public.reporting_dashboard_year_options()
returns table (year integer,label text,project_count bigint)
language sql
stable
security definer
set search_path=public
as $$
  select reporting.reporting_year,
    reporting.reporting_year::text || ' Courses',count(*)::bigint
  from public.wrike_tasks task
  left join public.wrike_workflow_statuses status_ref
    on status_ref.organization_id=task.organization_id and status_ref.wrike_id=task.custom_status_id
  join public.wrike_normalized_custom_fields reporting_field
    on reporting_field.organization_id=task.organization_id and reporting_field.normalized_key='reporting'
  join public.wrike_task_normalized_custom_field_values reporting
    on reporting.task_id=task.id and reporting.normalized_field_id=reporting_field.id
  where task.organization_id=public.current_organization_id() and not task.is_deleted
    and (task.workflow_id='IEACHQK7K4BHMLHM' or status_ref.workflow_id='IEACHQK7K4BHMLHM')
    and reporting.reporting_year is not null and not reporting.has_conflict
    and public.can_access_wrike_task(task.id)
  group by reporting.reporting_year
  order by reporting.reporting_year desc;
$$;

create or replace function public.reporting_online_learning_dashboard_overview_v3(target_year integer)
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
    from public.reporting_online_learning_year_tasks(target_year) source
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
  ), status_summary as (
    select coalesce(sum(1) filter(where effective_classification='stalled_or_canceled'),0)::bigint as stalled,
      coalesce(sum(1) filter(where effective_classification='active'),0)::bigint as active,
      coalesce(sum(1) filter(where effective_classification='completed'),0)::bigint as completed,
      count(*)::bigint as total,
      coalesce(jsonb_agg(distinct status_name) filter(where effective_classification='stalled_or_canceled'),'[]'::jsonb) as stalled_statuses,
      coalesce(jsonb_agg(distinct status_name) filter(where effective_classification='active'),'[]'::jsonb) as active_statuses,
      coalesce(jsonb_agg(distinct status_name) filter(where effective_classification='completed'),'[]'::jsonb) as completed_statuses
    from project_fields
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
    'projectsByReportingYear',jsonb_build_array(jsonb_build_object('label',target_year::text,'sortYear',target_year,'projects',(select count(*) from project_fields where effective_classification='completed'))),
    'projectsByStatus',jsonb_build_array(jsonb_build_object('label',target_year::text,'sortYear',target_year,'stalledOrCanceled',(select stalled from status_summary),'active',(select active from status_summary),'completed',(select completed from status_summary),'total',(select total from status_summary),'stalledStatuses',(select stalled_statuses from status_summary),'activeStatuses',(select active_statuses from status_summary),'completedStatuses',(select completed_statuses from status_summary))),
    'courseTypes',coalesce((select jsonb_agg(jsonb_build_object('name',category,'projects',projects) order by projects desc,category) from category_counts where kind='courseType' and category<>'Unassigned'),'[]'::jsonb),
    'authoringTools',coalesce((select jsonb_agg(jsonb_build_object('name',category,'projects',projects) order by projects desc,category) from category_counts where kind='authoringTool' and category<>'Unassigned'),'[]'::jsonb),
    'verticals',coalesce((select jsonb_agg(jsonb_build_object('name',category,'projects',projects) order by projects desc,category) from category_counts where kind='vertical'),'[]'::jsonb)
  );
$$;

create or replace function public.reporting_online_learning_dashboard_time_v3(target_year integer)
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  with completed as materialized (
    select source.task_id
    from public.reporting_online_learning_year_tasks(target_year) source
    where source.dashboard_classification='completed'
  ), time_by_task as (
    select completed.task_id,coalesce(sum(entry.minutes),0)::bigint as minutes
    from completed
    left join public.wrike_time_entries entry on entry.task_id=completed.task_id and not entry.is_deleted
      and public.can_access_wrike_time_entry(entry.id)
    group by completed.task_id
  ), sync_state as (
    select exists(select 1 from public.wrike_folder_task_import_runs run where run.organization_id=public.current_organization_id() and run.status='succeeded') as synchronized
  )
  select jsonb_build_object(
    'timeDataSynchronized',(select synchronized from sync_state),
    'averageTimeByReportingYear',case when (select synchronized from sync_state) then jsonb_build_array(jsonb_build_object(
      'label',target_year::text,'sortYear',target_year,'projectCount',(select count(*) from time_by_task),
      'totalMinutes',(select coalesce(sum(minutes),0) from time_by_task),
      'averageMinutes',(select round(avg(minutes)::numeric,2) from time_by_task),'timeDataSynchronized',true
    )) else '[]'::jsonb end
  );
$$;

-- Development candidates are narrowed by workflow and Reporting year before
-- time is aggregated, avoiding organization-wide timelog work.
create or replace function public.reporting_development_filtered_tasks(filters jsonb default '{}'::jsonb)
returns table (task_id uuid,actual_minutes bigint)
language sql
stable
security definer
set search_path=public
as $$
  with candidates as materialized (
    select task.id
    from public.wrike_tasks task
    left join public.wrike_workflow_statuses status_ref on status_ref.organization_id=task.organization_id and status_ref.wrike_id=task.custom_status_id
    left join public.wrike_normalized_custom_fields reporting_field on reporting_field.organization_id=task.organization_id and reporting_field.normalized_key='reporting'
    left join public.wrike_task_normalized_custom_field_values reporting on reporting.task_id=task.id and reporting.normalized_field_id=reporting_field.id
    where task.organization_id=public.current_organization_id() and not task.is_deleted
      and (task.workflow_id='IEACHQK7K4BHMLHM' or status_ref.workflow_id='IEACHQK7K4BHMLHM')
      and public.can_access_wrike_task(task.id)
      and case coalesce(filters->>'reportingYearMode','year') when 'missing'
        then reporting.task_id is null or reporting.reporting_year is null or reporting.has_conflict
        else reporting.reporting_year=(filters->>'reportingYear')::integer and not reporting.has_conflict end
      and (not (filters ? 'q') or task.title ilike '%' || (filters->>'q') || '%' or coalesce(task.description,'') ilike '%' || (filters->>'q') || '%' or public.matches_reporting_normalized_custom_search(task.id,filters->>'q'))
      and (not (filters ? 'completionClassification') or case filters->>'completionClassification' when 'completed' then status_ref.dashboard_classification='completed' when 'incomplete' then status_ref.dashboard_classification is distinct from 'completed' else true end)
      and (not (filters ? 'developmentStatus') or case filters->>'developmentStatus' when '__unknown__' then status_ref.wrike_id is null or status_ref.is_unresolved else task.custom_status_id=filters->>'developmentStatus' end)
      and (not (filters ? 'assigneeIds') or exists(select 1 from public.wrike_task_assignees assignee where assignee.task_id=task.id and assignee.user_id::text in (select jsonb_array_elements_text(filters->'assigneeIds'))))
      and (not (filters ? 'folderIds') or exists(select 1 from public.wrike_task_locations location where location.task_id=task.id and location.folder_id::text in (select jsonb_array_elements_text(filters->'folderIds'))))
      and (not (filters ? 'projectIds') or exists(select 1 from public.wrike_task_locations location where location.task_id=task.id and location.project_id::text in (select jsonb_array_elements_text(filters->'projectIds'))))
      and (not (filters ? 'customFields') or public.matches_reporting_normalized_custom_fields(task.id,filters->'customFields'))
      and public.matches_reporting_vertical_filters(task.id,filters)
      and (not (filters ? 'priority') or lower(coalesce(task.importance,''))=lower(filters->>'priority'))
      and (not (filters ? 'dueFrom') or task.due_date >= (filters->>'dueFrom')::date)
      and (not (filters ? 'dueTo') or task.due_date <= (filters->>'dueTo')::date)
      and (not (filters ? 'completedFrom') or task.completed_at::date >= (filters->>'completedFrom')::date)
      and (not (filters ? 'completedTo') or task.completed_at::date <= (filters->>'completedTo')::date)
      and (not coalesce((filters->>'unresolvedOnly')::boolean,false) or status_ref.wrike_id is null or status_ref.is_unresolved or coalesce(reporting.has_conflict,false)
        or exists(select 1 from public.wrike_task_custom_field_values raw_value where raw_value.task_id=task.id and not raw_value.resolved)
        or exists(select 1 from public.wrike_task_normalized_custom_field_values normalized where normalized.task_id=task.id and normalized.has_conflict)
        or exists(select 1 from public.wrike_task_locations location where location.task_id=task.id and location.folder_id is null and location.project_id is null))
  ), time_by_task as (
    select candidate.id,coalesce(sum(entry.minutes),0)::bigint as minutes
    from candidates candidate
    left join public.wrike_time_entries entry on entry.task_id=candidate.id and not entry.is_deleted and public.can_access_wrike_time_entry(entry.id)
    group by candidate.id
  )
  select time_by_task.id,time_by_task.minutes from time_by_task
  where not (filters ? 'timeState') or case filters->>'timeState' when 'with-time' then minutes>0 when 'no-time' then minutes=0 else true end;
$$;

-- Year options deliberately avoid the generic reporting filter and all timelog work.
create or replace function public.reporting_development_year_options()
returns table (reporting_year integer,project_count bigint,missing_count bigint)
language sql
stable
security definer
set search_path=public
as $$
  with scoped as materialized (
    select task.id,reporting.reporting_year,coalesce(reporting.has_conflict,false) as has_conflict
    from public.wrike_tasks task
    left join public.wrike_workflow_statuses status_ref on status_ref.organization_id=task.organization_id and status_ref.wrike_id=task.custom_status_id
    left join public.wrike_normalized_custom_fields reporting_field on reporting_field.organization_id=task.organization_id and reporting_field.normalized_key='reporting'
    left join public.wrike_task_normalized_custom_field_values reporting on reporting.task_id=task.id and reporting.normalized_field_id=reporting_field.id
    where task.organization_id=public.current_organization_id() and not task.is_deleted
      and (task.workflow_id='IEACHQK7K4BHMLHM' or status_ref.workflow_id='IEACHQK7K4BHMLHM')
      and public.can_access_wrike_task(task.id)
  ), missing as (select count(*)::bigint as count from scoped where reporting_year is null or has_conflict)
  select scoped.reporting_year,count(*)::bigint,(select count from missing)
  from scoped where reporting_year is not null and not has_conflict group by scoped.reporting_year
  union all select null::integer,0::bigint,(select count from missing)
    where not exists(select 1 from scoped where reporting_year is not null and not has_conflict)
  order by reporting_year desc nulls last;
$$;

revoke all on function public.reporting_online_learning_year_tasks(integer) from public;
revoke all on function public.reporting_dashboard_year_options() from public;
revoke all on function public.reporting_online_learning_dashboard_overview_v3(integer) from public;
revoke all on function public.reporting_online_learning_dashboard_time_v3(integer) from public;
grant execute on function public.reporting_dashboard_year_options() to authenticated,service_role;
grant execute on function public.reporting_online_learning_dashboard_overview_v3(integer) to authenticated,service_role;
grant execute on function public.reporting_online_learning_dashboard_time_v3(integer) to authenticated,service_role;
grant execute on function public.reporting_development_year_options() to authenticated,service_role;

select pg_notify('pgrst','reload schema');
