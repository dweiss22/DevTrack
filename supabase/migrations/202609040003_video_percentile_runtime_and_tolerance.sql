-- Extend the Development Percentile benchmark (previously Online-Learning-
-- only, exact-duration-only) to also cover completed Single Video projects,
-- including Roll Call Training tasks on the separate Microtraining
-- Development workflow, and to compare against a +/-1 minute runtime window
-- instead of requiring an exact-minute match.
--
-- Microtraining Development completion is recognized either through the
-- normal dashboard_classification='completed' path (if that workflow's
-- statuses sync with a Wrike "Completed" group) or explicitly via its two
-- Green statuses "Ready for Publication" (IEACHQK7JMGZVZAK) and
-- "Closed-Released" (IEACHQK7JMGH6TV5), whichever applies.

create or replace function public.reporting_project_percentile_evidence(target_organization_id uuid)
returns table (
  task_id uuid,
  organization_id uuid,
  wrike_task_id text,
  project_title text,
  task_workflow_id text,
  status_workflow_id text,
  workflow_name text,
  status_id text,
  status_title text,
  dashboard_classification text,
  completion_eligible boolean,
  custom_fields_sync_state text,
  raw_course_length_values text[],
  length_minutes integer,
  course_length_source_ids text[],
  course_length_source_titles text[],
  course_length_conflict boolean,
  raw_course_style_values text[],
  normalized_course_style text,
  course_style_source_ids text[],
  course_style_source_titles text[],
  course_style_conflict boolean,
  total_logged_minutes bigint,
  time_entry_count bigint,
  deleted_time_entry_count bigint,
  time_data_reliable boolean,
  eligibility_reason text
)
language sql
stable
security definer
set search_path=public
as $$
  with organization_tasks as materialized (
    select task.*
    from public.wrike_tasks task
    where task.organization_id=target_organization_id
  ), length_fields as materialized (
    select field.id
    from public.wrike_normalized_custom_fields field
    where field.organization_id=target_organization_id
      and field.normalized_key in ('course length','course duration','estimated course length','runtime')
  ), length_evidence as materialized (
    select field_value.task_id,
      coalesce(
        array_agg(distinct observed.value order by observed.value)
          filter(where observed.value is not null and btrim(observed.value)<>''),
        '{}'::text[]
      ) as raw_values,
      coalesce(
        array_agg(distinct source_id.value order by source_id.value)
          filter(where source_id.value is not null and btrim(source_id.value)<>''),
        '{}'::text[]
      ) as source_ids,
      coalesce(
        array_agg(distinct source_title.value order by source_title.value)
          filter(where source_title.value is not null and btrim(source_title.value)<>''),
        '{}'::text[]
      ) as source_titles,
      bool_or(coalesce(field_value.has_conflict,false)) as has_conflict
    from public.wrike_task_normalized_custom_field_values field_value
    join length_fields field on field.id=field_value.normalized_field_id
    left join lateral unnest(coalesce(field_value.display_values,'{}'::text[])) observed(value) on true
    left join lateral unnest(coalesce(field_value.source_wrike_field_ids,'{}'::text[])) source_id(value) on true
    left join lateral unnest(coalesce(field_value.source_titles,'{}'::text[])) source_title(value) on true
    group by field_value.task_id
  ), style_fields as materialized (
    select field.id
    from public.wrike_normalized_custom_fields field
    where field.organization_id=target_organization_id
      and field.normalized_key='course style'
  ), style_evidence as materialized (
    select field_value.task_id,
      coalesce(
        array_agg(distinct observed.value order by observed.value)
          filter(where observed.value is not null and btrim(observed.value)<>''),
        '{}'::text[]
      ) as raw_values,
      coalesce(
        array_agg(distinct source_id.value order by source_id.value)
          filter(where source_id.value is not null and btrim(source_id.value)<>''),
        '{}'::text[]
      ) as source_ids,
      coalesce(
        array_agg(distinct source_title.value order by source_title.value)
          filter(where source_title.value is not null and btrim(source_title.value)<>''),
        '{}'::text[]
      ) as source_titles,
      bool_or(coalesce(field_value.has_conflict,false)) as has_conflict
    from public.wrike_task_normalized_custom_field_values field_value
    join style_fields field on field.id=field_value.normalized_field_id
    left join lateral unnest(coalesce(field_value.display_values,'{}'::text[])) observed(value) on true
    left join lateral unnest(coalesce(field_value.source_wrike_field_ids,'{}'::text[])) source_id(value) on true
    left join lateral unnest(coalesce(field_value.source_titles,'{}'::text[])) source_title(value) on true
    group by field_value.task_id
  ), time_evidence as materialized (
    select task.id as task_id,
      coalesce(sum(entry.minutes) filter(where entry.id is not null and not entry.is_deleted),0)::bigint
        as total_minutes,
      count(entry.id) filter(where not entry.is_deleted)::bigint as active_entry_count,
      count(entry.id) filter(where entry.is_deleted)::bigint as deleted_entry_count,
      (
        count(entry.id) filter(where not entry.is_deleted)
        - count(distinct entry.wrike_id) filter(where not entry.is_deleted)
      )::bigint as duplicate_source_count
    from organization_tasks task
    left join public.wrike_time_entries entry
      on entry.organization_id=target_organization_id and entry.task_id=task.id
    group by task.id
  ), evidence as materialized (
    select task.id as task_id,
      task.organization_id,
      task.wrike_id as wrike_task_id,
      task.title as project_title,
      task.workflow_id as task_workflow_id,
      status_ref.workflow_id as status_workflow_id,
      case
        when status_ref.workflow_id='IEACHQK7K4BHMLHM' then 'Online Learning'
        when status_ref.workflow_id='IEACHQK7K4GH6TV4' then 'Microtraining Development'
      end as workflow_name,
      task.custom_status_id as status_id,
      status_ref.title as status_title,
      status_ref.dashboard_classification,
      (
        not task.is_deleted
        and status_ref.id is not null
        and not coalesce(status_ref.is_unresolved,true)
        and status_ref.workflow_id in ('IEACHQK7K4BHMLHM','IEACHQK7K4GH6TV4')
        and (task.workflow_id is null or task.workflow_id in ('IEACHQK7K4BHMLHM','IEACHQK7K4GH6TV4'))
        and (
          status_ref.dashboard_classification='completed'
          or task.custom_status_id in ('IEACHQK7JMGZVZAK','IEACHQK7JMGH6TV5')
        )
      ) as completion_eligible,
      task.custom_fields_sync_state,
      coalesce(length.raw_values,'{}'::text[]) as raw_course_length_values,
      public.wrike_course_length_minutes(coalesce(length.raw_values,'{}'::text[]))
        as length_minutes,
      coalesce(length.source_ids,'{}'::text[]) as course_length_source_ids,
      coalesce(length.source_titles,'{}'::text[]) as course_length_source_titles,
      coalesce(length.has_conflict,false) as course_length_conflict,
      coalesce(style.raw_values,'{}'::text[]) as raw_course_style_values,
      public.wrike_course_style(coalesce(style.raw_values,'{}'::text[]))
        as normalized_course_style,
      coalesce(style.source_ids,'{}'::text[]) as course_style_source_ids,
      coalesce(style.source_titles,'{}'::text[]) as course_style_source_titles,
      coalesce(style.has_conflict,false) as course_style_conflict,
      time_data.total_minutes as total_logged_minutes,
      time_data.active_entry_count as time_entry_count,
      time_data.deleted_entry_count as deleted_time_entry_count,
      (
        import_run.id is not null
        and import_run.status='succeeded'
        and import_run.timelog_descendant_strategy in ('folder_recursive','explicit_tree')
        and import_run.failed_folder_request_count=0
        and time_data.active_entry_count>0
        and time_data.duplicate_source_count=0
      ) as time_data_reliable,
      task.is_deleted,
      coalesce(status_ref.is_unresolved,true) as status_is_unresolved,
      task.custom_status_id as raw_custom_status_id,
      import_run.id as import_run_id,
      import_run.status as import_run_status,
      import_run.timelog_descendant_strategy,
      import_run.failed_folder_request_count
    from organization_tasks task
    left join public.wrike_workflow_statuses status_ref
      on status_ref.organization_id=target_organization_id
      and status_ref.wrike_id=task.custom_status_id
    left join length_evidence length on length.task_id=task.id
    left join style_evidence style on style.task_id=task.id
    join time_evidence time_data on time_data.task_id=task.id
    left join public.wrike_folder_task_import_runs import_run
      on import_run.organization_id=target_organization_id
      and import_run.id=task.last_folder_import_run_id
  )
  select evidence.task_id,
    evidence.organization_id,
    evidence.wrike_task_id,
    evidence.project_title,
    evidence.task_workflow_id,
    evidence.status_workflow_id,
    evidence.workflow_name,
    evidence.status_id,
    evidence.status_title,
    evidence.dashboard_classification,
    evidence.completion_eligible,
    evidence.custom_fields_sync_state,
    evidence.raw_course_length_values,
    evidence.length_minutes,
    evidence.course_length_source_ids,
    evidence.course_length_source_titles,
    evidence.course_length_conflict,
    evidence.raw_course_style_values,
    evidence.normalized_course_style,
    evidence.course_style_source_ids,
    evidence.course_style_source_titles,
    evidence.course_style_conflict,
    evidence.total_logged_minutes,
    evidence.time_entry_count,
    evidence.deleted_time_entry_count,
    evidence.time_data_reliable,
    case
      when evidence.is_deleted then 'project_deleted'
      when evidence.status_id is null or evidence.status_is_unresolved
        or (evidence.dashboard_classification is null
          and evidence.raw_custom_status_id not in ('IEACHQK7JMGZVZAK','IEACHQK7JMGH6TV5'))
        then 'completion_status_unresolved'
      when evidence.status_workflow_id not in ('IEACHQK7K4BHMLHM','IEACHQK7K4GH6TV4')
        or (
          evidence.task_workflow_id is not null
          and evidence.task_workflow_id not in ('IEACHQK7K4BHMLHM','IEACHQK7K4GH6TV4')
        ) then 'wrong_workflow'
      when not evidence.completion_eligible then 'project_not_completed'
      when evidence.custom_fields_sync_state<>'complete' then 'custom_fields_incomplete'
      when evidence.course_length_conflict then 'course_length_ambiguous'
      when cardinality(evidence.raw_course_length_values)=0 then 'course_length_missing'
      when evidence.length_minutes is null then
        case
          when (
            select count(distinct public.wrike_course_length_value_minutes(value))
            from unnest(evidence.raw_course_length_values) value
            where public.wrike_course_length_value_minutes(value) is not null
          )>1 then 'course_length_ambiguous'
          else 'course_length_invalid'
        end
      when evidence.course_style_conflict then 'course_style_ambiguous'
      when cardinality(evidence.raw_course_style_values)=0 then 'course_style_missing'
      when evidence.normalized_course_style is null then
        case
          when (
            select count(distinct public.wrike_course_style_value(value))
            from unnest(evidence.raw_course_style_values) value
            where public.wrike_course_style_value(value) is not null
          )>1 then 'course_style_ambiguous'
          else 'course_style_unrecognized'
        end
      when not evidence.time_data_reliable then 'time_entry_data_incomplete'
      else null
    end as eligibility_reason
  from evidence;
