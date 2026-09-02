-- link_application_user_sme_identity() unconditionally set the target's
-- persona/application_users.wrike_user_id to the linked identity's
-- wrike_user_id, including null. Many field-derived identities are purely
-- discovered/reserved and have never been matched to a real Wrike login
-- (wrike_user_id is null), so linking an SME account to one of these
-- identities silently wiped out that account's separately-configured
-- Verified Wrike Identity, even when nothing about the Wrike mapping was
-- actually wrong. (Surfaced when SME Management's new Field-Derived
-- Identity control was used to correct a mis-attached identity: relinking
-- to the correct identity turned the account's Verified Wrike Identity
-- into "Not mapped".) Only overwrite the existing Wrike mapping when the
-- identity being linked actually carries a wrike_user_id of its own.

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
      wrike_user_id=coalesce(identity.wrike_user_id,wrike_user_id),
      updated_by=actor.id,updated_at=now()
    where organization_id=target_organization_id
      and application_user_id=target.id
      and operational_role='sme' and is_active;
  end if;
  update public.application_users set
    wrike_user_id=coalesce(identity.wrike_user_id,wrike_user_id),updated_at=now()
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

select pg_notify('pgrst','reload schema');
