-- Jeff Dino could not complete his Course Development Debrief survey and saw
-- only the generic "Survey unavailable" / "Survey context is unavailable."
-- message. survey_personal_create_or_resume_sme_debrief() raised that exact
-- same literal message for every distinct failure (no SME identity link, not
-- assigned to the project, already submitted, no published template), so the
-- app routes had nothing specific to forward. Split out the actual reasons so
-- the dialog can tell the user what happened.

create or replace function public.survey_personal_create_or_resume_sme_debrief(
  target_task_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  viewer public.application_users%rowtype;
  identity public.sme_dashboard_identities%rowtype;
  submission_id_value uuid;
  context jsonb;
  version public.survey_template_versions%rowtype;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  if viewer.id is null or not public.current_has_operational_role('sme') then
    raise exception using errcode='42501',message='Survey context is unavailable.';
  end if;
  select * into identity from public.sme_dashboard_identities
  where organization_id=viewer.organization_id
    and application_user_id=viewer.id
    and resolution_status<>'ambiguous';
  if identity.id is null then
    raise exception using errcode='42501',
      message='Your DevTrack account is not linked to an SME identity yet. Ask an administrator to link it in User Management.';
  end if;
  if not public.is_sme_identity_assigned(target_task_id,identity.id) then
    if public.sme_identity_assignment_conflict(target_task_id,identity.id) then
      raise exception using errcode='42501',
        message='This project''s SME field has conflicting or ambiguous values, so the survey cannot be started yet. Ask an administrator to correct the SME field on this project.';
    end if;
    raise exception using errcode='42501',
      message='This project does not list you in its SME field, so the survey is unavailable.';
  end if;
  if not public.survey_sme_status_available(target_task_id) then
    raise exception using errcode='42501',
      message='This project is not in a status that accepts a Course Development Debrief survey yet.';
  end if;
  select survey.id into submission_id_value
  from public.survey_submissions survey
  where survey.organization_id=viewer.organization_id
    and survey.task_id=target_task_id
    and survey.survey_type='course_development_debrief'
    and survey.subject_application_user_id=viewer.id;
  if submission_id_value is not null and exists(
    select 1 from public.survey_submissions survey
    where survey.id=submission_id_value and survey.status='submitted'
  ) then
    raise exception using errcode='42501',
      message='This survey has already been submitted and cannot be started again.';
  end if;
  if submission_id_value is null then
    select published.* into version
    from public.survey_template_versions published
    join public.survey_templates template on template.id=published.template_id
    where published.organization_id=viewer.organization_id
      and published.survey_type='course_development_debrief'
      and template.archived_at is null
    order by published.version_number desc limit 1;
    if version.id is null then
      raise exception using errcode='42501',
        message='No published Course Development Debrief survey template is available. Ask an administrator to publish one.';
    end if;
    context:=public.survey_context_for_task(
      target_task_id,'course_development_debrief'
    )||jsonb_build_object('subject',jsonb_build_object(
      'applicationUserId',viewer.id,'smeIdentityId',identity.id,
      'wrikeUserId',identity.wrike_user_id,'name',identity.display_name
    ));
    insert into public.survey_submissions(
      organization_id,survey_type,task_id,project_id,task_wrike_id,
      subject_application_user_id,reviewed_wrike_user_id,sme_identity_id,
      created_by,last_edited_by,context_snapshot,survey_version_id,
      definition_snapshot,answers
    ) values (
      viewer.organization_id,'course_development_debrief',target_task_id,
      nullif(context->>'projectId','')::uuid,context->>'taskWrikeId',
      viewer.id,identity.wrike_user_id,identity.id,viewer.id,viewer.id,context,
      version.id,version.definition,'{}'::jsonb
    ) returning id into submission_id_value;
    insert into public.course_development_debrief_responses(submission_id)
      values(submission_id_value);
    insert into public.survey_audit_log(
      submission_id,organization_id,event_type,actor_id,actor_role,new_values
    ) values (
      submission_id_value,viewer.organization_id,'draft_created',viewer.id,viewer.role,
      jsonb_build_object('surveyVersion',version.version_number,
        'smeIdentityId',identity.id)
    );
  end if;
  perform public.refresh_sme_debrief_draft_context(submission_id_value);
  return submission_id_value;
end;
$$;

select pg_notify('pgrst','reload schema');
