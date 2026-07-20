-- Preserve dashboard bucket semantics when a chart selection drills into the
-- general Projects report. The existing reporting filter remains the sole
-- source of authorized task IDs; this wrapper only narrows that result.

create or replace function public.matches_reporting_dashboard_drilldown(target_task_id uuid, filters jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  task_workflow_id text;
  status_workflow_id text;
  effective_classification text;
  task_due_date date;
  reporting_values text[];
  category_values text[];
  category_label text;
  requested_field text;
begin
  if not (filters ?| array['workflowIds','reportingYear','dashboardClassification','dashboardField','dashboardValue']) then
    return true;
  end if;

  select task.workflow_id,status_ref.workflow_id,
    case
      when status_ref.dashboard_classification='completed' then 'completed'
      when status_ref.dashboard_classification='stalled_or_canceled' then 'stalled_or_canceled'
      else 'active'
    end,task.due_date
  into task_workflow_id,status_workflow_id,effective_classification,task_due_date
  from public.wrike_tasks task
  left join public.wrike_workflow_statuses status_ref
    on status_ref.organization_id=task.organization_id and status_ref.wrike_id=task.custom_status_id
  where task.id=target_task_id;

  if not found then return false; end if;

  if filters ? 'workflowIds' and not (
    coalesce(task_workflow_id,'') in (select jsonb_array_elements_text(filters->'workflowIds'))
    or coalesce(status_workflow_id,'') in (select jsonb_array_elements_text(filters->'workflowIds'))
  ) then return false; end if;

  if filters ? 'dashboardClassification'
    and effective_classification <> filters->>'dashboardClassification'
  then return false; end if;

  -- The Dashboard defines state from its administrative status classification,
  -- whereas the general report historically uses Wrike's raw task state.
  if filters ? 'state' and case filters->>'state'
    when 'completed' then effective_classification <> 'completed'
    when 'cancelled' then effective_classification <> 'stalled_or_canceled'
    when 'open' then effective_classification <> 'active'
    when 'overdue' then effective_classification <> 'active' or task_due_date >= current_date or task_due_date is null
    else false end
  then return false; end if;

  if filters ? 'reportingYear' then
    select array_agg(display_value order by canonical_value)
    into reporting_values
    from (
      select lower(trim(regexp_replace(observed.value,'\s+',' ','g'))) as canonical_value,
        min(trim(regexp_replace(observed.value,'\s+',' ','g'))) as display_value
      from public.wrike_task_normalized_custom_field_values value
      join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
      cross join lateral unnest(value.display_values) observed(value)
      where value.task_id=target_task_id and field.normalized_key='reporting' and trim(observed.value)<>''
      group by lower(trim(regexp_replace(observed.value,'\s+',' ','g')))
    ) normalized_reporting;
    if public.wrike_reporting_year(reporting_values) is distinct from (filters->>'reportingYear')::integer
    then return false; end if;
  end if;

  if (filters ? 'dashboardField') <> (filters ? 'dashboardValue') then return false; end if;
  if filters ? 'dashboardField' then
    requested_field := filters->>'dashboardField';
    if requested_field not in ('course type','authoring tool','vertical') then return false; end if;

    select array_agg(display_value order by canonical_value)
    into category_values
    from (
      select lower(trim(regexp_replace(observed.value,'\s+',' ','g'))) as canonical_value,
        min(trim(regexp_replace(observed.value,'\s+',' ','g'))) as display_value
      from public.wrike_task_normalized_custom_field_values value
      join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
      cross join lateral unnest(value.display_values) observed(value)
      where value.task_id=target_task_id and field.normalized_key=requested_field and trim(observed.value)<>''
      group by lower(trim(regexp_replace(observed.value,'\s+',' ','g')))
    ) normalized_category;

    category_label := case
      when coalesce(cardinality(category_values),0)=0 then 'Unassigned'
      when cardinality(category_values)=1 then category_values[1]
      when requested_field='course type' then 'Multiple Course Types'
      when requested_field='authoring tool' then 'Multiple Authoring Tools'
      else 'Cross Vertical'
    end;
    if lower(category_label) <> lower(filters->>'dashboardValue') then return false; end if;
  end if;

  return true;
end;
$$;

do $$
begin
  if to_regprocedure('public.reporting_filtered_tasks_without_dashboard_drilldown(jsonb)') is null then
    alter function public.reporting_filtered_tasks(jsonb) rename to reporting_filtered_tasks_without_dashboard_drilldown;
  end if;
end;
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
    case when filters ?| array['workflowIds','reportingYear','dashboardClassification','dashboardField','dashboardValue']
      then filters - 'state' else filters end
  ) filtered
  where public.matches_reporting_dashboard_drilldown(filtered.task_id,filters);
$$;

revoke all on function public.matches_reporting_dashboard_drilldown(uuid,jsonb) from public;
revoke all on function public.reporting_filtered_tasks_without_dashboard_drilldown(jsonb) from public;
revoke all on function public.reporting_filtered_tasks(jsonb) from public;
grant execute on function public.reporting_filtered_tasks(jsonb) to authenticated,service_role;

comment on function public.reporting_filtered_tasks(jsonb) is 'Caller-aware reporting filters plus exact dashboard chart drill-down bucket matching.';

select pg_notify('pgrst','reload schema');
