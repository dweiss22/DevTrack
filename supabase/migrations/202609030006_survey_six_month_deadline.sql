-- Establish a hard six-month-after-completion survey deadline for BOTH
-- survey types. survey_sme_status_available() already enforces this for SME
-- debriefs, but it also requires the task to already be classified
-- 'completed' — a stricter gate that (unlike the 6-month cutoff) was never
-- part of the id_sme_review flow and shouldn't newly apply there. Add a
-- narrower check that only fails once the task is genuinely expired
-- (more than six months past completed_at); anything else (not yet
-- completed, missing completion date) is left exactly as before.
create or replace function public.survey_within_reflection_window(target_task_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((public.survey_sme_availability(target_task_id)->>'code')::text,'') is distinct from 'expired';
$$;

create or replace function public.can_edit_survey(target_submission_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1
    from public.survey_submissions survey
    join public.application_users viewer
      on viewer.id=public.current_effective_user_id()
      and viewer.organization_id=survey.organization_id
      and viewer.account_state='active'
    where survey.id=target_submission_id and not survey.is_locked
      and public.survey_within_reflection_window(survey.task_id)
      and (
        public.current_has_capability('manage_surveys')
        or (
          survey.status='draft'
          and survey.survey_type='course_development_debrief'
          and survey.subject_application_user_id=viewer.id
          and public.survey_sme_status_available(survey.task_id)
          and public.current_has_operational_role('sme')
          and public.is_sme_identity_assigned(
            survey.task_id,public.current_sme_dashboard_identity()
          )
        )
        or (
          survey.status='draft'
          and survey.survey_type='id_sme_review'
          and survey.created_by=viewer.id
          and public.current_has_operational_role('id')
          and public.is_course_development_person_assigned(
            survey.task_id,'id',public.current_operational_identity('id')
          )
          and public.is_sme_identity_assigned(
            survey.task_id,survey.sme_identity_id
          )
        )
      )
  );
$$;

create or replace function public.survey_personal_create_or_resume(
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

  if not public.survey_within_reflection_window(target_task_id) then
    raise exception using errcode='42501',
      message='This course has passed its six-month survey window.';
  end if;

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

create or replace function public.survey_personal_create_or_resume_for_sme_identity(
  target_task_id uuid,target_sme_identity_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  viewer public.application_users%rowtype;
  identity public.sme_dashboard_identities%rowtype;
  existing_id uuid;
  context jsonb;
  version public.survey_template_versions%rowtype;
  created_id uuid;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  if viewer.id is null or not public.current_has_operational_role('id')
    or target_sme_identity_id is null
    or not public.is_course_development_person_assigned(
      target_task_id,'id',public.current_operational_identity('id')
    ) then
    raise exception using errcode='42501',message='Survey context is unavailable.';
  end if;
  if not public.survey_within_reflection_window(target_task_id) then
    raise exception using errcode='42501',
      message='This course has passed its six-month survey window.';
  end if;
  select * into identity from public.sme_dashboard_identities
  where id=target_sme_identity_id
    and organization_id=viewer.organization_id
    and resolution_status<>'ambiguous';
  if identity.id is null or not public.is_sme_identity_assigned(
    target_task_id,identity.id
  ) then
    raise exception using errcode='42501',message='Survey context is unavailable.';
  end if;
  select survey.id into existing_id
  from public.survey_submissions survey
  where survey.organization_id=viewer.organization_id
    and survey.task_id=target_task_id
    and survey.survey_type='id_sme_review'
    and survey.sme_identity_id=identity.id
    and survey.created_by=viewer.id;
  if existing_id is not null then return existing_id; end if;
  select published.* into version
  from public.survey_template_versions published
  join public.survey_templates template on template.id=published.template_id
  where published.organization_id=viewer.organization_id
    and published.survey_type='id_sme_review'
    and template.archived_at is null
  order by published.version_number desc limit 1;
  if version.id is null then
    raise exception using errcode='42501',message='Survey context is unavailable.';
  end if;
  context:=public.survey_context_for_task(target_task_id,'id_sme_review')
    ||jsonb_build_object('reviewedSme',jsonb_build_object(
      'smeIdentityId',identity.id,'wrikeUserId',identity.wrike_user_id,
      'name',identity.display_name
    ));
  insert into public.survey_submissions(
    organization_id,survey_type,task_id,project_id,task_wrike_id,
    subject_application_user_id,reviewed_wrike_user_id,sme_identity_id,
    created_by,last_edited_by,context_snapshot,survey_version_id,
    definition_snapshot,answers
  ) values (
    viewer.organization_id,'id_sme_review',target_task_id,
    nullif(context->>'projectId','')::uuid,context->>'taskWrikeId',
    null,identity.wrike_user_id,identity.id,viewer.id,viewer.id,context,
    version.id,version.definition,'{}'::jsonb
  ) returning id into created_id;
  insert into public.id_sme_review_responses(submission_id) values(created_id);
  insert into public.survey_audit_log(
    submission_id,organization_id,event_type,actor_id,actor_role,new_values
  ) values (
    created_id,viewer.organization_id,'draft_created',viewer.id,viewer.role,
    jsonb_build_object('surveyVersion',version.version_number,
      'smeIdentityId',identity.id)
  );
  return created_id;
end;
$$;

select pg_notify('pgrst','reload schema');
