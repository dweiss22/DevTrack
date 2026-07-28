-- Exact Wrike custom-field assignment boundaries for SME/ID dashboards and
-- permanent SME-side locking of submitted course-development debriefs.

create or replace function public.normalize_project_assignment_name(value text)
returns text
language sql
immutable
parallel safe
set search_path=public
as $$
  select lower(regexp_replace(coalesce(btrim(value),''),'\s+',' ','g'));
$$;

create or replace function public.course_development_person_assignments(
  target_organization_id uuid,target_role text
)
returns table(task_id uuid,wrike_user_id uuid,assignment_source text)
language sql
stable
security definer
set search_path=public
as $$
  with eligible as (
    select task.id
    from public.wrike_tasks task
    where task.organization_id=target_organization_id
      and (
        auth.role()='service_role'
        or target_organization_id=public.current_organization_id()
      )
      and not task.is_deleted
      and (
        task.workflow_id='IEACHQK7K4BHMLHM'
        or exists(
          select 1
          from public.wrike_workflow_statuses status
          where status.organization_id=task.organization_id
            and status.wrike_id=task.custom_status_id
            and status.workflow_id='IEACHQK7K4BHMLHM'
            and not status.is_unresolved
        )
      )
  ), role_values as (
    select task.id task_id,token.value
    from eligible task
    join public.wrike_task_normalized_custom_field_values field_value
      on field_value.task_id=task.id
      and not field_value.has_conflict
      and cardinality(field_value.source_wrike_field_ids)>0
    join public.wrike_normalized_custom_fields field
      on field.id=field_value.normalized_field_id
      and field.organization_id=target_organization_id
    cross join lateral public.course_development_person_tokens(
      field_value.display_values
    ) token
    where (
      target_role='sme' and field.normalized_key='sme'
    ) or (
      target_role='id' and field.normalized_key='id assigned'
    )
  ), candidate_matches as (
    select role_value.task_id,role_value.value,identity.id wrike_user_id
    from role_values role_value
    join public.wrike_users identity
      on identity.organization_id=target_organization_id
      and identity.is_active
      and not identity.is_unresolved
      and identity.identity_verified
      and public.normalize_project_assignment_name(identity.display_name)
        =public.normalize_project_assignment_name(role_value.value)
    where public.normalize_project_assignment_name(role_value.value)<>''
  ), resolved as (
    select candidate.task_id,candidate.value,
      (array_agg(candidate.wrike_user_id order by candidate.wrike_user_id::text))[1]
        wrike_user_id
    from candidate_matches candidate
    group by candidate.task_id,candidate.value
    having count(distinct candidate.wrike_user_id)=1
  )
  select distinct resolved.task_id,resolved.wrike_user_id,
    'wrike_custom_field_exact_name'::text
  from resolved;
$$;

create or replace function public.course_development_person_assignments_with_personas(
  target_organization_id uuid,target_role text
)
returns table(task_id uuid,wrike_user_id uuid,assignment_source text)
language sql
stable
security definer
set search_path=public
as $$
  select assignment.task_id,assignment.wrike_user_id,
    assignment.assignment_source
  from public.course_development_person_assignments(
    target_organization_id,target_role
  ) assignment;
$$;

