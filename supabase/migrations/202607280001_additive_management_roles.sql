-- Additive operational and management access. Legacy application_users.role
-- and wrike_user_id remain populated for one compatibility release, but new
-- application code authorizes through the helpers in this migration.

alter table public.application_user_operational_personas
  drop constraint if exists application_user_operational_personas_operational_role_check;
alter table public.application_user_operational_personas
  add constraint application_user_operational_personas_operational_role_check
  check (operational_role in ('id','sme'));
alter table public.application_user_operational_personas
  alter column wrike_user_id drop not null;
alter table public.application_user_operational_persona_audit
  drop constraint if exists application_user_operational_persona_audit_operational_role_check;
alter table public.application_user_operational_persona_audit
  add constraint application_user_operational_persona_audit_operational_role_check
  check (operational_role in ('id','sme'));

create table public.application_user_management_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  application_user_id uuid not null,
  management_role text not null check (management_role in ('sme_coordinator','admin','super_admin')),
  is_active boolean not null default true,
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deactivated_at timestamptz,
  foreign key(application_user_id,organization_id)
    references public.application_users(id,organization_id) on delete cascade,
  foreign key(created_by,organization_id)
    references public.application_user_principals(id,organization_id),
  foreign key(updated_by,organization_id)
    references public.application_user_principals(id,organization_id),
  check ((is_active and deactivated_at is null) or (not is_active and deactivated_at is not null))
);
create unique index one_active_management_role_per_user_idx
  on public.application_user_management_roles(organization_id,application_user_id,management_role)
  where is_active;

create table public.application_user_management_role_audit (
  id bigint generated always as identity primary key,
  management_role_id uuid references public.application_user_management_roles(id) on delete set null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid not null,
  application_user_id uuid not null,
  event_type text not null check (event_type in ('assigned','removed')),
  management_role text not null check (management_role in ('sme_coordinator','admin','super_admin')),
  created_at timestamptz not null default now(),
  foreign key(actor_user_id,organization_id)
    references public.application_user_principals(id,organization_id),
  foreign key(application_user_id,organization_id)
    references public.application_user_principals(id,organization_id)
);

create trigger application_user_management_role_audit_append_only
before update or delete on public.application_user_management_role_audit
for each row execute function public.guard_append_only_security_audit();

insert into public.application_user_operational_personas(
  organization_id,application_user_id,operational_role,wrike_user_id,created_by,updated_by
)
select member.organization_id,member.id,member.role,member.wrike_user_id,member.id,member.id
from public.application_users member
where member.role in ('id','sme')
  and not exists (
    select 1 from public.application_user_operational_personas persona
    where persona.organization_id=member.organization_id
      and persona.application_user_id=member.id
      and persona.operational_role=member.role
      and persona.is_active
  );

insert into public.application_user_management_roles(
  organization_id,application_user_id,management_role,created_by,updated_by
)
select member.organization_id,member.id,member.role,member.id,member.id
from public.application_users member
where member.role in ('admin','super_admin')
  and not exists (
    select 1 from public.application_user_management_roles grant_row
    where grant_row.organization_id=member.organization_id
      and grant_row.application_user_id=member.id
      and grant_row.management_role=member.role
      and grant_row.is_active
  );

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
    where member.id=public.current_effective_user_id() and member.role in ('id','sme')
      and not exists (
        select 1 from public.application_user_operational_personas persona
        where persona.application_user_id=member.id and persona.is_active
      )
  ) roles;
$$;

create or replace function public.current_access_management_roles()
returns text[] language sql stable security definer set search_path=public as $$
  select coalesce(array_agg(distinct role_name order by role_name),'{}'::text[])
  from (
    select grant_row.management_role role_name
    from public.application_user_management_roles grant_row
    where grant_row.application_user_id=public.current_effective_user_id() and grant_row.is_active
    union
    select member.role
    from public.application_users member
    where member.id=public.current_effective_user_id() and member.role in ('admin','super_admin')
      and not exists (
        select 1 from public.application_user_management_roles grant_row
        where grant_row.application_user_id=member.id and grant_row.is_active
      )
  ) roles;
$$;

create or replace function public.current_has_operational_role(target_role text)
returns boolean language sql stable security definer set search_path=public as $$
  select target_role=any(public.current_access_operational_roles());
$$;

create or replace function public.current_has_management_role(target_role text)
returns boolean language sql stable security definer set search_path=public as $$
  select target_role=any(public.current_access_management_roles());
$$;

create or replace function public.current_operational_identity(target_role text)
returns uuid language sql stable security definer set search_path=public as $$
  select coalesce(
    (select persona.wrike_user_id
     from public.application_user_operational_personas persona
     where persona.application_user_id=public.current_effective_user_id()
       and persona.operational_role=target_role and persona.is_active
     limit 1),
    (select member.wrike_user_id from public.application_users member
     where member.id=public.current_effective_user_id() and member.role=target_role)
  );
$$;

