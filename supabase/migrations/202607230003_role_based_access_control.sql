-- Four-role application authorization and canonical SME assignment mapping.

alter table public.application_users drop constraint if exists application_users_role_check;
alter table public.application_users alter column role set default 'id';

update public.application_users application_user
set role=case
  when lower(auth_user.email)='dweiss@lexipol.com' then 'super_admin'
  when application_user.role='admin' then 'admin'
  else 'id'
end,
updated_at=now()
from auth.users auth_user
where auth_user.id=application_user.id;

update public.application_users set role='id',updated_at=now() where role not in ('super_admin','admin','id','sme');

alter table public.application_users
  add constraint application_users_role_check check (role in ('super_admin','admin','id','sme')),
  add column if not exists wrike_user_id uuid references public.wrike_users(id) on delete set null;

create unique index application_users_org_wrike_sme_idx
  on public.application_users(organization_id,wrike_user_id)
  where wrike_user_id is not null;

alter table public.application_user_invitations drop constraint if exists application_user_invitations_role_check;
update public.application_user_invitations set role='id' where role='member';
alter table public.application_user_invitations
  alter column role set default 'id',
  add constraint application_user_invitations_role_check check (role in ('admin','id','sme'));

create or replace function public.current_application_role()
returns text
language sql
stable
security definer
set search_path=public
as $$
  select role from public.application_users where id=auth.uid() limit 1;
$$;
revoke all on function public.current_application_role() from public;
grant execute on function public.current_application_role() to authenticated,service_role;

-- Standard reporting functions and RLS policies resolve their organization
-- through this helper. Returning no organization for SMEs closes those older
-- read paths; the validated SME dashboard functions below resolve the viewer
-- and mapped identity independently.
create or replace function public.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path=public
as $$
  select organization_id
  from public.application_users
  where id=auth.uid() and role in ('super_admin','admin','id')
  limit 1;
$$;
revoke all on function public.current_organization_id() from public;
grant execute on function public.current_organization_id() to authenticated,service_role;

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

drop trigger if exists guard_application_user_authorization on public.application_users;
create trigger guard_application_user_authorization
before insert or update or delete on public.application_users
for each row execute function public.guard_application_user_authorization();

create or replace function public.guard_fixed_superadmin_auth_identity()
returns trigger
language plpgsql
security definer
set search_path=public,auth
as $$
declare
  old_email text:=lower(btrim(old.email));
  new_email text:=case when tg_op='UPDATE' then lower(btrim(new.email)) else null end;
begin
  if tg_op='DELETE' and old_email='dweiss@lexipol.com' then
    raise exception using errcode='23514',message='The required SuperAdmin authentication identity cannot be deleted.';
  end if;
  if tg_op='UPDATE' and old_email='dweiss@lexipol.com' and new_email is distinct from old_email then
    raise exception using errcode='23514',message='The required SuperAdmin email cannot be changed.';
  end if;
  if tg_op='UPDATE' and new_email='dweiss@lexipol.com' and old_email is distinct from new_email then
    raise exception using errcode='23514',message='The required SuperAdmin email cannot be transferred.';
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;

drop trigger if exists guard_fixed_superadmin_auth_identity on auth.users;
create trigger guard_fixed_superadmin_auth_identity
before update of email or delete on auth.users
for each row execute function public.guard_fixed_superadmin_auth_identity();
revoke all on function public.guard_fixed_superadmin_auth_identity() from public;

drop policy if exists "user access" on public.application_users;
create policy "organization membership read" on public.application_users for select using (
  id=auth.uid() or (
    organization_id=public.current_organization_id()
    and public.current_application_role() in ('super_admin','admin','id')
  )
);