create or replace function public.course_development_unresolved_person_options(
  target_organization_id uuid,target_role text
)
returns table(
  identity_key text,display_name text,email text,identity_status text
)
language sql
stable
security definer
set search_path=public
as $$
  with observed as (
    select token.value,field_value.has_conflict
    from public.wrike_tasks task
    join public.wrike_task_normalized_custom_field_values field_value
      on field_value.task_id=task.id
      and cardinality(field_value.source_wrike_field_ids)>0
    join public.wrike_normalized_custom_fields field
      on field.id=field_value.normalized_field_id
      and field.organization_id=target_organization_id
    cross join lateral public.course_development_person_tokens(
      field_value.display_values
    ) token
    where task.organization_id=target_organization_id
      and (
        auth.role()='service_role'
        or target_organization_id=public.current_organization_id()
      )
      and not task.is_deleted
      and (
        task.workflow_id='IEACHQK7K4BHMLHM'
        or exists(
          select 1
          from public.wrike_workflow_statuses status
          where status.organization_id=task.organization_id
            and status.wrike_id=task.custom_status_id
            and status.workflow_id='IEACHQK7K4BHMLHM'
            and not status.is_unresolved
        )
      )
      and (
        (target_role='sme' and field.normalized_key='sme')
        or (target_role='id' and field.normalized_key='id assigned')
      )
  ), match_counts as (
    select observed.value,observed.has_conflict,
      count(distinct identity.id) match_count
    from observed
    left join public.wrike_users identity
      on identity.organization_id=target_organization_id
      and identity.is_active
      and not identity.is_unresolved
      and identity.identity_verified
      and public.normalize_project_assignment_name(identity.display_name)
        =public.normalize_project_assignment_name(observed.value)
    group by observed.value,observed.has_conflict
  )
  select
    'value:'||md5(public.normalize_project_assignment_name(value)),
    min(value),null::text,
    case when bool_or(has_conflict) or max(match_count)>1
      then 'ambiguous' else 'unverified' end
  from match_counts
  where public.normalize_project_assignment_name(value)<>''
    and (has_conflict or match_count<>1)
  group by public.normalize_project_assignment_name(value)
  order by 2;
$$;