$$;

drop function if exists public.reporting_project_length_percentile(uuid);
drop function if exists public.reporting_project_length_percentiles(uuid[]);

-- Cohorts now match any completed, comparable project whose normalized
-- runtime/course-length falls within +/-1 minute of the target's, rather
-- than requiring an exact-minute match, so a lateral per-target aggregation
-- replaces the previous single group-by.
create function public.reporting_project_length_percentiles(target_task_ids uuid[])
returns table (
  task_id uuid,
  length_minutes integer,
  course_style text,
  target_minutes bigint,
  cohort_average_minutes numeric,
  cohort_median_minutes numeric,
  cohort_size bigint,
  lower_count bigint,
  tie_count bigint,
  unavailable_reason text
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
    select public.current_organization_id() as organization_id
  ), evidence as materialized (
    select evidence.*
    from viewer
    cross join lateral public.reporting_project_percentile_evidence(viewer.organization_id) evidence
  ), target_evidence as materialized (
    select evidence.*
    from evidence
    join requested on requested.task_id=evidence.task_id
  ), eligible as materialized (
    select evidence.*
    from evidence
    where evidence.eligibility_reason is null
  ), per_target as materialized (
    select target.task_id,
      cohort.average_minutes,
      cohort.median_minutes,
      cohort.cohort_size,
      cohort.lower_count,
      cohort.tie_count
    from target_evidence target
    left join lateral (
      select round(avg(member.total_logged_minutes)::numeric,2) as average_minutes,
        round((
          percentile_cont(0.5) within group(order by member.total_logged_minutes)
        )::numeric,2) as median_minutes,
        count(*)::bigint as cohort_size,
        count(*) filter(where member.total_logged_minutes<target.total_logged_minutes)::bigint as lower_count,
        count(*) filter(where member.total_logged_minutes=target.total_logged_minutes)::bigint as tie_count
      from eligible member
      where target.eligibility_reason is null
        and member.normalized_course_style=target.normalized_course_style
        and abs(member.length_minutes-target.length_minutes)<=1
    ) cohort on true
  )
  select target.task_id,
    target.length_minutes,
    target.normalized_course_style as course_style,
    target.total_logged_minutes as target_minutes,
    per_target.average_minutes as cohort_average_minutes,
    per_target.median_minutes as cohort_median_minutes,
    coalesce(per_target.cohort_size,0)::bigint as cohort_size,
    per_target.lower_count,
    per_target.tie_count,
    case
      when target.eligibility_reason is not null then target.eligibility_reason
      when coalesce(per_target.cohort_size,0)<5 then 'not_enough_completed_comparable_courses'
      else null
    end as unavailable_reason
  from target_evidence target
  left join per_target on per_target.task_id=target.task_id;