-- SMEs retrieve assignment data only through the validated dashboard RPC below.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'organizations','wrike_users','wrike_groups','wrike_group_members','wrike_spaces','wrike_folders',
    'wrike_projects','wrike_tasks','wrike_task_assignees','wrike_task_locations','wrike_time_entries',
    'wrike_custom_fields','wrike_task_custom_field_values','wrike_workflow_statuses',
    'wrike_timelog_categories','wrike_normalized_custom_fields','wrike_task_normalized_custom_field_values',
    'wrike_person_identities'
  ] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('drop policy if exists "sme direct read restriction" on public.%I',table_name);
      execute format(
        'create policy "sme direct read restriction" on public.%I as restrictive for select using (coalesce(public.current_application_role(),'''')<>''sme'')',
        table_name
      );
    end if;
  end loop;
end;
$$;

drop function if exists public.change_application_user_role(uuid,uuid,text);
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
begin
  if target_role not in ('super_admin','admin','id','sme') then
    raise exception using errcode='22023',message='Invalid application role.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text,0));

  select role into actor_role from public.application_users
    where id=acting_user_id and organization_id=target_organization_id;
  if actor_role not in ('super_admin','admin') then
    raise exception using errcode='42501',message='User management permission is required.';
  end if;

  select application_user.role,lower(btrim(auth_user.email))
    into current_role,target_email
    from public.application_users application_user
    join auth.users auth_user on auth_user.id=application_user.id
    where application_user.id=target_user_id and application_user.organization_id=target_organization_id
    for update of application_user;
  if not found then raise exception using errcode='P0001',message='Organization member not found.'; end if;

  if current_role='super_admin' or target_email='dweiss@lexipol.com' then
    raise exception using errcode='23514',message='The required SuperAdmin account cannot be modified.';
  end if;
  if target_role='super_admin' then
    raise exception using errcode='42501',message='The SuperAdmin role cannot be assigned.';
  end if;

  update public.application_users
    set role=target_role,wrike_user_id=case when target_role='sme' then wrike_user_id else null end,updated_at=now()
    where id=target_user_id and organization_id=target_organization_id;
end;
$$;

create or replace function public.set_application_user_sme_identity(
  target_organization_id uuid,
  target_user_id uuid,
  target_wrike_user_id uuid,
  acting_user_id uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if not exists(
    select 1 from public.application_users
    where id=acting_user_id and organization_id=target_organization_id and role in ('super_admin','admin')
  ) then raise exception using errcode='42501',message='User management permission is required.'; end if;

  if not exists(
    select 1 from public.application_users
    where id=target_user_id and organization_id=target_organization_id and role='sme'
  ) then raise exception using errcode='P0001',message='The selected application user is not an SME.'; end if;

  if target_wrike_user_id is not null and not exists(
    select 1 from public.wrike_users
    where id=target_wrike_user_id and organization_id=target_organization_id and is_active and not is_unresolved
  ) then raise exception using errcode='P0001',message='The selected synchronized identity is not eligible.'; end if;

  update public.application_users
    set wrike_user_id=target_wrike_user_id,updated_at=now()
    where id=target_user_id and organization_id=target_organization_id;
end;
$$;

create or replace function public.reporting_sme_dashboard_users()
returns table(application_user_id uuid,display_name text,wrike_user_id uuid,wrike_display_name text,mapping_status text)
language plpgsql
stable
security definer
set search_path=public
as $$
declare viewer public.application_users%rowtype;
begin
  select * into viewer from public.application_users where id=auth.uid();
  if not found then raise exception using errcode='42501',message='Application access is required.'; end if;
  if viewer.role not in ('super_admin','admin','id','sme') then
    raise exception using errcode='42501',message='SME Dashboard access is required.';
  end if;
  return query
    select member.id,coalesce(member.display_name,'Unnamed SME'),member.wrike_user_id,identity.display_name,
      case when member.wrike_user_id is null then 'missing'
           when identity.id is null or identity.is_unresolved then 'ambiguous'
           else 'mapped' end
    from public.application_users member
    left join public.wrike_users identity on identity.id=member.wrike_user_id and identity.organization_id=member.organization_id
    where member.organization_id=viewer.organization_id and member.role='sme'
      and (viewer.role<>'sme' or member.id=viewer.id)
    order by coalesce(member.display_name,'');
end;
$$;

create or replace function public.reporting_sme_dashboard(target_application_user_id uuid default null)
returns table(
  task_id uuid,title text,status_name text,status_classification text,due_date date,completed_at timestamptz,
  actual_minutes bigint,folder_context text,updated_at_wrike timestamptz,is_overdue boolean
)
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  viewer public.application_users%rowtype;
  selected_sme public.application_users%rowtype;
begin
  select * into viewer from public.application_users where id=auth.uid();
  if not found then raise exception using errcode='42501',message='Application access is required.'; end if;

  if viewer.role='sme' then
    if target_application_user_id is not null and target_application_user_id<>viewer.id then
      raise exception using errcode='42501',message='An SME may view only their own dashboard.';
    end if;
    target_application_user_id:=viewer.id;
  elsif viewer.role not in ('super_admin','admin','id') then
    raise exception using errcode='42501',message='SME Dashboard access is required.';
  end if;

  if target_application_user_id is null then return; end if;
  select * into selected_sme from public.application_users
    where id=target_application_user_id and organization_id=viewer.organization_id and role='sme';
  if not found then raise exception using errcode='42501',message='The selected SME is not eligible.'; end if;
  if selected_sme.wrike_user_id is null then return; end if;

  return query
    select task.id,task.title,coalesce(workflow_status.title,task.status),
      coalesce(workflow_status.dashboard_classification,'unclassified'),
      task.due_date,task.completed_at,coalesce(sum(time_entry.minutes),0)::bigint,
      coalesce((
        select string_agg(distinct folder.title,', ' order by folder.title)
        from public.wrike_task_locations location
        join public.wrike_folders folder on folder.id=location.folder_id
        where location.task_id=task.id
      ),'—'),
      task.updated_at_wrike,
      task.completed_at is null and task.due_date<current_date
    from public.wrike_tasks task
    join public.wrike_task_assignees assignee on assignee.task_id=task.id and assignee.user_id=selected_sme.wrike_user_id
    left join public.wrike_workflow_statuses workflow_status
      on workflow_status.organization_id=task.organization_id and workflow_status.wrike_id=task.custom_status_id
    left join public.wrike_time_entries time_entry
      on time_entry.task_id=task.id and time_entry.organization_id=task.organization_id and not time_entry.is_deleted
    where task.organization_id=viewer.organization_id and not task.is_deleted
    group by task.id,task.title,workflow_status.title,task.status,workflow_status.dashboard_classification,
      task.due_date,task.completed_at,task.updated_at_wrike
    order by task.completed_at nulls first,task.due_date nulls last,task.title;
end;
$$;

revoke all on function public.change_application_user_role(uuid,uuid,text,uuid) from public;
revoke all on function public.set_application_user_sme_identity(uuid,uuid,uuid,uuid) from public;
revoke all on function public.reporting_sme_dashboard_users() from public;
revoke all on function public.reporting_sme_dashboard(uuid) from public;
grant execute on function public.change_application_user_role(uuid,uuid,text,uuid) to service_role;
grant execute on function public.set_application_user_sme_identity(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.reporting_sme_dashboard_users() to authenticated,service_role;
grant execute on function public.reporting_sme_dashboard(uuid) to authenticated,service_role;
