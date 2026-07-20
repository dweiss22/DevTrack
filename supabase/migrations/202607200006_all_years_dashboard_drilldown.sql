-- Keep all-years Dashboard drill-down results aligned with Dashboard metrics by
-- excluding Missing/Unresolved Reporting records from every chart selection.

create or replace function public.reporting_filtered_tasks(filters jsonb default '{}'::jsonb)
returns table (task_id uuid, visible_actual_minutes bigint)
language sql
stable
security definer
set search_path=public
as $$
  select filtered.task_id,filtered.visible_actual_minutes
  from public.reporting_filtered_tasks_without_dashboard_drilldown(
    case when filters ?| array['workflowIds','reportingYear','dashboardClassification','dashboardField','dashboardValue']
      then filters - 'state' else filters end
  ) filtered
  where public.matches_reporting_dashboard_drilldown(filtered.task_id,filters)
    and (not coalesce((filters->>'validReportingYearOnly')::boolean,false) or exists (
      select 1
      from public.wrike_task_normalized_custom_field_values reporting
      join public.wrike_normalized_custom_fields field on field.id=reporting.normalized_field_id
      where reporting.task_id=filtered.task_id and field.normalized_key='reporting'
        and reporting.reporting_year is not null and not reporting.has_conflict
    ));
$$;

revoke all on function public.reporting_filtered_tasks(jsonb) from public;
grant execute on function public.reporting_filtered_tasks(jsonb) to authenticated,service_role;

comment on function public.reporting_filtered_tasks(jsonb) is 'Caller-aware reporting filters plus exact single-year and all-valid-years Dashboard drill-down bucket matching.';

select pg_notify('pgrst','reload schema');
