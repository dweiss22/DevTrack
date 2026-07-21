-- Projects-list Vertical multi-selection and set-based percentile benchmarks.

create or replace function public.matches_reporting_vertical_filters(target_task_id uuid,filters jsonb)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select
    (not (filters ? 'verticalReportingCategory') or exists(
      select 1 from public.wrike_task_normalized_custom_field_values value
      join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
      where value.task_id=target_task_id and field.normalized_key='vertical'
        and lower(value.vertical_reporting_category)=lower(filters->>'verticalReportingCategory')
    ))
    and (not (filters ? 'associatedVertical') or exists(
      select 1 from public.wrike_task_normalized_custom_field_values value
      join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
      where value.task_id=target_task_id and field.normalized_key='vertical'
        and filters->>'associatedVertical'=any(value.normalized_verticals)
    ))
    and (not (filters ? 'verticalState') or exists(
      select 1 from public.wrike_tasks task where task.id=target_task_id and task.vertical_state=filters->>'verticalState'
    ))
    and (not coalesce((filters->>'unresolvedVerticalOnly')::boolean,false) or exists(
      select 1 from public.wrike_tasks task where task.id=target_task_id
        and task.vertical_state in ('missing','unrecognized','synchronization_incomplete')
    ))
    and (not (filters ? 'verticalSelections') or (
      jsonb_typeof(filters->'verticalSelections')='array' and exists(
        select 1
        from jsonb_array_elements_text(filters->'verticalSelections') selection(token)
        where
          (selection.token like 'associated:%' and exists(
            select 1 from public.wrike_task_normalized_custom_field_values value
            join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
            where value.task_id=target_task_id and field.normalized_key='vertical'
              and substring(selection.token from length('associated:')+1)=any(value.normalized_verticals)
          ))
          or (selection.token like 'category:%' and exists(
            select 1 from public.wrike_task_normalized_custom_field_values value
            join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
            where value.task_id=target_task_id and field.normalized_key='vertical'
              and lower(value.vertical_reporting_category)=lower(substring(selection.token from length('category:')+1))
          ))
          or (selection.token like 'state:%' and exists(
            select 1 from public.wrike_tasks task
            where task.id=target_task_id and task.vertical_state=substring(selection.token from length('state:')+1)
          ))
          or (selection.token='legacy:unresolved' and exists(
            select 1 from public.wrike_tasks task where task.id=target_task_id
              and task.vertical_state in ('missing','unrecognized','synchronization_incomplete')
          ))
      )
    ));
$$;

create or replace function public.reporting_filtered_tasks(filters jsonb default '{}'::jsonb)
returns table (task_id uuid, visible_actual_minutes bigint)
language sql
stable
security definer
set search_path=public
as $$
  select filtered.task_id,filtered.visible_actual_minutes
  from public.reporting_filtered_tasks_without_dashboard_drilldown(
    case when filters ?| array[
      'workflowIds','reportingYear','dashboardClassification','dashboardField','dashboardValue',
      'verticalReportingCategory','associatedVertical','verticalState','unresolvedVerticalOnly','verticalSelections'
    ] then filters - 'state' else filters end
  ) filtered
  where public.matches_reporting_dashboard_drilldown(filtered.task_id,filters)
    and public.matches_reporting_vertical_filters(filtered.task_id,filters)
    and (not coalesce((filters->>'validReportingYearOnly')::boolean,false) or exists (
      select 1
      from public.wrike_task_normalized_custom_field_values reporting
      join public.wrike_normalized_custom_fields field on field.id=reporting.normalized_field_id
      where reporting.task_id=filtered.task_id and field.normalized_key='reporting'
        and reporting.reporting_year is not null and not reporting.has_conflict
    ));
$$;