create or replace function public.is_course_development_person_assigned(
  target_task_id uuid,target_role text,target_wrike_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select target_wrike_user_id is not null and exists(
    select 1
    from public.wrike_tasks task
    join public.course_development_person_assignments(
      task.organization_id,target_role
    ) assignment
      on assignment.task_id=task.id
      and assignment.wrike_user_id=target_wrike_user_id
    where task.id=target_task_id
      and task.organization_id=public.current_organization_id()
      and not task.is_deleted
  );
$$;

create or replace function public.can_act_as_assigned_id(target_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select public.current_has_operational_role('id')
    and public.is_course_development_person_assigned(
      target_task_id,'id',public.current_operational_identity('id')
    );
$$;

create or replace function public.can_act_as_assigned_sme(target_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select public.current_has_operational_role('sme')
    and public.is_course_development_person_assigned(
      target_task_id,'sme',public.current_operational_identity('sme')
    );
$$;

create or replace function public.can_view_survey(target_submission_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1
    from public.survey_submissions survey
    join public.application_users viewer
      on viewer.id=public.current_effective_user_id()
      and viewer.organization_id=survey.organization_id
      and viewer.account_state='active'
    where survey.id=target_submission_id
      and (
        public.current_has_management_role('admin')
        or public.current_has_management_role('super_admin')
        or (
          survey.survey_type='course_development_debrief'
          and survey.status='draft'
          and survey.subject_application_user_id=viewer.id
          and public.survey_sme_status_available(survey.task_id)
          and public.current_has_operational_role('sme')
          and public.is_course_development_person_assigned(
            survey.task_id,'sme',public.current_operational_identity('sme')
          )
        )
        or (
          survey.survey_type='id_sme_review'
          and survey.created_by=viewer.id
          and public.current_has_operational_role('id')
          and public.is_course_development_person_assigned(
            survey.task_id,'id',public.current_operational_identity('id')
          )
        )
      )
  );
$$;

create or replace function public.can_edit_survey(target_submission_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1
    from public.survey_submissions survey
    join public.application_users viewer
      on viewer.id=public.current_effective_user_id()
      and viewer.organization_id=survey.organization_id
      and viewer.account_state='active'
    where survey.id=target_submission_id
      and not survey.is_locked
      and (
        public.current_has_management_role('admin')
        or public.current_has_management_role('super_admin')
        or (
          survey.survey_type='course_development_debrief'
          and survey.status='draft'
          and survey.subject_application_user_id=viewer.id
          and public.survey_sme_status_available(survey.task_id)
          and public.current_has_operational_role('sme')
          and public.is_course_development_person_assigned(
            survey.task_id,'sme',public.current_operational_identity('sme')
          )
        )
        or (
          survey.survey_type='id_sme_review'
          and public.current_has_operational_role('id')
          and public.is_course_development_person_assigned(
            survey.task_id,'id',public.current_operational_identity('id')
          )
          and (
            (survey.status='draft' and survey.created_by=viewer.id)
            or (
              survey.status='submitted'
              and (
                survey.created_by=viewer.id
                or survey.revision_assignee_id=viewer.id
              )
            )
          )
        )
      )
  );
$$;

create or replace function public.survey_sme_submission_receipt(
  target_task_id uuid
)
returns timestamptz
language sql
stable
security definer
set search_path=public
as $$
  select survey.latest_submitted_at
  from public.survey_submissions survey
  join public.application_users viewer
    on viewer.id=public.current_effective_user_id()
    and viewer.organization_id=survey.organization_id
    and viewer.account_state='active'
  where survey.task_id=target_task_id
    and survey.survey_type='course_development_debrief'
    and survey.status='submitted'
    and survey.subject_application_user_id=viewer.id
    and public.current_has_operational_role('sme')
    and public.is_course_development_person_assigned(
      survey.task_id,'sme',public.current_operational_identity('sme')
    )
  limit 1;
$$;

alter function public.survey_personal_create_or_resume(uuid,uuid)
  rename to survey_personal_create_or_resume_without_submitted_sme_lock;

create function public.survey_personal_create_or_resume(
  target_task_id uuid,target_reviewed_wrike_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  viewer public.application_users%rowtype;
  own_sme_identity uuid;
  existing_status text;
begin
  select * into viewer
  from public.application_users
  where id=public.current_effective_user_id()
    and account_state='active';
  own_sme_identity:=public.current_operational_identity('sme');

  if public.current_has_operational_role('sme')
    and viewer.role='sme' then
    if not public.is_course_development_person_assigned(
      target_task_id,'sme',own_sme_identity
    ) then
      raise exception using errcode='42501',
        message='Survey context is unavailable.';
    end if;
    select survey.status into existing_status
    from public.survey_submissions survey
    where survey.organization_id=viewer.organization_id
      and survey.task_id=target_task_id
      and survey.survey_type='course_development_debrief'
      and survey.subject_application_user_id=viewer.id;
    if existing_status='submitted' then
      raise exception using errcode='42501',
        message='Survey context is unavailable.';
    end if;
  end if;

  return public.survey_personal_create_or_resume_without_submitted_sme_lock(
    target_task_id,target_reviewed_wrike_user_id
  );
end;
$$;

alter function public.reporting_sme_dashboard_rows(uuid)
  rename to reporting_sme_dashboard_rows_with_sensitive_billing;

create function public.reporting_sme_dashboard_rows(
  target_wrike_user_id uuid default null
)
returns table(
  task_id uuid,title text,status_name text,status_color text,
  status_classification text,reporting_year integer,start_date date,
  original_due_date date,due_date date,completed_at timestamptz,
  actual_minutes bigint,is_overdue boolean,
  subject_application_user_id uuid,submission_id uuid,survey_status text,
  survey_is_locked boolean,survey_can_edit boolean,is_recent boolean,
  submitted_billable_hours numeric,submitted_amount_billed numeric,
  submitted_at timestamptz
)
language sql
stable
security definer
set search_path=public
as $$
  select
    source.task_id,source.title,source.status_name,source.status_color,
    source.status_classification,source.reporting_year,source.start_date,
    source.original_due_date,source.due_date,source.completed_at,
    source.actual_minutes,source.is_overdue,
    source.subject_application_user_id,source.submission_id,
    source.survey_status,source.survey_is_locked,source.survey_can_edit,
    source.is_recent,
    case when public.current_has_management_role('admin')
      or public.current_has_management_role('super_admin')
      then source.submitted_billable_hours end,
    case when public.current_has_management_role('admin')
      or public.current_has_management_role('super_admin')
      then source.submitted_amount_billed end,
    source.submitted_at
  from public.reporting_sme_dashboard_rows_with_sensitive_billing(
    target_wrike_user_id
  ) source;
$$;

alter function public.sme_project_detail(uuid,uuid)
  rename to sme_project_detail_with_submitted_responses;

create function public.sme_project_detail(
  target_task_id uuid,target_sme_wrike_user_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  result jsonb;
  submitted_at jsonb;
begin
  result:=public.sme_project_detail_with_submitted_responses(
    target_task_id,target_sme_wrike_user_id
  );
  if result is null then return null; end if;

  if not (
    public.current_has_management_role('admin')
    or public.current_has_management_role('super_admin')
  ) and result#>>'{debrief,status}'='submitted' then
    submitted_at:=result#>'{debrief,latestSubmittedAt}';
    result:=jsonb_set(
      result,'{debrief}',
      jsonb_build_object(
        'status','submitted',
        'latestSubmittedAt',submitted_at
      ),
      true
    );
  end if;
  return result;
end;
$$;

revoke all on function public.normalize_project_assignment_name(text) from public;
revoke all on function public.course_development_person_assignments(uuid,text) from public;
revoke all on function public.course_development_person_assignments_with_personas(uuid,text) from public;
revoke all on function public.course_development_unresolved_person_options(uuid,text) from public;
revoke all on function public.is_course_development_person_assigned(uuid,text,uuid) from public;
revoke all on function public.can_act_as_assigned_id(uuid) from public;
revoke all on function public.can_act_as_assigned_sme(uuid) from public;
revoke all on function public.can_view_survey(uuid) from public;
revoke all on function public.can_edit_survey(uuid) from public;
revoke all on function public.survey_sme_submission_receipt(uuid) from public;
revoke all on function public.survey_personal_create_or_resume(uuid,uuid) from public;
revoke all on function public.survey_personal_create_or_resume_without_submitted_sme_lock(uuid,uuid)
  from public,anon,authenticated;
revoke all on function public.reporting_sme_dashboard_rows(uuid) from public;
revoke all on function public.reporting_sme_dashboard_rows_with_sensitive_billing(uuid)
  from public,anon,authenticated;
revoke all on function public.sme_project_detail(uuid,uuid) from public;
revoke all on function public.sme_project_detail_with_submitted_responses(uuid,uuid)
  from public,anon,authenticated;

grant execute on function public.normalize_project_assignment_name(text)
  to authenticated,service_role;
grant execute on function public.course_development_person_assignments(uuid,text)
  to authenticated,service_role;
grant execute on function public.course_development_person_assignments_with_personas(uuid,text)
  to authenticated,service_role;
grant execute on function public.course_development_unresolved_person_options(uuid,text)
  to authenticated,service_role;
grant execute on function public.is_course_development_person_assigned(uuid,text,uuid)
  to authenticated,service_role;
grant execute on function public.can_act_as_assigned_id(uuid)
  to authenticated,service_role;
grant execute on function public.can_act_as_assigned_sme(uuid)
  to authenticated,service_role;
grant execute on function public.can_view_survey(uuid)
  to authenticated,service_role;
grant execute on function public.can_edit_survey(uuid)
  to authenticated,service_role;
grant execute on function public.survey_sme_submission_receipt(uuid)
  to authenticated,service_role;
grant execute on function public.survey_personal_create_or_resume(uuid,uuid)
  to authenticated,service_role;
grant execute on function public.reporting_sme_dashboard_rows(uuid)
  to authenticated,service_role;
grant execute on function public.sme_project_detail(uuid,uuid)
  to authenticated,service_role;

comment on function public.course_development_person_assignments(uuid,text) is
  'Returns only exact, unambiguous Wrike display-name matches from the SME or ID Assigned custom field. Application roles, responsible assignees, time entries, surveys, and prior participation never create assignments.';
comment on function public.can_view_survey(uuid) is
  'Admins retain survey access. SMEs may read only their eligible assignment-scoped draft debrief; a submitted SME debrief is not viewable through RLS, APIs, attachments, revisions, or storage.';

select pg_notify('pgrst','reload schema');
