-- Add a "project_reviewer" role: a non-admin, read-only role scoped to exactly
-- the Dashboard, Development, and Projects pages. It behaves like the existing
-- additive operational roles (id/sme) rather than growing an exhaustive switch,
-- and relies on the new "view_core_pages" TS capability (see lib/auth/roles.ts)
-- which only those three pages require.
alter table public.application_users
  drop constraint if exists application_users_role_check,
  add constraint application_users_role_check check (role in ('super_admin','admin','id','sme','project_reviewer'));

alter table public.application_user_invitations
  drop constraint if exists application_user_invitations_role_check,
  add constraint application_user_invitations_role_check check (role in ('admin','id','sme','project_reviewer'));

alter table public.application_user_operational_personas
  drop constraint if exists application_user_operational_personas_operational_role_check,
  add constraint application_user_operational_personas_operational_role_check check (operational_role in ('id','sme','project_reviewer'));

alter table public.application_user_operational_persona_audit
  drop constraint if exists application_user_operational_persona_audit_operational_role_check,
  add constraint application_user_operational_persona_audit_operational_role_check check (operational_role in ('id','sme','project_reviewer'));

-- current_organization_id() only resolves an organization for the roles listed
-- here; every reporting RPC behind Dashboard/Development/Projects depends on
-- it, so project_reviewer must be included or those pages render empty.
create or replace function public.current_organization_id()
returns uuid language sql stable security definer set search_path=public as $$
  select organization_id from public.application_users
  where id=public.current_effective_user_id() and account_state='active'
    and role in ('super_admin','admin','id','project_reviewer') limit 1;
$$;

create or replace function public.current_access_operational_roles()
returns text[] language sql stable security definer set search_path=public as $$
  select coalesce(array_agg(distinct role_name order by role_name),'{}'::text[])
  from (
    select persona.operational_role role_name
    from public.application_user_operational_personas persona
    where persona.application_user_id=public.current_effective_user_id() and persona.is_active
    union
    select member.role
    from public.application_users member
    where member.id=public.current_effective_user_id() and member.role in ('id','sme','project_reviewer')
      and not exists (
        select 1 from public.application_user_operational_personas persona
        where persona.application_user_id=member.id and persona.is_active
      )
  ) roles;
$$;

create or replace function public.set_application_user_operational_access(
  target_organization_id uuid,target_user_id uuid,target_roles text[],target_wrike_user_id uuid,acting_user_id uuid
)
returns void language plpgsql security definer set search_path=public as $$
declare actor public.application_users%rowtype; target public.application_users%rowtype; role_name text;
begin
  select * into actor from public.application_users where id=acting_user_id
    and organization_id=target_organization_id and account_state='active';
  select * into target from public.application_users where id=target_user_id
    and organization_id=target_organization_id and account_state='active';
  if actor.id is null or target.id is null or not (
      actor.role in ('admin','super_admin') or exists(
        select 1 from public.application_user_management_roles grant_row
        where grant_row.application_user_id=actor.id and grant_row.management_role in ('admin','super_admin')
          and grant_row.is_active
      )
    ) or target_roles is null or not (target_roles <@ array['id','sme','project_reviewer']::text[]) then
    raise exception using errcode='42501',message='Operational access change is unavailable.';
  end if;
  if target_wrike_user_id is not null and not exists(select 1 from public.wrike_users
    where id=target_wrike_user_id and organization_id=target_organization_id
      and is_active and not is_unresolved and identity_verified) then
    raise exception using errcode='23514',message='Select a verified Wrike identity.';
  end if;
  if target_wrike_user_id is not null and exists(
    select 1 from public.application_user_operational_personas persona
    where persona.organization_id=target_organization_id and persona.wrike_user_id=target_wrike_user_id
      and persona.application_user_id<>target_user_id and persona.is_active
  ) then raise exception using errcode='23505',message='That identity belongs to another account.'; end if;
  update public.application_user_operational_personas set is_active=false,deactivated_at=now(),
    updated_at=now(),updated_by=acting_user_id
  where organization_id=target_organization_id and application_user_id=target_user_id and is_active
    and operational_role<>all(target_roles);
  foreach role_name in array target_roles loop
    update public.application_user_operational_personas set wrike_user_id=target_wrike_user_id,
      updated_at=now(),updated_by=acting_user_id
    where organization_id=target_organization_id and application_user_id=target_user_id
      and operational_role=role_name and is_active;
    if not found then
      insert into public.application_user_operational_personas(
        organization_id,application_user_id,operational_role,wrike_user_id,created_by,updated_by
      ) values (target_organization_id,target_user_id,role_name,target_wrike_user_id,acting_user_id,acting_user_id);
    end if;
  end loop;
  if not ('sme'=any(target_roles)) then
    update public.application_user_management_roles set is_active=false,deactivated_at=now(),
      updated_at=now(),updated_by=acting_user_id
    where organization_id=target_organization_id and application_user_id=target_user_id
      and management_role='sme_coordinator' and is_active;
  end if;
end;
$$;

create or replace function public.change_application_user_role(
  target_organization_id uuid,target_user_id uuid,target_role text,acting_user_id uuid
) returns void language plpgsql security definer set search_path=public,auth as $$
declare actor_role text; current_role text; target_email text;
begin
  if target_role not in ('super_admin','admin','id','sme','project_reviewer') then
    raise exception using errcode='22023',message='Invalid application role.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text,0));
  select role into actor_role from public.application_users
    where id=acting_user_id and organization_id=target_organization_id;
  if actor_role not in ('super_admin','admin') then
    raise exception using errcode='42501',message='User management permission is required.';
  end if;
  select application_user.role,lower(btrim(auth_user.email)) into current_role,target_email
    from public.application_users application_user join auth.users auth_user on auth_user.id=application_user.id
    where application_user.id=target_user_id and application_user.organization_id=target_organization_id
    for update of application_user;
  if not found then raise exception using errcode='P0001',message='Organization member not found.'; end if;
  if current_role='super_admin' or target_email='dweiss@lexipol.com' then
    raise exception using errcode='23514',message='The required SuperAdmin account cannot be modified.';
  end if;
  if target_role='super_admin' then
    raise exception using errcode='42501',message='The SuperAdmin role cannot be assigned.';
  end if;
  update public.application_users set role=target_role,
    wrike_user_id=case when target_role in ('id','sme') then wrike_user_id else null end,updated_at=now()
    where id=target_user_id and organization_id=target_organization_id;
end;
$$;
