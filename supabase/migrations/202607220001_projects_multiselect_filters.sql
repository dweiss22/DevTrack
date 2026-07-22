-- Projects filters accept multiple choices with OR semantics inside each field.
-- Different fields remain combined with AND semantics.

create or replace function public.matches_reporting_normalized_custom_fields(target_task_id uuid,requested jsonb)
returns boolean
language sql
stable
set search_path=public
as $$
  select requested is null or not exists (
    select 1
    from jsonb_each(requested) wanted(key,requested_values)
    where not exists (
      select 1
      from public.wrike_task_normalized_custom_field_values field_value
      where field_value.task_id=target_task_id
        and field_value.normalized_field_id::text=wanted.key
        and exists (
          select 1
          from jsonb_array_elements_text(
            case jsonb_typeof(wanted.requested_values)
              when 'array' then wanted.requested_values
              else jsonb_build_array(wanted.requested_values)
            end
          ) selected(value)
          where selected.value=any(field_value.display_values)
        )
    )
  );
$$;

create or replace function public.matches_reporting_year_selections(target_task_id uuid,filters jsonb)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select not (filters ? 'reportingYears') or exists (
    select 1
    from public.wrike_task_normalized_custom_field_values reporting
    join public.wrike_normalized_custom_fields field on field.id=reporting.normalized_field_id
    join lateral jsonb_array_elements_text(filters->'reportingYears') selected(year) on true
    where reporting.task_id=target_task_id
      and field.normalized_key='reporting'
      and reporting.reporting_year is not null
      and not reporting.has_conflict
      and reporting.reporting_year=selected.year::integer
  );
$$;

create or replace function public.reporting_filtered_tasks(filters jsonb default '{}'::jsonb)
returns table (task_id uuid,visible_actual_minutes bigint)
language sql
stable
security definer
set search_path=public
as $$
  select filtered.task_id,filtered.visible_actual_minutes
  from public.reporting_filtered_tasks_without_dashboard_drilldown(
    case when filters ?| array[
      'workflowIds','reportingYear','reportingYears','dashboardClassification','dashboardField','dashboardValue',
      'verticalReportingCategory','associatedVertical','verticalState','unresolvedVerticalOnly','verticalSelections'
    ] then filters - 'state' else filters end
  ) filtered
  where public.matches_reporting_dashboard_drilldown(filtered.task_id,filters)
    and public.matches_reporting_year_selections(filtered.task_id,filters)
    and public.matches_reporting_vertical_filters(filtered.task_id,filters)
    and (not coalesce((filters->>'validReportingYearOnly')::boolean,false) or exists (
      select 1
      from public.wrike_task_normalized_custom_field_values reporting
      join public.wrike_normalized_custom_fields field on field.id=reporting.normalized_field_id
      where reporting.task_id=filtered.task_id and field.normalized_key='reporting'
        and reporting.reporting_year is not null and not reporting.has_conflict
    ));
$$;

revoke all on function public.matches_reporting_year_selections(uuid,jsonb) from public;
revoke all on function public.reporting_filtered_tasks(jsonb) from public;
grant execute on function public.matches_reporting_year_selections(uuid,jsonb) to authenticated,service_role;
grant execute on function public.reporting_filtered_tasks(jsonb) to authenticated,service_role;

comment on function public.matches_reporting_year_selections(uuid,jsonb) is
  'Matches any selected Projects reporting year while preserving validated normalized reporting data.';
comment on function public.matches_reporting_normalized_custom_fields(uuid,jsonb) is
  'Requires every selected custom field to match at least one of that field selection array values.';

select pg_notify('pgrst','reload schema');
