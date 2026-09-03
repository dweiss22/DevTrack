-- Add a "videographer" role, following the same additive pattern used for
-- "project_reviewer" (202608310005). A videographer's identity is the same
-- Wrike identity used for Designer Assigned matching (no separate
-- videographer field exists in Wrike), so it needs a wrike_user_id mapping
-- just like id/sme.
alter table public.application_users
  drop constraint if exists application_users_role_check,
  add constraint application_users_role_check check (role in ('super_admin','admin','id','sme','project_reviewer','videographer'));

alter table public.application_user_invitations
  drop constraint if exists application_user_invitations_role_check,
  add constraint application_user_invitations_role_check check (role in ('admin','id','sme','project_reviewer','videographer'));

alter table public.application_user_operational_personas
  drop constraint if exists application_user_operational_personas_operational_role_check,
  add constraint application_user_operational_personas_operational_role_check check (operational_role in ('id','sme','project_reviewer','videographer'));

alter table public.application_user_operational_persona_audit
  drop constraint if exists application_user_operational_persona_audit_operational_role_check,
  add constraint application_user_operational_persona_audit_operational_role_check check (operational_role in ('id','sme','project_reviewer','videographer'));

create or replace function public.current_organization_id()
returns uuid language sql stable security definer set search_path=public as $$
  select organization_id from public.application_users
  where id=public.current_effective_user_id() and account_state='active'
    and role in ('super_admin','admin','id','project_reviewer','videographer') limit 1;
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
    where member.id=public.current_effective_user_id() and member.role in ('id','sme','project_reviewer','videographer')
      and not exists (
        select 1 from public.application_user_operational_personas persona
        where persona.application_user_id=member.id and persona.is_active
      )
  ) roles;
$$;

create or replace function public.change_application_user_role(
  target_organization_id uuid,target_user_id uuid,target_role text,acting_user_id uuid
) returns void language plpgsql security definer set search_path=public,auth as $$
declare actor_role text; current_role text; target_email text;
begin
  if target_role not in ('super_admin','admin','id','sme','project_reviewer','videographer') then
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
    wrike_user_id=case when target_role in ('id','sme','videographer') then wrike_user_id else null end,updated_at=now()
    where id=target_user_id and organization_id=target_organization_id;
end;
$$;

create or replace function public.guard_application_user_authorization()
returns trigger language plpgsql security definer set search_path=public,auth as $$
declare target_email text; mapped_organization_id uuid; target_user_id uuid;
begin
  target_user_id:=case when tg_op='DELETE' then old.id else new.id end;
  select lower(btrim(email)) into target_email from auth.users where id=target_user_id;
  if tg_op='DELETE' then
    if old.role='super_admin' or target_email='dweiss@lexipol.com' then
      raise exception using errcode='23514',message='The required SuperAdmin account cannot be removed.';
    end if;
    return old;
  end if;
  if target_email='dweiss@lexipol.com' and new.role<>'super_admin' then
    raise exception using errcode='23514',message='The required SuperAdmin account cannot be demoted.';
  end if;
  if new.role='super_admin' and target_email is distinct from 'dweiss@lexipol.com' then
    raise exception using errcode='23514',message='Only the fixed SuperAdmin account may hold the SuperAdmin role.';
  end if;
  if tg_op='UPDATE' and old.role='super_admin'
    and (new.role is distinct from old.role or new.organization_id is distinct from old.organization_id) then
    raise exception using errcode='23514',message='The required SuperAdmin role and organization cannot be changed.';
  end if;
  if new.role not in ('id','sme','videographer') then new.wrike_user_id=null; end if;
  if new.wrike_user_id is not null then
    select organization_id into mapped_organization_id from public.wrike_users
      where id=new.wrike_user_id and is_active and not is_unresolved and identity_verified;
    if mapped_organization_id is null or mapped_organization_id<>new.organization_id then
      raise exception using errcode='23514',message='The selected synchronized identity is not eligible.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.set_application_user_wrike_identity(
  target_organization_id uuid,target_user_id uuid,target_wrike_user_id uuid,acting_user_id uuid
) returns void language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.application_users where id=acting_user_id
    and organization_id=target_organization_id and role in ('super_admin','admin')) then
    raise exception using errcode='42501',message='User management permission is required.';
  end if;
  if not exists(select 1 from public.application_users where id=target_user_id
    and organization_id=target_organization_id and role in ('id','sme','videographer')) then
    raise exception using errcode='P0001',message='The selected application user cannot be mapped.';
  end if;
  if target_wrike_user_id is not null and not exists(select 1 from public.wrike_users
    where id=target_wrike_user_id and organization_id=target_organization_id
      and is_active and not is_unresolved and identity_verified) then
    raise exception using errcode='P0001',message='The selected synchronized identity is not eligible.';
  end if;
  update public.application_users set wrike_user_id=target_wrike_user_id,updated_at=now()
    where id=target_user_id and organization_id=target_organization_id;
end;
$$;

select pg_notify('pgrst','reload schema');
