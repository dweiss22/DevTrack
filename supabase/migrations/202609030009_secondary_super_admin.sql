-- Allow SuperAdmins to additively grant the SuperAdmin management role to
-- other accounts (secondary SuperAdmins), on top of the single fixed
-- SuperAdmin account (dweiss@lexipol.com) that remains permanently locked
-- via the legacy application_users.role column and its triggers.
--
-- This reuses the existing additive application_user_management_roles
-- mechanism (202607280001) rather than touching application_users.role, so
-- the fixed-account guard trigger (guard_application_user_authorization,
-- 202609030004) is untouched: multiple accounts can hold an active
-- super_admin management-role grant at once, while the fixed account's
-- legacy role can never be reassigned or removed.

create or replace function public.set_application_user_management_role(
  target_organization_id uuid,target_user_id uuid,target_role text,target_enabled boolean,acting_user_id uuid
)
returns void language plpgsql security definer set search_path=public,auth as $$
declare actor public.application_users%rowtype; target public.application_users%rowtype;
  existing public.application_user_management_roles%rowtype; saved public.application_user_management_roles%rowtype;
  actor_is_super boolean; actor_is_admin boolean; target_email text;
begin
  select * into actor from public.application_users
    where id=acting_user_id and organization_id=target_organization_id and account_state='active';
  select * into target from public.application_users
    where id=target_user_id and organization_id=target_organization_id and account_state='active';
  select lower(btrim(email)) into target_email from auth.users where id=target_user_id;
  actor_is_super:=actor.role='super_admin' or exists(select 1 from public.application_user_management_roles
    where application_user_id=actor.id and management_role='super_admin' and is_active);
  actor_is_admin:=actor_is_super or actor.role='admin' or exists(select 1 from public.application_user_management_roles
    where application_user_id=actor.id and management_role='admin' and is_active);
  if actor.id is null or target.id is null or target_role not in ('sme_coordinator','admin','super_admin')
    or (target_role='admin' and not actor_is_super)
    or (target_role='super_admin' and not actor_is_super)
    or (target_role='sme_coordinator' and not actor_is_admin) then
    raise exception using errcode='42501',message='Management role change is unavailable.';
  end if;
  if target_role='super_admin' and target_email='dweiss@lexipol.com' then
    raise exception using errcode='23514',message='The required SuperAdmin account cannot be modified.';
  end if;
  if target_role='sme_coordinator' and not (
    target.role='sme' or exists(select 1 from public.application_user_operational_personas
      where application_user_id=target.id and operational_role='sme' and is_active)
  ) then raise exception using errcode='23514',message='An SME Coordinator must also hold the SME operational role.'; end if;
  select * into existing from public.application_user_management_roles
    where organization_id=target_organization_id and application_user_id=target_user_id
      and management_role=target_role and is_active for update;
  if target_enabled and existing.id is null then
    insert into public.application_user_management_roles(
      organization_id,application_user_id,management_role,created_by,updated_by
    ) values (target_organization_id,target_user_id,target_role,acting_user_id,acting_user_id)
    returning * into saved;
    insert into public.application_user_management_role_audit(
      management_role_id,organization_id,actor_user_id,application_user_id,event_type,management_role
    ) values (saved.id,target_organization_id,acting_user_id,target_user_id,'assigned',target_role);
  elsif not target_enabled and existing.id is not null then
    update public.application_user_management_roles set is_active=false,deactivated_at=now(),
      updated_at=now(),updated_by=acting_user_id where id=existing.id;
    insert into public.application_user_management_role_audit(
      management_role_id,organization_id,actor_user_id,application_user_id,event_type,management_role
    ) values (existing.id,target_organization_id,acting_user_id,target_user_id,'removed',target_role);
  end if;
end;
$$;

select pg_notify('pgrst','reload schema');