$$;

create function public.reporting_project_length_percentile(target_task_id uuid)
returns table (
  length_minutes integer,
  course_style text,
  target_minutes bigint,
  cohort_average_minutes numeric,
  cohort_median_minutes numeric,
  cohort_size bigint,
  lower_count bigint,
  tie_count bigint,
  unavailable_reason text
)
language sql
stable
security definer
set search_path=public
as $$
  select percentile.length_minutes,
    percentile.course_style,
    percentile.target_minutes,
    percentile.cohort_average_minutes,
    percentile.cohort_median_minutes,
    percentile.cohort_size,
    percentile.lower_count,
    percentile.tie_count,
    percentile.unavailable_reason
  from public.reporting_project_length_percentiles(array[target_task_id]) percentile
  where percentile.task_id=target_task_id;
$$;

revoke all on function public.reporting_project_length_percentiles(uuid[]) from public;
revoke all on function public.reporting_project_length_percentile(uuid) from public;
grant execute on function public.reporting_project_length_percentiles(uuid[])
  to authenticated,service_role;
grant execute on function public.reporting_project_length_percentile(uuid)
  to authenticated,service_role;

comment on function public.reporting_project_length_percentiles(uuid[]) is
  'Empirical logged-time midrank inputs for up to 200 requested tasks. Cohorts contain only completed, reliable Online Learning or Microtraining Development projects with the same normalized Course Style and a runtime/course-length within +/-1 minute of the target; the target is included once.';
