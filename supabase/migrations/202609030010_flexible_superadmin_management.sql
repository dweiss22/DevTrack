-- Allow SuperAdmin role assignment with 1-2 SuperAdmin constraint per organization

-- Update the guard trigger to allow SuperAdmin modification
create or replace function public.guard_application_user_authorization()
returns trigger
language plpgsql
security definer
set search_path=public,auth
as $$
declare
  target_email text;
  mapped_organization_id uuid;
  target_user_id uuid;
  superadmin_count bigint;
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

  -- Allow SuperAdmin promotion/demotion with constraint checking
  if new.role='super_admin' then
    select count(*) into superadmin_count from public.application_users
      where organization_id=new.organization_id and role='super_admin' and id<>target_user_id;
    if superadmin_count >= 2 then
      raise exception using errcode='23514',message='Organization cannot have more than 2 SuperAdmin accounts.';
    end if;
  end if;

  if tg_op='UPDATE' and old.role='super_admin' and new.role<>'super_admin' then
    select count(*) into superadmin_count from public.application_users
      where organization_id=new.organization_id and role='super_admin' and id<>target_user_id;
    if superadmin_count < 1 then
      raise exception using errcode='23514',message='Organization must maintain at least 1 SuperAdmin account.';
    end if;
  end if;

  if new.role<>'sme' then new.wrike_user_id=null; end if;
  if new.wrike_user_id is not null then
    select organization_id into mapped_organization_id from public.wrike_users where id=new.wrike_user_id;
    if mapped_organization_id is distinct from new.organization_id then
      raise exception using errcode='23514',message='The SME identity must belong to the same organization.';
    end if;
  end if;
  return new;
end;
$$;

-- Update change_application_user_role to allow SuperAdmin assignment
create or replace function public.change_application_user_role(
  target_organization_id uuid,
  target_user_id uuid,
  target_role text,
  acting_user_id uuid
)
returns void
language plpgsql
security definer
set search_path=public,auth
as $$
declare
  actor_role text;
  current_role text;
  target_email text;
  superadmin_count bigint;
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
  if target_role='super_admin' and actor_role<>'super_admin' then
    raise exception using errcode='42501',message='Only SuperAdmin may assign SuperAdmin roles.';
  end if;

  select application_user.role,lower(btrim(auth_user.email))
    into current_role,target_email
    from public.application_users application_user
    join auth.users auth_user on auth_user.id=application_user.id
    where application_user.id=target_user_id and application_user.organization_id=target_organization_id
    for update of application_user;
  if not found then raise exception using errcode='P0001',message='Organization member not found.'; end if;

  if target_email='dweiss@lexipol.com' and target_role<>'super_admin' then
    raise exception using errcode='23514',message='The required SuperAdmin account cannot be demoted.';
  end if;

  if target_role='super_admin' then
    select count(*) into superadmin_count from public.application_users
      where organization_id=target_organization_id and role='super_admin' and id<>target_user_id;
    if superadmin_count >= 2 then
      raise exception using errcode='23514',message='Organization cannot have more than 2 SuperAdmin accounts.';
    end if;
  end if;

  if current_role='super_admin' and target_role<>'super_admin' then
    select count(*) into superadmin_count from public.application_users
      where organization_id=target_organization_id and role='super_admin' and id<>target_user_id;
    if superadmin_count < 1 then
      raise exception using errcode='23514',message='Organization must maintain at least 1 SuperAdmin account.';
    end if;
  end if;

  update public.application_users
    set role=target_role,wrike_user_id=case when target_role='sme' then wrike_user_id else null end,updated_at=now()
    where id=target_user_id and organization_id=target_organization_id;
end;
$$;
