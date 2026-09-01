-- Jeff Dino (an external SME with no Wrike account) could not open a project
-- from his own SME Dashboard list: the project detail RPC collapsed two very
-- different situations into the same generic "not_assigned" state --
-- (a) the SME truly is not named in the project's SME field, and
-- (b) the project's SME field has conflicting/ambiguous values, so the
--     assignment is suppressed even though the SME's name does appear.
-- Distinguish the two so the UI can explain what actually happened, and stop
-- implying a Wrike login is required -- the SME field is a Wrike task custom
-- field value, not a link to the SME's own Wrike account, and SMEs without a
-- Wrike account are fully supported via link_application_user_sme_identity().

create or replace function public.is_sme_identity_assigned(
  target_task_id uuid,target_sme_identity_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select target_sme_identity_id is not null and exists(
    select 1
    from public.sme_dashboard_task_assignments assignment
    join public.sme_dashboard_identities identity
      on identity.id=assignment.sme_identity_id
    where assignment.task_id=target_task_id
      and assignment.sme_identity_id=target_sme_identity_id
      and assignment.organization_id=public.current_organization_id()
      and not assignment.source_has_conflict
      and identity.resolution_status<>'ambiguous'
  );
$$;

create or replace function public.sme_identity_assignment_conflict(
  target_task_id uuid,target_sme_identity_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select target_sme_identity_id is not null and exists(
    select 1
    from public.sme_dashboard_task_assignments assignment
    join public.sme_dashboard_identities identity
      on identity.id=assignment.sme_identity_id
    where assignment.task_id=target_task_id
      and assignment.sme_identity_id=target_sme_identity_id
      and assignment.organization_id=public.current_organization_id()
      and (assignment.source_has_conflict or identity.resolution_status='ambiguous')
  );
$$;

revoke all on function public.sme_identity_assignment_conflict(uuid,uuid) from public;
grant execute on function public.sme_identity_assignment_conflict(uuid,uuid)
  to authenticated,service_role;
comment on function public.sme_identity_assignment_conflict(uuid,uuid) is
  'True when the SME appears in the task''s SME field but the field has conflicting or ambiguous values, distinct from not being assigned at all.';

create or replace function public.sme_project_detail_by_identity_restricted_base(
  target_task_id uuid,target_sme_identity_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  viewer public.application_users%rowtype;
  selected_identity public.sme_dashboard_identities%rowtype;
  task_record public.wrike_tasks%rowtype;
  result jsonb;
  debrief jsonb;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  if viewer.id is null or not public.current_has_capability('view_sme_dashboard') then
    return jsonb_build_object('state','unavailable');
  end if;
  if public.current_has_capability('select_sme_dashboard_user') then
    select * into selected_identity from public.sme_dashboard_identities
    where id=target_sme_identity_id
      and organization_id=viewer.organization_id;
    if selected_identity.id is null then
      return jsonb_build_object('state','selection_required');
    end if;
  else
    select * into selected_identity from public.sme_dashboard_identities
    where id=public.current_sme_dashboard_identity()
      and organization_id=viewer.organization_id;
    if selected_identity.id is null then
      return jsonb_build_object('state','mapping_missing');
    end if;
  end if;
  if selected_identity.resolution_status='ambiguous' then
    return jsonb_build_object('state','identity_unavailable');
  end if;
  if not public.is_sme_identity_assigned(target_task_id,selected_identity.id) then
    if public.sme_identity_assignment_conflict(target_task_id,selected_identity.id) then
      return jsonb_build_object('state','assignment_conflict');
    end if;
    return jsonb_build_object('state','not_assigned');
  end if;
  select * into task_record from public.wrike_tasks
  where id=target_task_id and organization_id=viewer.organization_id
    and not is_deleted;
  if task_record.id is null then
    return jsonb_build_object('state','not_found');
  end if;
  select case when survey.status='submitted'
    and not public.current_has_capability('view_sme_survey_details')
    then jsonb_build_object(
      'status','submitted','latestSubmittedAt',survey.latest_submitted_at
    ) else jsonb_build_object(
      'id',survey.id,'status',survey.status,'isLocked',survey.is_locked,
      'canEdit',public.can_edit_survey(survey.id),
      'revisionNumber',survey.revision_number,
      'firstSubmittedAt',survey.original_submitted_at,
      'latestSubmittedAt',survey.latest_submitted_at,
      'response',jsonb_build_object(
        'internalEmployee',survey.answers->'internalEmployee',
        'billableHours',case when survey.status='submitted'
          then survey.answers->'billableHours' end,
        'amountBilled',case when survey.status='submitted'
          then survey.answers->'amountBilled' end,
        'workStartedOn',survey.answers->'workStartedOn',
        'workFinishedOn',survey.answers->'workFinishedOn',
        'ratings',jsonb_build_array(
          survey.answers#>'{collaborationRatings,rating01}',
          survey.answers#>'{collaborationRatings,rating02}',
          survey.answers#>'{collaborationRatings,rating03}',
          survey.answers#>'{collaborationRatings,rating04}',
          survey.answers#>'{collaborationRatings,rating05}',
          survey.answers#>'{collaborationRatings,rating06}',
          survey.answers#>'{collaborationRatings,rating07}',
          survey.answers#>'{collaborationRatings,rating08}',
          survey.answers#>'{collaborationRatings,rating09}',
          survey.answers#>'{collaborationRatings,rating10}'
        ),
        'comments',survey.answers->'comments'
      ),
      'attachments',case
        when public.current_has_capability('view_sme_survey_details')
        then coalesce((
          select jsonb_agg(jsonb_build_object(
            'id',attachment.id,'filename',attachment.original_filename,
            'sizeBytes',attachment.size_bytes,
            'uploadedAt',attachment.uploaded_at
          ) order by attachment.uploaded_at desc)
          from public.survey_attachments attachment
          where attachment.submission_id=survey.id and attachment.is_active
        ),'[]'::jsonb) else '[]'::jsonb end
    ) end into debrief
  from public.survey_submissions survey
  where survey.organization_id=viewer.organization_id
    and survey.task_id=target_task_id
    and survey.survey_type='course_development_debrief'
    and survey.sme_identity_id=selected_identity.id;

  select jsonb_build_object(
    'state','allowed',
    'taskId',task_record.id,
    'title',task_record.title,
    'status',coalesce(status.title,task_record.status),
    'statusColor',status.color,
    'reportingYear',reporting.reporting_year,
    'assignedIds',coalesce(ids.items,'[]'::jsonb),
    'vertical',course.vertical_value,
    'courseLength',course.course_length,
    'legalReviewer',course.legal_reviewer,
    'debrief',debrief,
    'finalizedDraft',coalesce(draft.value,jsonb_build_object('available',false)),
    'timeline',jsonb_build_object(
      'startDate',task_record.start_date,
      'originalDueDate',task_record.original_due_date,
      'dueDate',task_record.due_date,
      'completedAt',task_record.completed_at
    ),
    'categoryTime',coalesce(time_data.items,'[]'::jsonb),
    'subjectApplicationUserId',selected_identity.application_user_id,
    'isRecent',case when task_record.completed_at is not null
      then task_record.completed_at::date>=current_date-interval '12 months'
      else task_record.due_date is not null
        and task_record.due_date>=current_date-interval '12 months' end,
    'selectedSmeIdentityId',selected_identity.id,
    'selectedSmeWrikeUserId',null
  ) into result
  from (select 1) seed
  left join public.wrike_workflow_statuses status
    on status.organization_id=viewer.organization_id
    and status.wrike_id=task_record.custom_status_id
  left join lateral (
    select value.reporting_year
    from public.wrike_task_normalized_custom_field_values value
    join public.wrike_normalized_custom_fields field
      on field.id=value.normalized_field_id
    where value.task_id=task_record.id
      and field.normalized_key in ('reporting','reporting year')
      and not value.has_conflict limit 1
  ) reporting on true
  left join lateral (
    select
      max(value.vertical_reporting_category)
        filter(where field.normalized_key='vertical'
          and not value.has_conflict and not value.has_unresolved_vertical)
        vertical_value,
      max(array_to_string(value.display_values,', '))
        filter(where field.normalized_key in (
          'course length','course duration','estimated course length'
        ) and not value.has_conflict) course_length,
      max(array_to_string(value.display_values,', '))
        filter(where field.normalized_key='legal reviewer'
          and not value.has_conflict) legal_reviewer
    from public.wrike_task_normalized_custom_field_values value
    join public.wrike_normalized_custom_fields field
      on field.id=value.normalized_field_id
    where value.task_id=task_record.id
  ) course on true
  left join lateral (
    -- Prefer a verified Wrike identity match, but fall back to the raw
    -- "ID Assigned" field text so a name still surfaces here whenever the
    -- ID Dashboard itself would show one, keeping the two views consistent.
    select jsonb_agg(distinct combined.value) items
    from (
      select jsonb_build_object(
        'wrikeUserId',identity.id,'name',identity.display_name
      ) value
      from public.course_development_person_assignments(
        viewer.organization_id,'id'
      ) assignment
      join public.wrike_users identity on identity.id=assignment.wrike_user_id
      where assignment.task_id=task_record.id
      union all
      select jsonb_build_object(
        'wrikeUserId',null,'name',value.display_values[index]
      ) value
      from public.wrike_task_normalized_custom_field_values value
      join public.wrike_normalized_custom_fields field
        on field.id=value.normalized_field_id
        and field.normalized_key in ('id assigned','instructional designer')
      cross join lateral generate_subscripts(value.display_values,1) index
      where value.task_id=task_record.id
        and not exists(
          select 1 from public.course_development_person_assignments(
            viewer.organization_id,'id'
          ) assignment
          where assignment.task_id=task_record.id
        )
    ) combined
  ) ids on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'category',grouped.category_name,'minutes',grouped.minutes
    ) order by grouped.minutes desc,grouped.category_name) items
    from (
      select coalesce(category.title,'Uncategorized') category_name,
        sum(entry.minutes)::bigint minutes
      from public.wrike_time_entries entry
      left join public.wrike_timelog_categories category
        on category.organization_id=viewer.organization_id
        and category.wrike_id=entry.category
      where entry.task_id=task_record.id and not entry.is_deleted
      group by coalesce(category.title,'Uncategorized')
    ) grouped
  ) time_data on true
  left join lateral (
    select jsonb_build_object(
      'available',stored.url is not null,
      'url',stored.url,'updatedAt',stored.updated_at
    ) value
    from public.project_finalized_course_drafts stored
    where stored.task_id=task_record.id
  ) draft on true;
  return result;
end;
$$;

select pg_notify('pgrst','reload schema');