comment on function public.reporting_project_length_percentile(uuid) is
  'Single-task compatibility wrapper for the completed, comparable-duration-and-style Development Percentile benchmark.';

-- The admin audit's cohort membership must match the +/-1 minute tolerance
-- now used by reporting_project_length_percentiles instead of exact equality.
create or replace function public.admin_reporting_project_percentile_audit(target_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  viewer_organization_id uuid;
  audit_result jsonb;
begin
  select viewer.organization_id into viewer_organization_id
  from public.application_users viewer
  where viewer.id=auth.uid()
    and viewer.account_state='active'
    and viewer.role in ('super_admin','admin');

  if viewer_organization_id is null then
    raise exception 'Administrator access is required for percentile cohort audits.'
      using errcode='42501';
  end if;

  if not exists(
    select 1
    from public.wrike_tasks task
    where task.id=target_task_id
      and task.organization_id=viewer_organization_id
  ) then
    raise exception 'The requested project is not available in this organization.'
      using errcode='P0002';
  end if;

  with evidence as materialized (
    select *
    from public.reporting_project_percentile_evidence(viewer_organization_id)
  ), target as materialized (
    select *
    from evidence
    where task_id=target_task_id
  ), classified as materialized (
    select candidate.*,
      case
        when (select eligibility_reason from target) is not null then
          coalesce(candidate.eligibility_reason,'target_not_eligible')
        when candidate.eligibility_reason is not null then candidate.eligibility_reason
        when abs(candidate.length_minutes-(select length_minutes from target))>1 then 'wrong_duration'
        when candidate.normalized_course_style<>(select normalized_course_style from target)
          then 'different_course_style'
        else 'included'
      end as cohort_disposition
    from evidence candidate
  ), included as materialized (
    select *
    from classified
    where cohort_disposition='included'
  ), cohort as materialized (
    select count(*)::bigint as cohort_size,
      round(avg(total_logged_minutes)::numeric,2) as average_minutes,
      round((
        percentile_cont(0.5) within group(order by total_logged_minutes)
      )::numeric,2) as median_minutes,
      count(*) filter(
        where total_logged_minutes<(select total_logged_minutes from target)
      )::bigint as lower_count,
      count(*) filter(
        where total_logged_minutes=(select total_logged_minutes from target)
      )::bigint as tie_count
    from included
  )
  select jsonb_build_object(
    'target',(
      select jsonb_build_object(
        'taskId',target.task_id,
        'wrikeTaskId',target.wrike_task_id,
        'projectTitle',target.project_title,
        'workflow',target.workflow_name,
        'taskWorkflowId',target.task_workflow_id,
        'statusWorkflowId',target.status_workflow_id,
        'statusId',target.status_id,
        'status',target.status_title,
        'dashboardClassification',target.dashboard_classification,
        'completionEligible',target.completion_eligible,
        'eligibilityReason',target.eligibility_reason,
        'rawCourseLengthValues',target.raw_course_length_values,
        'normalizedDurationMinutes',target.length_minutes,
        'courseLengthSourceIds',target.course_length_source_ids,
        'courseLengthSourceTitles',target.course_length_source_titles,
        'courseLengthConflict',target.course_length_conflict,
        'rawCourseStyleValues',target.raw_course_style_values,
        'normalizedCourseStyle',target.normalized_course_style,
        'courseStyleSourceIds',target.course_style_source_ids,
        'courseStyleSourceTitles',target.course_style_source_titles,
        'courseStyleConflict',target.course_style_conflict,
        'totalLoggedMinutes',target.total_logged_minutes,
        'timeEntryCount',target.time_entry_count,
        'deletedTimeEntryCount',target.deleted_time_entry_count,
        'timeDataReliable',target.time_data_reliable
      )
      from target
    ),
    'cohort',(
      select jsonb_build_object(
        'size',cohort.cohort_size,
        'averageMinutes',cohort.average_minutes,
        'medianMinutes',cohort.median_minutes,
        'lowerCount',cohort.lower_count,
        'tieCount',cohort.tie_count,
        'calculatedPercentile',case
          when cohort.cohort_size>=5 then round(
            100.0 * (cohort.lower_count + 0.5 * cohort.tie_count)
              / cohort.cohort_size,
            2
          )
          else null
        end
      )
      from cohort
    ),
    'includedMembers',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'taskId',member.task_id,
          'wrikeTaskId',member.wrike_task_id,
          'projectTitle',member.project_title,
          'status',member.status_title,
          'completionClassification',member.dashboard_classification,
          'rawCourseLengthValues',member.raw_course_length_values,
          'normalizedDurationMinutes',member.length_minutes,
          'rawCourseStyleValues',member.raw_course_style_values,
          'normalizedCourseStyle',member.normalized_course_style,
          'loggedMinutes',member.total_logged_minutes,
          'timeEntryCount',member.time_entry_count,
          'inclusionReason','eligible_comparable_duration_style_completed'
        )
        order by member.total_logged_minutes,member.project_title,member.task_id
      )
      from included member
    ),'[]'::jsonb),
    'excludedCandidates',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'taskId',candidate.task_id,
          'wrikeTaskId',candidate.wrike_task_id,
          'projectTitle',candidate.project_title,
          'status',candidate.status_title,
          'completionClassification',candidate.dashboard_classification,
          'normalizedDurationMinutes',candidate.length_minutes,
          'normalizedCourseStyle',candidate.normalized_course_style,
          'loggedMinutes',candidate.total_logged_minutes,
          'timeEntryCount',candidate.time_entry_count,
          'exclusionReason',candidate.cohort_disposition
        )
        order by candidate.cohort_disposition,candidate.project_title,candidate.task_id
      )
      from classified candidate
      where candidate.cohort_disposition<>'included'
    ),'[]'::jsonb)
  )
  into audit_result;

  return audit_result;
end;
$$;

revoke all on function public.admin_reporting_project_percentile_audit(uuid) from public;
grant execute on function public.admin_reporting_project_percentile_audit(uuid)
  to authenticated,service_role;

comment on function public.admin_reporting_project_percentile_audit(uuid) is
  'Administrator-only read-only evidence for one Development Percentile target, including exact cohort members (+/-1 minute runtime tolerance) and reason-coded excluded organization candidates.';

select pg_notify('pgrst','reload schema');
