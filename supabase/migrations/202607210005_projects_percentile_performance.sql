-- Remove per-row RLS permission function calls from Projects percentile cohorts.
-- Authorization is resolved once into visible task, source, and person sets.

create index if not exists wrike_time_entries_task_user_minutes_active_idx
  on public.wrike_time_entries(task_id,user_id)
  include (minutes)
  where not is_deleted;

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
security definer
set search_path=public
as $$
  with requested as materialized (
    select distinct requested_id as task_id
    from unnest(coalesce(target_task_ids[1:200],'{}'::uuid[])) requested_id
  ), viewer as materialized (
    select application_user.organization_id,
      application_user.role='admin' or not organization.reporting_access_enforced as unrestricted
    from public.application_users application_user
    join public.organizations organization on organization.id=application_user.organization_id
    where application_user.id=auth.uid()
  ), visible_tasks as materialized (
    select task.id
    from public.reporting_accessible_task_ids() accessible
    join public.wrike_tasks task on task.id=accessible.task_id
    join viewer on viewer.organization_id=task.organization_id
    where not task.is_deleted and task.custom_fields_sync_state='complete'
  ), course_length_fields as materialized (
    select field.id
    from public.wrike_normalized_custom_fields field
    join viewer on viewer.organization_id=field.organization_id
    where field.normalized_key in ('course length','course duration','estimated course length')
  ), length_values as materialized (
    select visible.id as task_id,array_agg(item.value order by item.value) as source_values
    from visible_tasks visible
    join public.wrike_task_normalized_custom_field_values field_value on field_value.task_id=visible.id
    join course_length_fields field on field.id=field_value.normalized_field_id
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
  ), candidate_groups as materialized (
    select reporting_group.id as group_id,reporting_group.match_mode,
      exists(select 1 from public.reporting_group_scopes source_rule where source_rule.group_id=reporting_group.id) as has_sources,
      exists(select 1 from public.reporting_group_wrike_users person_rule where person_rule.group_id=reporting_group.id) as has_people
    from public.reporting_groups reporting_group
    join public.reporting_group_members membership
      on membership.group_id=reporting_group.id and membership.application_user_id=auth.uid()
    join viewer on viewer.organization_id=reporting_group.organization_id
    where reporting_group.is_active and not viewer.unrestricted
  ), source_matches as materialized (
    select distinct candidate.group_id,comparable.task_id
    from candidate_groups candidate
    join public.reporting_group_scopes source_rule on source_rule.group_id=candidate.group_id
    join public.wrike_scope_tasks scoped_task on scoped_task.scope_id=source_rule.scope_id
    join comparable on comparable.task_id=scoped_task.task_id
  ), person_rules as materialized (
    select candidate.group_id,person_rule.wrike_user_id
    from candidate_groups candidate
    join public.reporting_group_wrike_users person_rule on person_rule.group_id=candidate.group_id
  ), visible_entry_totals as materialized (
    select entry.task_id,sum(entry.minutes)::bigint as minutes
    from public.wrike_time_entries entry
    join comparable on comparable.task_id=entry.task_id
    join viewer on viewer.organization_id=entry.organization_id
    where not entry.is_deleted and entry.minutes>=0 and (
      viewer.unrestricted or exists (
        select 1
        from candidate_groups candidate
        where (candidate.has_sources or candidate.has_people) and case
          when candidate.has_sources and not candidate.has_people then exists(
            select 1 from source_matches source_match
            where source_match.group_id=candidate.group_id and source_match.task_id=entry.task_id
          )
          when candidate.has_people and not candidate.has_sources then exists(
            select 1 from person_rules person_rule
            where person_rule.group_id=candidate.group_id and person_rule.wrike_user_id=entry.user_id
          )
          when candidate.match_mode='intersection' then
            exists(select 1 from source_matches source_match where source_match.group_id=candidate.group_id and source_match.task_id=entry.task_id)
            and exists(select 1 from person_rules person_rule where person_rule.group_id=candidate.group_id and person_rule.wrike_user_id=entry.user_id)
          else
            exists(select 1 from source_matches source_match where source_match.group_id=candidate.group_id and source_match.task_id=entry.task_id)
            or exists(select 1 from person_rules person_rule where person_rule.group_id=candidate.group_id and person_rule.wrike_user_id=entry.user_id)
          end
      )
    )
    group by entry.task_id
  ), time_by_task as materialized (
    select comparable.task_id,comparable.length_minutes,coalesce(entry_total.minutes,0)::bigint as minutes
    from comparable
    left join visible_entry_totals entry_total on entry_total.task_id=comparable.task_id
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

revoke all on function public.reporting_project_length_percentiles(uuid[]) from public;
grant execute on function public.reporting_project_length_percentiles(uuid[]) to authenticated,service_role;

comment on function public.reporting_project_length_percentiles(uuid[]) is
  'Returns same-length percentile cohorts for up to 200 caller-visible tasks using set-based task and timelog authorization.';

select pg_notify('pgrst','reload schema');
