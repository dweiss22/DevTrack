alter table public.application_users
  add column if not exists profile_completed boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

create table public.application_user_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  normalized_email text not null,
  role text not null default 'member' check (role in ('admin','member')),
  status text not null default 'pending' check (status in ('pending','failed','accepted','canceled')),
  auth_user_id uuid references auth.users(id) on delete set null,
  invited_by uuid references public.application_users(id) on delete set null,
  last_error text,
  invited_at timestamptz not null default now(),
  last_sent_at timestamptz,
  accepted_at timestamptz,
  canceled_at timestamptz,
  updated_at timestamptz not null default now(),
  check (normalized_email = lower(btrim(email)))
);

create unique index application_user_invitations_open_email_idx
  on public.application_user_invitations(normalized_email)
  where status in ('pending','failed');
create index application_user_invitations_org_status_idx
  on public.application_user_invitations(organization_id,status,invited_at desc);
create unique index application_user_invitations_auth_user_idx
  on public.application_user_invitations(auth_user_id)
  where auth_user_id is not null and status in ('pending','accepted');

alter table public.application_user_invitations enable row level security;
create policy "organization admins read invitations"
  on public.application_user_invitations for select
  using (organization_id=public.current_organization_id() and public.is_org_admin());

grant select on public.application_user_invitations to authenticated;
grant all on public.application_user_invitations to service_role;

create or replace function public.accept_application_user_invitation(target_user_id uuid,target_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_target_email text := lower(btrim(target_email));
  invitation public.application_user_invitations%rowtype;
  membership public.application_users%rowtype;
begin
  if normalized_target_email = '' then
    raise exception using errcode='22023',message='An authenticated email is required.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(normalized_target_email,0));

  select * into membership from public.application_users where id=target_user_id;
  if found then
    return jsonb_build_object(
      'accepted',false,
      'idempotent',true,
      'organizationId',membership.organization_id,
      'profileCompleted',membership.profile_completed
    );
  end if;

  select * into invitation
    from public.application_user_invitations
    where normalized_email=normalized_target_email
      and status='pending'
      and (auth_user_id is null or auth_user_id=target_user_id)
    order by invited_at
    limit 1
    for update;

  if not found then
    raise exception using errcode='P0001',message='No matching pending invitation.';
  end if;

  if invitation.auth_user_id is not null and invitation.auth_user_id<>target_user_id then
    raise exception using errcode='P0001',message='The invitation belongs to another identity.';
  end if;

  insert into public.application_users(id,organization_id,display_name,role,profile_completed,updated_at)
  values(target_user_id,invitation.organization_id,null,invitation.role,false,now());

  update public.application_user_invitations
    set status='accepted',auth_user_id=target_user_id,accepted_at=coalesce(accepted_at,now()),
        last_error=null,updated_at=now()
    where id=invitation.id;

  return jsonb_build_object(
    'accepted',true,
    'idempotent',false,
    'organizationId',invitation.organization_id,
    'profileCompleted',false
  );
end;
$$;

create or replace function public.change_application_user_role(
  target_organization_id uuid,
  target_user_id uuid,
  target_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_role text;
begin
  if target_role not in ('admin','member') then
    raise exception using errcode='22023',message='Invalid application role.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text,0));
  select role into current_role
    from public.application_users
    where id=target_user_id and organization_id=target_organization_id
    for update;
  if not found then
    raise exception using errcode='P0001',message='Organization member not found.';
  end if;

  if current_role='admin' and target_role<>'admin' and
    (select count(*) from public.application_users where organization_id=target_organization_id and role='admin')<=1 then
    raise exception using errcode='23514',message='The last organization administrator cannot be demoted.';
  end if;

  update public.application_users
    set role=target_role,updated_at=now()
    where id=target_user_id and organization_id=target_organization_id;
end;
$$;

revoke all on function public.accept_application_user_invitation(uuid,text) from public;
revoke all on function public.change_application_user_role(uuid,uuid,text) from public;
grant execute on function public.accept_application_user_invitation(uuid,text) to service_role;
grant execute on function public.change_application_user_role(uuid,uuid,text) to service_role;

comment on table public.application_user_invitations is
  'Organization-scoped app authorization invitations. Supabase invitation tokens are never stored here.';
comment on column public.application_users.profile_completed is
  'False until an administrator-invited user finishes first-time password and profile setup.';
