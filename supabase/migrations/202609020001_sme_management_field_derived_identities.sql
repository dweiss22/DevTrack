-- sme_management_rows() still sourced SMEs from the legacy wrike_users/persona/
-- assignment model (course_development_person_assignments, application_user_
-- operational_personas.wrike_user_id, survey_submissions.reviewed_wrike_user_id),
-- all of which require a non-null wrike_user_id. SME identity has since moved to
-- the durable sme_dashboard_identities table (202607290001), where wrike_user_id
-- is optional for SMEs reserved before a Wrike sync discovers their name
-- (202609010006). SME Coordinators therefore saw only the SMEs whose identity
-- happened to already carry a Wrike match (often just themselves) and none of
-- the field-derived/reserved identities. Rebuild the RPC against
-- sme_dashboard_identities so the SME Management page is org-wide again.
--
-- ensure_sme_dashboard_identity() and link_application_user_sme_identity() also
-- only let admins/super_admins reserve or link an identity. SME Coordinators
-- hold the manage_smes capability and should be able to do the same from the
-- SME Management page, so both now also accept an active sme_coordinator grant.

create or replace function public.ensure_sme_dashboard_identity(
  target_organization_id uuid,
  target_display_name text
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  actor public.application_users%rowtype;
  normalized_name text;
  identity_id uuid;
  trimmed_name text;
begin
  select * into actor from public.application_users
  where id=public.current_effective_user_id()
    and organization_id=target_organization_id and account_state='active';
  if actor.id is null or not (
    actor.role in ('admin','super_admin')
    or exists(
      select 1 from public.application_user_management_roles role_grant
      where role_grant.application_user_id=actor.id
        and role_grant.organization_id=actor.organization_id
        and role_grant.management_role in ('admin','super_admin','sme_coordinator')
        and role_grant.is_active
    )
  ) then
    raise exception using errcode='42501',
      message='SME identity reservation is unavailable.';
  end if;
  trimmed_name:=btrim(target_display_name);
  normalized_name:=public.normalize_project_assignment_name(trimmed_name);
  if normalized_name='' then
    raise exception using errcode='23514',
      message='Enter the SME''s name as it will appear in the Wrike SME field.';
  end if;
  identity_id:=public.stable_sme_dashboard_identity_id(target_organization_id,normalized_name);
  insert into public.sme_dashboard_identities(
    id,organization_id,normalized_name,display_name,observed_names,
    resolution_status,updated_at
  ) values (
    identity_id,target_organization_id,normalized_name,trimmed_name,
    array[trimmed_name],'resolved',now()
  )
  on conflict (organization_id,normalized_name) do nothing;
  return identity_id;
end;
$$;

create or replace function public.link_application_user_sme_identity(
  target_organization_id uuid,target_application_user_id uuid,
  target_sme_identity_id uuid,acting_user_id uuid,
  confirm_replacement boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  actor public.application_users%rowtype;
  target public.application_users%rowtype;
  identity public.sme_dashboard_identities%rowtype;
  previous_identity_id uuid;
  previous_application_user_id uuid;
  event_name text;
begin
  select * into actor from public.application_users
  where id=acting_user_id
    and organization_id=target_organization_id and account_state='active';
  if actor.id is null or not (
    actor.role in ('admin','super_admin')
    or exists(
      select 1 from public.application_user_management_roles role_grant
      where role_grant.application_user_id=actor.id
        and role_grant.organization_id=actor.organization_id
        and role_grant.management_role in ('admin','super_admin','sme_coordinator')
        and role_grant.is_active
    )
  ) then
    raise exception using errcode='42501',
      message='SME identity linking is unavailable.';
  end if;
  select * into target from public.application_users
  where id=target_application_user_id
    and organization_id=target_organization_id and account_state='active';
  if target.id is null or not (
    target.role='sme' or exists(
      select 1 from public.application_user_operational_personas persona
      where persona.application_user_id=target.id
        and persona.organization_id=target.organization_id
        and persona.operational_role='sme' and persona.is_active
    )
  ) then
    raise exception using errcode='23514',
      message='Select an active application user with SME access.';
  end if;
  select * into identity from public.sme_dashboard_identities
  where id=target_sme_identity_id
    and organization_id=target_organization_id for update;
  if identity.id is null then
    raise exception using errcode='23514',
      message='Select a discovered SME field identity.';
  end if;
  select existing.id into previous_identity_id
  from public.sme_dashboard_identities existing
  where existing.organization_id=target_organization_id
    and existing.application_user_id=target.id
    and existing.id<>identity.id
  for update;
  previous_application_user_id:=identity.application_user_id;
  if (
    previous_identity_id is not null
    or (
      previous_application_user_id is not null
      and previous_application_user_id<>target.id
    )
    or identity.resolution_status='ambiguous'
  ) and not confirm_replacement then
    raise exception using errcode='P0001',
      message='Confirmation is required to replace or resolve this SME identity linkage.',
      detail=jsonb_build_object(
        'confirmationRequired',true,
        'previousSmeIdentityId',previous_identity_id,
        'previousApplicationUserId',previous_application_user_id,
        'ambiguous',identity.resolution_status='ambiguous'
      )::text;
  end if;
  if previous_identity_id is not null then
    update public.sme_dashboard_identities set
      application_user_id=null,updated_at=now()
    where id=previous_identity_id;
  end if;
  if previous_application_user_id is not null
    and previous_application_user_id<>target.id then
    update public.sme_dashboard_identities set
      application_user_id=null,updated_at=now()
    where id=identity.id;
    update public.application_user_operational_personas set
      wrike_user_id=null,updated_by=actor.id,updated_at=now()
    where organization_id=target_organization_id
      and application_user_id=previous_application_user_id
      and operational_role='sme' and is_active;
    update public.application_users set wrike_user_id=null,updated_at=now()
    where id=previous_application_user_id
      and organization_id=target_organization_id and role='sme';
  end if;
  update public.sme_dashboard_identities set
    application_user_id=target.id,
    resolution_status=case when resolution_status='ambiguous'
      then 'resolved' else resolution_status end,
    ambiguity_reason=case when resolution_status='ambiguous'
      then null else ambiguity_reason end,
    updated_at=now()
  where id=identity.id;
  if not exists(
    select 1 from public.application_user_operational_personas persona
    where persona.organization_id=target_organization_id
      and persona.application_user_id=target.id
      and persona.operational_role='sme' and persona.is_active
  ) then
    insert into public.application_user_operational_personas(
      organization_id,application_user_id,operational_role,wrike_user_id,
      created_by,updated_by
    ) values (
      target_organization_id,target.id,'sme',identity.wrike_user_id,
      actor.id,actor.id
    );
  else
    update public.application_user_operational_personas set
      wrike_user_id=identity.wrike_user_id,updated_by=actor.id,updated_at=now()
    where organization_id=target_organization_id
      and application_user_id=target.id
      and operational_role='sme' and is_active;
  end if;
  update public.application_users set
    wrike_user_id=identity.wrike_user_id,updated_at=now()
  where id=target.id and organization_id=target_organization_id
    and role='sme';
  event_name:=case
    when identity.resolution_status='ambiguous' then 'ambiguity_resolved'
    when previous_identity_id is not null
      or (previous_application_user_id is not null
        and previous_application_user_id<>target.id)
      then 'relinked'
    else 'linked' end;
  insert into public.sme_dashboard_identity_link_audit(
    organization_id,sme_identity_id,actor_user_id,application_user_id,
    event_type,previous_sme_identity_id,previous_application_user_id,
    confirmed_replacement
  ) values (
    target_organization_id,identity.id,actor.id,target.id,event_name,
    previous_identity_id,previous_application_user_id,confirm_replacement
  );
  return jsonb_build_object(
    'ok',true,'smeIdentityId',identity.id,
    'applicationUserId',target.id,'status','linked',
    'preservedProjectHistory',true,'preservedSurveyHistory',true
  );
end;
$$;

create or replace function public.sme_management_rows()
returns table(
  sme_identity_id uuid,wrike_user_id uuid,application_user_id uuid,display_name text,email text,
  mapping_status text,coordinator boolean,assigned_projects bigint,active_projects bigint,
  completed_projects bigint,stalled_projects bigint,submitted_surveys bigint,
  billable_hours numeric,invoiced_amount numeric
)
language plpgsql stable security definer set search_path=public as $$
declare viewer public.application_users%rowtype;
begin
  select * into viewer from public.application_users where id=public.current_effective_user_id();
  if not found or not public.current_has_capability('manage_smes') then
    raise exception using errcode='42501',message='SME Management is unavailable.';
  end if;
  return query
  with assignment_totals as (
    select assignment.sme_identity_id,
      count(distinct assignment.task_id) assigned_projects,
      count(distinct assignment.task_id) filter(where status.dashboard_classification='active') active_projects,
      count(distinct assignment.task_id) filter(where status.dashboard_classification='completed') completed_projects,
      count(distinct assignment.task_id) filter(where status.dashboard_classification='stalled_or_canceled') stalled_projects
    from public.sme_dashboard_task_assignments assignment
    left join public.wrike_tasks task on task.id=assignment.task_id
    left join public.wrike_workflow_statuses status on status.organization_id=viewer.organization_id
      and status.wrike_id=task.custom_status_id
    where assignment.organization_id=viewer.organization_id
    group by assignment.sme_identity_id
  ), survey_facts as (
    select survey.id,survey.sme_identity_id,
      case when survey.status='submitted' and response.internal_employee=false
        then response.billable_hours end billable_hours,
      case when survey.status='submitted' and response.internal_employee=false
        then response.amount_billed end amount_billed
    from public.survey_submissions survey
    left join public.course_development_debrief_responses response on response.submission_id=survey.id
    where survey.organization_id=viewer.organization_id
      and survey.survey_type='course_development_debrief' and survey.status='submitted'
      and survey.sme_identity_id is not null
    union all
    select historical.id,identity_lookup.id,
      detail.billable_hours,detail.amount_billed
    from public.historical_survey_responses historical
    join public.historical_sme_debrief_responses detail on detail.response_id=historical.id
    join public.sme_dashboard_identities identity_lookup
      on identity_lookup.organization_id=viewer.organization_id
      and identity_lookup.wrike_user_id=historical.matched_reviewed_wrike_user_id
    where historical.organization_id=viewer.organization_id
      and historical.survey_type='SME_DEBRIEF'
      and historical.matched_reviewed_wrike_user_id is not null
  ), survey_totals as (
    select fact.sme_identity_id,count(distinct fact.id) submitted_surveys,
      coalesce(sum(fact.billable_hours),0) billable_hours,
      coalesce(sum(fact.amount_billed),0) invoiced_amount
    from survey_facts fact group by fact.sme_identity_id
  )
  select identity.id,identity.wrike_user_id,identity.application_user_id,identity.display_name,
    wrike.email,
    case when identity.application_user_id is null then 'unmapped' else 'mapped' end,
    exists(select 1 from public.application_user_management_roles grant_row
      where grant_row.application_user_id=identity.application_user_id
        and grant_row.management_role='sme_coordinator' and grant_row.is_active),
    coalesce(assignment_totals.assigned_projects,0),
    coalesce(assignment_totals.active_projects,0),
    coalesce(assignment_totals.completed_projects,0),
    coalesce(assignment_totals.stalled_projects,0),
    coalesce(survey_totals.submitted_surveys,0),
    coalesce(survey_totals.billable_hours,0),
    coalesce(survey_totals.invoiced_amount,0)
  from public.sme_dashboard_identities identity
  left join public.wrike_users wrike on wrike.id=identity.wrike_user_id
  left join assignment_totals on assignment_totals.sme_identity_id=identity.id
  left join survey_totals on survey_totals.sme_identity_id=identity.id
  where identity.organization_id=viewer.organization_id
  order by identity.display_name;
end;
$$;

select pg_notify('pgrst','reload schema');