create or replace function public.reporting_project_length_percentiles(target_task_ids uuid[])
returns table (
  task_id uuid,
  length_minutes integer,
  target_minutes bigint,
  cohort_average_minutes numeric,
  cohort_size bigint,
  lower_count bigint,
  tie_count bigint
)
language sql
stable
security invoker
set search_path=public
as $$
  with requested as materialized (
    select distinct requested_id as task_id
    from unnest(coalesce(target_task_ids[1:200],'{}'::uuid[])) requested_id
  ), visible_tasks as materialized (
    select task.id
    from public.reporting_accessible_task_ids() accessible
    join public.wrike_tasks task on task.id=accessible.task_id
    where task.organization_id=public.current_organization_id()
      and not task.is_deleted
      and task.custom_fields_sync_state='complete'
  ), length_values as materialized (
    select visible.id as task_id,array_agg(item.value order by item.value) as source_values
    from visible_tasks visible
    join public.wrike_task_normalized_custom_field_values field_value on field_value.task_id=visible.id
    join public.wrike_normalized_custom_fields field on field.id=field_value.normalized_field_id
      and field.normalized_key in ('course length','course duration','estimated course length')
    cross join lateral unnest(field_value.display_values) item(value)
    group by visible.id
  ), courses as materialized (
    select task_id,public.wrike_course_length_minutes(source_values) as length_minutes
    from length_values
  ), requested_lengths as materialized (
    select distinct course.length_minutes
    from courses course
    join requested on requested.task_id=course.task_id
    where course.length_minutes is not null
  ), comparable as materialized (
    select course.task_id,course.length_minutes
    from courses course
    join requested_lengths requested_length on requested_length.length_minutes=course.length_minutes
  ), time_by_task as materialized (
    select comparable.task_id,comparable.length_minutes,
      coalesce(sum(entry.minutes) filter (
        where entry.id is not null and not entry.is_deleted and entry.minutes>=0
          and public.can_access_wrike_time_entry(entry.id)
      ),0)::bigint as minutes
    from comparable
    left join public.wrike_time_entries entry on entry.task_id=comparable.task_id
    group by comparable.task_id,comparable.length_minutes
  ), ranked as materialized (
    select time_by_task.*,
      round(avg(minutes) over (partition by length_minutes)::numeric,2) as cohort_average_minutes,
      count(*) over (partition by length_minutes)::bigint as cohort_size,
      (rank() over (partition by length_minutes order by minutes)-1)::bigint as lower_count,
      count(*) over (partition by length_minutes,minutes)::bigint as tie_count
    from time_by_task
  )
  select ranked.task_id,ranked.length_minutes,ranked.minutes,ranked.cohort_average_minutes,
    ranked.cohort_size,ranked.lower_count,ranked.tie_count
  from ranked
  join requested on requested.task_id=ranked.task_id;
$$;

create or replace function public.reporting_project_length_percentile(target_task_id uuid)
returns table (
  length_minutes integer,
  target_minutes bigint,
  cohort_average_minutes numeric,
  cohort_size bigint,
  lower_count bigint,
  tie_count bigint
)
language sql
stable
security invoker
set search_path=public
as $$
  select percentile.length_minutes,percentile.target_minutes,percentile.cohort_average_minutes,
    percentile.cohort_size,percentile.lower_count,percentile.tie_count
  from public.reporting_project_length_percentiles(array[target_task_id]) percentile
  where percentile.task_id=target_task_id;
$$;

revoke all on function public.reporting_project_length_percentiles(uuid[]) from public;
grant execute on function public.reporting_project_length_percentiles(uuid[]) to authenticated,service_role;
grant execute on function public.reporting_project_length_percentile(uuid) to authenticated,service_role;
grant execute on function public.reporting_filtered_tasks(jsonb) to authenticated,service_role;
grant execute on function public.matches_reporting_vertical_filters(uuid,jsonb) to authenticated,service_role;

comment on function public.reporting_project_length_percentiles(uuid[]) is
  'Returns caller-visible same-length course time counts for up to 200 requested tasks in one set-based query.';

select pg_notify('pgrst','reload schema');