create or replace function public.current_has_capability(target_capability text)
returns boolean language sql stable security definer set search_path=public as $$
  select case target_capability
    when 'manage_smes' then public.current_has_management_role('sme_coordinator')
      or public.current_has_management_role('admin') or public.current_has_management_role('super_admin')
    when 'view_sme_survey_details' then public.current_has_management_role('sme_coordinator')
      or public.current_has_management_role('admin') or public.current_has_management_role('super_admin')
    when 'select_sme_dashboard_user' then public.current_has_operational_role('id')
      or public.current_has_management_role('sme_coordinator')
      or public.current_has_management_role('admin') or public.current_has_management_role('super_admin')
    when 'manage_users' then public.current_has_management_role('admin')
      or public.current_has_management_role('super_admin')
    when 'manage_surveys' then public.current_has_management_role('admin')
      or public.current_has_management_role('super_admin')
    when 'view_sme_dashboard' then public.current_has_operational_role('sme')
      or public.current_has_operational_role('id')
      or public.current_has_management_role('sme_coordinator')
      or public.current_has_management_role('admin') or public.current_has_management_role('super_admin')
    when 'view_personal_survey_index' then public.current_has_operational_role('id')
    when 'view_personal_surveys' then public.current_has_operational_role('id')
      or public.current_has_operational_role('sme')
    else false
  end;
$$;

create or replace function public.current_request_identity()
returns jsonb language sql stable security definer set search_path=public as $$
  select case when actor.id is null or effective.id is null then null else jsonb_build_object(
    'actorUserId',actor.id,'actorRole',actor.role,'actorName',coalesce(actor.display_name,'Administrator'),
    'effectiveUserId',effective.id,'effectiveRole',effective.role,
    'effectiveName',coalesce(effective.display_name,'DevTrack user'),
    'effectiveEmail',effective_auth.email,
    'organizationId',effective.organization_id,
    'impersonationSessionId',session.id,
    'impersonating',session.id is not null,
    'lastActivityAt',session.last_activity_at,
    'absoluteExpiresAt',session.absolute_expires_at,
    'operationalPersonaRole',public.current_operational_persona_role(),
    'operationalRoles',public.current_access_operational_roles(),
    'managementRoles',public.current_access_management_roles()
  ) end
  from public.application_users actor
  join public.application_users effective
    on effective.id=public.current_effective_user_id() and effective.account_state='active'
  left join auth.users effective_auth on effective_auth.id=effective.id
  left join public.administrator_impersonation_sessions session
    on session.id=public.current_impersonation_session_id()
  where actor.id=public.current_actor_user_id()
    and actor.organization_id=effective.organization_id;
$$;

create or replace function public.set_application_user_management_role(
  target_organization_id uuid,target_user_id uuid,target_role text,target_enabled boolean,acting_user_id uuid
)
returns void language plpgsql security definer set search_path=public,auth as $$
declare actor public.application_users%rowtype; target public.application_users%rowtype;
  existing public.application_user_management_roles%rowtype; saved public.application_user_management_roles%rowtype;
  actor_is_super boolean; actor_is_admin boolean;
begin
  select * into actor from public.application_users
    where id=acting_user_id and organization_id=target_organization_id and account_state='active';
  select * into target from public.application_users
    where id=target_user_id and organization_id=target_organization_id and account_state='active';
  actor_is_super:=actor.role='super_admin' or exists(select 1 from public.application_user_management_roles
    where application_user_id=actor.id and management_role='super_admin' and is_active);
  actor_is_admin:=actor_is_super or actor.role='admin' or exists(select 1 from public.application_user_management_roles
    where application_user_id=actor.id and management_role='admin' and is_active);
  if actor.id is null or target.id is null or target_role not in ('sme_coordinator','admin')
    or (target_role='admin' and not actor_is_super)
    or (target_role='sme_coordinator' and not actor_is_admin) then
    raise exception using errcode='42501',message='Management role change is unavailable.';
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
    ) or target_roles is null or not (target_roles <@ array['id','sme']::text[]) then
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

insert into public.application_user_deletion_manifest(relation_name,column_name,strategy,rationale) values
  ('application_user_management_roles','application_user_id','delete','Remove additive management access during offboarding.'),
  ('application_user_management_roles','created_by','retain_principal','Retain grant attribution.'),
  ('application_user_management_roles','updated_by','retain_principal','Retain grant attribution.'),
  ('application_user_management_role_audit','actor_user_id','retain_principal','Retain management-role audit attribution.'),
  ('application_user_management_role_audit','application_user_id','retain_principal','Retain management-role security history.')
on conflict (relation_name,column_name) do nothing;

alter table public.application_user_management_roles enable row level security;
alter table public.application_user_management_role_audit enable row level security;
revoke all on public.application_user_management_roles,public.application_user_management_role_audit from anon,authenticated;
grant all on public.application_user_management_roles,public.application_user_management_role_audit to service_role;
revoke all on function public.current_access_operational_roles(),public.current_access_management_roles(),
  public.current_has_operational_role(text),public.current_has_management_role(text),
  public.current_operational_identity(text),public.current_has_capability(text),
  public.set_application_user_management_role(uuid,uuid,text,boolean,uuid),
  public.set_application_user_operational_access(uuid,uuid,text[],uuid,uuid) from public;
grant execute on function public.current_access_operational_roles(),public.current_access_management_roles(),
  public.current_has_operational_role(text),public.current_has_management_role(text),
  public.current_operational_identity(text),public.current_has_capability(text) to authenticated,service_role;
grant execute on function public.set_application_user_management_role(uuid,uuid,text,boolean,uuid),
  public.set_application_user_operational_access(uuid,uuid,text[],uuid,uuid) to service_role;
