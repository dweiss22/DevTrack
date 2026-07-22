-- Separate readable person identity from Wrike verification.

alter table public.wrike_users
  add column if not exists identity_verified boolean not null default false,
  add column if not exists identity_verification_source text,
  add column if not exists identity_verified_at timestamptz;

update public.wrike_users
set identity_verified=not is_unresolved and display_name<>wrike_id and coalesce(raw_data->>'referenceSource','')<>'configured_fallback',
    identity_verification_source=case
      when raw_data->>'referenceSource'='configured_fallback' then 'configured_fallback'
      when not is_unresolved and display_name<>wrike_id then 'wrike_contact'
      else 'unresolved' end,
    identity_verified_at=case when not is_unresolved and display_name<>wrike_id and coalesce(raw_data->>'referenceSource','')<>'configured_fallback' then coalesce(synced_at,updated_at) else null end
where identity_verification_source is null;

alter table public.wrike_users
  add constraint wrike_users_identity_verification_source_check check (
    identity_verification_source is null or identity_verification_source in
      ('wrike_contact','email_match','task_name','configured_fallback','manual_mapping','unresolved')
  );

create table if not exists public.wrike_person_identities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  identity_key text not null,
  display_name text not null,
  normalized_name text not null,
  first_name text,
  last_name text,
  email text,
  wrike_contact_id text,
  contact_active boolean,
  contact_deleted boolean,
  is_displayable boolean not null default true,
  is_verified boolean not null default false,
  verification_source text not null default 'task_name' check (
    verification_source in ('wrike_contact','email_match','task_name','configured_fallback','manual_mapping','unresolved')
  ),
  verification_status text not null default 'unverified' check (
    verification_status in ('unverified','verified','ambiguous','not_found','failed')
  ),
  candidate_contacts jsonb not null default '[]'::jsonb,
  source_task_ids text[] not null default '{}',
  verification_attempt_count integer not null default 0,
  last_verification_attempt_at timestamptz,
  next_verification_attempt_at timestamptz,
  last_verified_at timestamptz,
  last_error text,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,identity_key),
  check (not is_verified or (wrike_contact_id is not null and last_verified_at is not null)),
  check (verification_status<>'verified' or is_verified)
);

create index if not exists wrike_person_identities_review_idx
  on public.wrike_person_identities(organization_id,verification_status,updated_at desc);
create index if not exists wrike_person_identities_pending_idx
  on public.wrike_person_identities(organization_id,next_verification_attempt_at,updated_at)
  where is_displayable and not is_verified;
create index if not exists wrike_person_identities_contact_idx
  on public.wrike_person_identities(organization_id,wrike_contact_id)
  where wrike_contact_id is not null;
create index if not exists wrike_person_identities_name_idx
  on public.wrike_person_identities(organization_id,normalized_name);

alter table public.wrike_person_identities enable row level security;
drop policy if exists "person identities org read" on public.wrike_person_identities;
create policy "person identities org read" on public.wrike_person_identities for select
  using (organization_id=public.current_organization_id());
drop policy if exists "person identities admin write" on public.wrike_person_identities;
create policy "person identities admin write" on public.wrike_person_identities for all
  using (organization_id=public.current_organization_id() and public.is_org_admin())
  with check (organization_id=public.current_organization_id() and public.is_org_admin());

grant select on public.wrike_person_identities to authenticated;
grant all on public.wrike_person_identities to service_role;

comment on table public.wrike_person_identities is
  'Task-provided readable people and their optional cached Wrike contact verification; displayability is independent from verification.';
comment on column public.wrike_person_identities.identity_key is
  'Stable normalized email key when available, otherwise normalized display-name key.';
comment on column public.wrike_person_identities.candidate_contacts is
  'Safe candidate metadata retained for administrator review when matching is ambiguous.';

select pg_notify('pgrst','reload schema');
