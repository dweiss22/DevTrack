-- Keep filter-option discovery below the hosted statement timeout. The original
-- function evaluated can_access_wrike_task once for every normalized value row;
-- this migration resolves visible task IDs once and reuses that set.

create index if not exists wrike_task_assignees_user_task_idx
  on public.wrike_task_assignees(user_id,task_id);

create index if not exists wrike_time_entries_user_task_active_idx
  on public.wrike_time_entries(user_id,task_id)
  where user_id is not null and not is_deleted;

create or replace function public.reporting_accessible_task_ids()
returns table (task_id uuid)
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
    select task.id
    from public.wrike_tasks task
    where task.organization_id=viewer_organization_id and not task.is_deleted;
    return;
  end if;

  return query
  with candidate_groups as materialized (
    select reporting_group.id as group_id,reporting_group.match_mode,
      exists(select 1 from public.reporting_group_scopes scope_rule where scope_rule.group_id=reporting_group.id) as has_sources,
      exists(select 1 from public.reporting_group_wrike_users person_rule where person_rule.group_id=reporting_group.id) as has_people
    from public.reporting_groups reporting_group
    join public.reporting_group_members membership
      on membership.group_id=reporting_group.id and membership.application_user_id=auth.uid()
    where reporting_group.organization_id=viewer_organization_id and reporting_group.is_active
  ), source_matches as materialized (
    select distinct candidate.group_id,scoped_task.task_id as candidate_task_id
    from candidate_groups candidate
    join public.reporting_group_scopes scope_rule on scope_rule.group_id=candidate.group_id
    join public.wrike_scope_tasks scoped_task on scoped_task.scope_id=scope_rule.scope_id
  ), people_matches as materialized (
    select distinct candidate.group_id,assignee.task_id as candidate_task_id
    from candidate_groups candidate
    join public.reporting_group_wrike_users person_rule on person_rule.group_id=candidate.group_id
    join public.wrike_task_assignees assignee on assignee.user_id=person_rule.wrike_user_id
    union
    select distinct candidate.group_id,entry.task_id
    from candidate_groups candidate
    join public.reporting_group_wrike_users person_rule on person_rule.group_id=candidate.group_id
    join public.wrike_time_entries entry on entry.user_id=person_rule.wrike_user_id and not entry.is_deleted
  ), matched_tasks as (
    select source_match.candidate_task_id
    from candidate_groups candidate
    join source_matches source_match on source_match.group_id=candidate.group_id
    where candidate.has_sources and not candidate.has_people
    union
    select people_match.candidate_task_id
    from candidate_groups candidate
    join people_matches people_match on people_match.group_id=candidate.group_id
    where candidate.has_people and not candidate.has_sources
    union
    select source_match.candidate_task_id
    from candidate_groups candidate
    join source_matches source_match on source_match.group_id=candidate.group_id
    join people_matches people_match on people_match.group_id=candidate.group_id and people_match.candidate_task_id=source_match.candidate_task_id
    where candidate.has_sources and candidate.has_people and candidate.match_mode='intersection'
    union
    select source_match.candidate_task_id
    from candidate_groups candidate
    join source_matches source_match on source_match.group_id=candidate.group_id
    where candidate.has_sources and candidate.has_people and candidate.match_mode='union'
    union
    select people_match.candidate_task_id
    from candidate_groups candidate
    join people_matches people_match on people_match.group_id=candidate.group_id
    where candidate.has_sources and candidate.has_people and candidate.match_mode='union'
  )
  select task.id
  from public.wrike_tasks task
  join matched_tasks matched on matched.candidate_task_id=task.id
  where task.organization_id=viewer_organization_id and not task.is_deleted;
end;
$$;

create or replace function public.reporting_custom_field_options()
returns table (normalized_field_id uuid,normalized_title text,value text)
language sql
stable
security definer
set search_path=public
as $$
  with visible_tasks as materialized (
    select accessible.task_id from public.reporting_accessible_task_ids() accessible
  ), enabled_fields as materialized (
    select field.id,field.title
    from public.wrike_normalized_custom_fields field
    where field.organization_id=public.current_organization_id()
      and exists (
        select 1
        from public.wrike_normalized_custom_field_sources source
        join public.wrike_enabled_custom_fields enabled
          on enabled.custom_field_id=source.custom_field_id and enabled.organization_id=field.organization_id
        where source.normalized_field_id=field.id
      )
  )
  select field.id,field.title,observed.value
  from enabled_fields field
  join public.wrike_task_normalized_custom_field_values task_value on task_value.normalized_field_id=field.id
  join visible_tasks visible_task on visible_task.task_id=task_value.task_id
  cross join lateral unnest(task_value.display_values) observed(value)
  where trim(observed.value)<>''
  group by field.id,field.title,observed.value
  order by field.title,observed.value;
$$;

revoke all on function public.reporting_accessible_task_ids() from public;
revoke all on function public.reporting_custom_field_options() from public;
grant execute on function public.reporting_custom_field_options() to authenticated,service_role;

comment on function public.reporting_accessible_task_ids() is 'Set-based caller-authorized active task IDs for reporting support queries.';
comment on function public.reporting_custom_field_options() is 'Observed enabled custom-field values joined to one materialized set of caller-authorized tasks.';

select pg_notify('pgrst','reload schema');
