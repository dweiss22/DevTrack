-- Avoid row-by-row authorization work for organizations whose reporting data is
-- already visible to every member. Restricted organizations retain the existing
-- per-task and per-entry authorization path.

create or replace function public.reporting_filtered_tasks(filters jsonb default '{}'::jsonb)
returns table (task_id uuid, visible_actual_minutes bigint)
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  viewer_organization_id uuid;
  has_unrestricted_organization_access boolean;
begin
  select application_user.organization_id,
    application_user.role='admin' or not organization.reporting_access_enforced
  into viewer_organization_id,has_unrestricted_organization_access
  from public.application_users application_user
  join public.organizations organization on organization.id=application_user.organization_id
  where application_user.id=auth.uid();

  if viewer_organization_id is null then
    return;
  end if;

  if has_unrestricted_organization_access then
    return query
    with time_by_task as (
      select entry.task_id,sum(entry.minutes)::bigint as actual
      from public.wrike_time_entries entry
      where entry.organization_id=viewer_organization_id and not entry.is_deleted
        and (not (filters ? 'categoryIds') or entry.category in (select jsonb_array_elements_text(filters->'categoryIds')))
        and (coalesce(filters->>'dateField','due') <> 'tracked' or not (filters ? 'from') or entry.entry_date >= (filters->>'from')::date)
        and (coalesce(filters->>'dateField','due') <> 'tracked' or not (filters ? 'to') or entry.entry_date <= (filters->>'to')::date)
      group by entry.task_id
    ),candidates as (
      select task.id as candidate_task_id,coalesce(time_by_task.actual,0)::bigint as actual
      from public.wrike_tasks task
      left join time_by_task on time_by_task.task_id=task.id
      where task.organization_id=viewer_organization_id and not task.is_deleted
        and (not (filters ? 'taskIds') or task.id::text in (select jsonb_array_elements_text(filters->'taskIds')))
        and (not (filters ? 'q') or task.title ilike '%' || (filters->>'q') || '%' or coalesce(task.description,'') ilike '%' || (filters->>'q') || '%' or public.matches_reporting_normalized_custom_search(task.id,filters->>'q'))
        and (not (filters ? 'statuses') or public.matches_reporting_status(task.organization_id,task.status,task.custom_status_id,filters->'statuses'))
        and (not (filters ? 'state') or case filters->>'state'
          when 'completed' then task.completed_at is not null or lower(task.status)='completed'
          when 'cancelled' then lower(task.status)='cancelled'
          when 'open' then task.completed_at is null and lower(task.status) in ('active','deferred')
          when 'overdue' then task.completed_at is null and lower(task.status) in ('active','deferred') and task.due_date<current_date else true end)
        and (coalesce(filters->>'dateField','due')='tracked' or not (filters ? 'from') or case coalesce(filters->>'dateField','due') when 'start' then task.start_date when 'created' then task.created_at_wrike::date when 'completed' then task.completed_at::date else task.due_date end >= (filters->>'from')::date)
        and (coalesce(filters->>'dateField','due')='tracked' or not (filters ? 'to') or case coalesce(filters->>'dateField','due') when 'start' then task.start_date when 'created' then task.created_at_wrike::date when 'completed' then task.completed_at::date else task.due_date end <= (filters->>'to')::date)
        and (not (filters ? 'assigneeIds') or exists(select 1 from public.wrike_task_assignees assignee where assignee.task_id=task.id and assignee.user_id::text in (select jsonb_array_elements_text(filters->'assigneeIds'))))
        and (not (filters ? 'scopeIds') or exists(select 1 from public.wrike_scope_tasks scoped_task where scoped_task.task_id=task.id and scoped_task.scope_id::text in (select jsonb_array_elements_text(filters->'scopeIds'))))
        and (not (filters ? 'folderIds') or exists(select 1 from public.wrike_task_locations location where location.task_id=task.id and location.folder_id::text in (select jsonb_array_elements_text(filters->'folderIds'))))
        and (not (filters ? 'projectIds') or exists(select 1 from public.wrike_task_locations location where location.task_id=task.id and location.project_id::text in (select jsonb_array_elements_text(filters->'projectIds'))))
        and (not (filters ? 'customFields') or public.matches_reporting_normalized_custom_fields(task.id,filters->'customFields'))
    )
    select candidate.candidate_task_id,candidate.actual
    from candidates candidate
    where (coalesce(filters->>'dateField','due') <> 'tracked' or (not (filters ? 'from') and not (filters ? 'to')) or candidate.actual>0)
      and (not (filters ? 'categoryIds') or candidate.actual>0)
      and (not (filters ? 'timeState') or case filters->>'timeState' when 'with-time' then candidate.actual>0 when 'no-time' then candidate.actual=0 else true end)
      and (not (filters ? 'minMinutes') or candidate.actual >= (filters->>'minMinutes')::bigint)
      and (not (filters ? 'maxMinutes') or candidate.actual <= (filters->>'maxMinutes')::bigint)
      and (not (filters ? 'minPlannedMinutes') or (select coalesce(task.planned_minutes,0) from public.wrike_tasks task where task.id=candidate.candidate_task_id) >= (filters->>'minPlannedMinutes')::integer)
      and (not (filters ? 'maxPlannedMinutes') or (select coalesce(task.planned_minutes,0) from public.wrike_tasks task where task.id=candidate.candidate_task_id) <= (filters->>'maxPlannedMinutes')::integer);
    return;
  end if;

  return query
  with candidates as (
    select task.id as candidate_task_id,
      coalesce((select sum(entry.minutes) from public.wrike_time_entries entry
        where entry.task_id=task.id and not entry.is_deleted and public.can_access_wrike_time_entry(entry.id)
          and (not (filters ? 'categoryIds') or entry.category in (select jsonb_array_elements_text(filters->'categoryIds')))
          and (coalesce(filters->>'dateField','due') <> 'tracked' or not (filters ? 'from') or entry.entry_date >= (filters->>'from')::date)
          and (coalesce(filters->>'dateField','due') <> 'tracked' or not (filters ? 'to') or entry.entry_date <= (filters->>'to')::date)),0)::bigint as actual
    from public.wrike_tasks task
    where not task.is_deleted and public.can_access_wrike_task(task.id)
      and (not (filters ? 'taskIds') or task.id::text in (select jsonb_array_elements_text(filters->'taskIds')))
      and (not (filters ? 'q') or task.title ilike '%' || (filters->>'q') || '%' or coalesce(task.description,'') ilike '%' || (filters->>'q') || '%' or public.matches_reporting_normalized_custom_search(task.id,filters->>'q'))
      and (not (filters ? 'statuses') or public.matches_reporting_status(task.organization_id,task.status,task.custom_status_id,filters->'statuses'))
      and (not (filters ? 'state') or case filters->>'state' when 'completed' then task.completed_at is not null or lower(task.status)='completed' when 'cancelled' then lower(task.status)='cancelled' when 'open' then task.completed_at is null and lower(task.status) in ('active','deferred') when 'overdue' then task.completed_at is null and lower(task.status) in ('active','deferred') and task.due_date<current_date else true end)
      and (coalesce(filters->>'dateField','due')='tracked' or not (filters ? 'from') or case coalesce(filters->>'dateField','due') when 'start' then task.start_date when 'created' then task.created_at_wrike::date when 'completed' then task.completed_at::date else task.due_date end >= (filters->>'from')::date)
      and (coalesce(filters->>'dateField','due')='tracked' or not (filters ? 'to') or case coalesce(filters->>'dateField','due') when 'start' then task.start_date when 'created' then task.created_at_wrike::date when 'completed' then task.completed_at::date else task.due_date end <= (filters->>'to')::date)
      and (not (filters ? 'assigneeIds') or exists(select 1 from public.wrike_task_assignees assignee where assignee.task_id=task.id and assignee.user_id::text in (select jsonb_array_elements_text(filters->'assigneeIds'))))
      and (not (filters ? 'scopeIds') or exists(select 1 from public.wrike_scope_tasks scoped_task where scoped_task.task_id=task.id and scoped_task.scope_id::text in (select jsonb_array_elements_text(filters->'scopeIds'))))
      and (not (filters ? 'folderIds') or exists(select 1 from public.wrike_task_locations location where location.task_id=task.id and location.folder_id::text in (select jsonb_array_elements_text(filters->'folderIds'))))
      and (not (filters ? 'projectIds') or exists(select 1 from public.wrike_task_locations location where location.task_id=task.id and location.project_id::text in (select jsonb_array_elements_text(filters->'projectIds'))))
      and (not (filters ? 'customFields') or public.matches_reporting_normalized_custom_fields(task.id,filters->'customFields'))
  )
  select candidate.candidate_task_id,candidate.actual
  from candidates candidate
  where (coalesce(filters->>'dateField','due') <> 'tracked' or (not (filters ? 'from') and not (filters ? 'to')) or candidate.actual>0)
    and (not (filters ? 'categoryIds') or candidate.actual>0)
    and (not (filters ? 'timeState') or case filters->>'timeState' when 'with-time' then candidate.actual>0 when 'no-time' then candidate.actual=0 else true end)
    and (not (filters ? 'minMinutes') or candidate.actual >= (filters->>'minMinutes')::bigint)
    and (not (filters ? 'maxMinutes') or candidate.actual <= (filters->>'maxMinutes')::bigint)
    and (not (filters ? 'minPlannedMinutes') or (select coalesce(task.planned_minutes,0) from public.wrike_tasks task where task.id=candidate.candidate_task_id) >= (filters->>'minPlannedMinutes')::integer)
    and (not (filters ? 'maxPlannedMinutes') or (select coalesce(task.planned_minutes,0) from public.wrike_tasks task where task.id=candidate.candidate_task_id) <= (filters->>'maxPlannedMinutes')::integer);
end;
$$;

revoke all on function public.reporting_filtered_tasks(jsonb) from public;
grant execute on function public.reporting_filtered_tasks(jsonb) to authenticated,service_role;

-- The function can safely bypass table RLS because reporting_filtered_tasks is
-- the only task source and applies caller-aware access before returning IDs.
alter function public.reporting_online_learning_dashboard_v2(jsonb) security definer;

comment on function public.reporting_filtered_tasks(jsonb) is 'Caller-aware reporting filter with set-based time aggregation for organization-wide access and the original strict authorization path for restricted reporting groups.';
comment on function public.reporting_online_learning_dashboard_v2(jsonb) is 'RLS-equivalent Online Learning analytics sourced only from caller-authorized task IDs, with set-based aggregation for responsive dashboard loads.';

select pg_notify('pgrst','reload schema');
