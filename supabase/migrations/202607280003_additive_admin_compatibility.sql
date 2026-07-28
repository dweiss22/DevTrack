-- Keep the deprecated application_users.role column synchronized with active
-- Admin management grants for one compatibility release. Operational access
-- remains authoritative in application_user_operational_personas, so granting
-- or revoking Admin never removes the user's ID/SME personas.

create or replace function public.sync_additive_admin_legacy_role()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  member public.application_users%rowtype;
  fallback_role text;
begin
  if new.management_role<>'admin' then return null; end if;

  select * into member
  from public.application_users
  where id=new.application_user_id and organization_id=new.organization_id
  for update;
  if not found or member.role='super_admin' then return null; end if;

  if new.is_active then
    -- Capture a legacy ID/SME role as an operational persona before the
    -- compatibility column is promoted to Admin.
    if member.role in ('id','sme') and not exists (
      select 1
      from public.application_user_operational_personas persona
      where persona.organization_id=member.organization_id
        and persona.application_user_id=member.id
        and persona.operational_role=member.role
        and persona.is_active
    ) then
      insert into public.application_user_operational_personas(
        organization_id,application_user_id,operational_role,wrike_user_id,
        created_by,updated_by
      ) values (
        member.organization_id,member.id,member.role,member.wrike_user_id,
        new.updated_by,new.updated_by
      );
    end if;

    update public.application_users
    set role='admin',updated_at=now()
    where id=member.id and organization_id=member.organization_id
      and role<>'admin';
    return null;
  end if;

  if old.is_active and not exists (
    select 1
    from public.application_user_management_roles grant_row
    where grant_row.organization_id=new.organization_id
      and grant_row.application_user_id=new.application_user_id
      and grant_row.management_role='admin'
      and grant_row.is_active
  ) then
    select persona.operational_role into fallback_role
    from public.application_user_operational_personas persona
    where persona.organization_id=member.organization_id
      and persona.application_user_id=member.id
      and persona.is_active
    order by case persona.operational_role when 'id' then 1 else 2 end
    limit 1;

    if fallback_role is null then
      fallback_role:='id';
      insert into public.application_user_operational_personas(
        organization_id,application_user_id,operational_role,wrike_user_id,
        created_by,updated_by
      ) values (
        member.organization_id,member.id,fallback_role,member.wrike_user_id,
        new.updated_by,new.updated_by
      );
    end if;

    update public.application_users
    set role=fallback_role,updated_at=now()
    where id=member.id and organization_id=member.organization_id
      and role='admin';
  end if;
  return null;
end;
$$;

create trigger application_user_management_admin_legacy_role
after insert or update of is_active
on public.application_user_management_roles
for each row
execute function public.sync_additive_admin_legacy_role();

-- Reconcile any grants created between the additive-role release and this
-- compatibility bridge.
insert into public.application_user_operational_personas(
  organization_id,application_user_id,operational_role,wrike_user_id,
  created_by,updated_by
)
select
  member.organization_id,member.id,member.role,member.wrike_user_id,
  grant_row.updated_by,grant_row.updated_by
from public.application_users member
join public.application_user_management_roles grant_row
  on grant_row.organization_id=member.organization_id
  and grant_row.application_user_id=member.id
  and grant_row.management_role='admin'
  and grant_row.is_active
where member.role in ('id','sme')
  and not exists (
    select 1
    from public.application_user_operational_personas persona
    where persona.organization_id=member.organization_id
      and persona.application_user_id=member.id
      and persona.operational_role=member.role
      and persona.is_active
  );

update public.application_users member
set role='admin',updated_at=now()
where member.role<>'super_admin'
  and exists (
    select 1
    from public.application_user_management_roles grant_row
    where grant_row.organization_id=member.organization_id
      and grant_row.application_user_id=member.id
      and grant_row.management_role='admin'
      and grant_row.is_active
  );

revoke all on function public.sync_additive_admin_legacy_role() from public;
grant execute on function public.sync_additive_admin_legacy_role() to service_role;
