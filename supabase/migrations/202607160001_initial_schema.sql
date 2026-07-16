create extension if not exists pgcrypto;

create type public.sync_status as enum ('running', 'succeeded', 'partial', 'failed');
create type public.scope_type as enum ('account', 'space', 'folder', 'project', 'task', 'list');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.application_users (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  display_name text,
  role text not null default 'member' check (role in ('admin','member')),
  created_at timestamptz not null default now(),
  unique (id, organization_id)
);

create function public.current_organization_id() returns uuid language sql stable security definer set search_path = public as $$
  select organization_id from public.application_users where id = auth.uid() limit 1;
$$;
create function public.is_org_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.application_users where id = auth.uid() and role = 'admin');
$$;

create table public.wrike_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  connected_by uuid references public.application_users(id) on delete set null,
  wrike_account_id text,
  account_name text,
  encrypted_access_token text not null,
  encrypted_refresh_token text not null,
  token_expires_at timestamptz,
  status text not null default 'connected' check (status in ('connected','expired','revoked','disconnected')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.wrike_sync_scopes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scope_type public.scope_type not null,
  source_ids text[] not null default '{}',
  label text not null,
  reporting_user_ids text[] not null default '{}',
  is_active boolean not null default true,
  created_by uuid references public.application_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.wrike_sync_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scope_id uuid references public.wrike_sync_scopes(id) on delete set null,
  trigger text not null check (trigger in ('manual','scheduled','backfill')),
  status public.sync_status not null default 'running',
  started_at timestamptz not null default now(), completed_at timestamptz,
  since_at timestamptz, record_counts jsonb not null default '{}'::jsonb,
  error_summary text, errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table public.wrike_users (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  wrike_id text not null, email text, first_name text, last_name text, display_name text not null,
  raw_data jsonb not null default '{}'::jsonb, is_active boolean not null default true, deleted_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id, wrike_id)
);
create table public.wrike_groups (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  wrike_id text not null, title text not null, raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id, wrike_id)
);
create table public.wrike_group_members (
  group_id uuid not null references public.wrike_groups(id) on delete cascade, user_id uuid not null references public.wrike_users(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(group_id,user_id)
);
create table public.wrike_spaces (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  wrike_id text not null, title text not null, raw_data jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,wrike_id)
);
create table public.wrike_folders (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  wrike_id text not null, space_id uuid references public.wrike_spaces(id) on delete set null, title text not null, parent_wrike_ids text[] not null default '{}', is_project boolean not null default false,
  raw_data jsonb not null default '{}'::jsonb, deleted_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,wrike_id)
);
create table public.wrike_projects (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  wrike_id text not null, folder_id uuid references public.wrike_folders(id) on delete set null, title text not null, status text, owner_wrike_ids text[] not null default '{}',
  raw_data jsonb not null default '{}'::jsonb, deleted_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,wrike_id)
);
create table public.wrike_tasks (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  wrike_id text not null, title text not null, description text, permalink text, status text not null, workflow_id text, custom_status_id text, importance text,
  created_at_wrike timestamptz, updated_at_wrike timestamptz, start_date date, due_date date, completed_at timestamptz, parent_wrike_ids text[] not null default '{}',
  task_type text, planned_minutes integer, raw_data jsonb not null default '{}'::jsonb, is_deleted boolean not null default false, last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,wrike_id)
);
create table public.wrike_task_assignees (
  task_id uuid not null references public.wrike_tasks(id) on delete cascade, user_id uuid not null references public.wrike_users(id) on delete cascade,
  assignment_type text not null default 'assignee', created_at timestamptz not null default now(), primary key(task_id,user_id,assignment_type)
);
create table public.wrike_task_locations (
  task_id uuid not null references public.wrike_tasks(id) on delete cascade, folder_id uuid references public.wrike_folders(id) on delete cascade,
  project_id uuid references public.wrike_projects(id) on delete cascade, wrike_location_id text not null, created_at timestamptz not null default now(), primary key(task_id,wrike_location_id)
);
create table public.wrike_time_entries (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  wrike_id text not null, task_id uuid not null references public.wrike_tasks(id) on delete cascade, user_id uuid references public.wrike_users(id) on delete set null,
  entry_date date not null, minutes integer not null check(minutes >= 0), category text, comment text, created_at_wrike timestamptz, updated_at_wrike timestamptz,
  raw_data jsonb not null default '{}'::jsonb, is_deleted boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,wrike_id)
);
create table public.wrike_custom_fields (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  wrike_id text not null, title text not null, field_type text, raw_data jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,wrike_id)
);
create table public.wrike_task_custom_field_values (
  task_id uuid not null references public.wrike_tasks(id) on delete cascade, custom_field_id uuid not null references public.wrike_custom_fields(id) on delete cascade,
  value jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key(task_id,custom_field_id)
);

create index wrike_tasks_reporting_idx on public.wrike_tasks(organization_id,status,completed_at,due_date,updated_at_wrike);
create index wrike_entries_reporting_idx on public.wrike_time_entries(organization_id,entry_date,task_id,user_id);
create index wrike_folders_org_idx on public.wrike_folders(organization_id,wrike_id);

alter table public.organizations enable row level security;
alter table public.application_users enable row level security;
alter table public.wrike_connections enable row level security;
alter table public.wrike_sync_scopes enable row level security;
alter table public.wrike_sync_runs enable row level security;
alter table public.wrike_users enable row level security;
alter table public.wrike_groups enable row level security;
alter table public.wrike_group_members enable row level security;
alter table public.wrike_spaces enable row level security;
alter table public.wrike_folders enable row level security;
alter table public.wrike_projects enable row level security;
alter table public.wrike_tasks enable row level security;
alter table public.wrike_task_assignees enable row level security;
alter table public.wrike_task_locations enable row level security;
alter table public.wrike_time_entries enable row level security;
alter table public.wrike_custom_fields enable row level security;
alter table public.wrike_task_custom_field_values enable row level security;

create policy "org access" on public.organizations for select using (id = public.current_organization_id());
create policy "user access" on public.application_users for select using (organization_id = public.current_organization_id());
create policy "connection admin access" on public.wrike_connections for all using (organization_id = public.current_organization_id() and public.is_org_admin()) with check (organization_id = public.current_organization_id() and public.is_org_admin());
create policy "scope org access" on public.wrike_sync_scopes for select using (organization_id = public.current_organization_id());
create policy "scope admin write" on public.wrike_sync_scopes for all using (organization_id = public.current_organization_id() and public.is_org_admin()) with check (organization_id = public.current_organization_id() and public.is_org_admin());

do $$ declare table_name text; begin
  foreach table_name in array array['wrike_sync_runs','wrike_users','wrike_groups','wrike_spaces','wrike_folders','wrike_projects','wrike_tasks','wrike_time_entries','wrike_custom_fields'] loop
    execute format('create policy "org read %1$s" on public.%1$I for select using (organization_id = public.current_organization_id())', table_name);
  end loop;
end $$;
create policy "group members read" on public.wrike_group_members for select using (exists(select 1 from public.wrike_groups g where g.id=group_id and g.organization_id=public.current_organization_id()));
create policy "task assignees read" on public.wrike_task_assignees for select using (exists(select 1 from public.wrike_tasks t where t.id=task_id and t.organization_id=public.current_organization_id()));
create policy "task locations read" on public.wrike_task_locations for select using (exists(select 1 from public.wrike_tasks t where t.id=task_id and t.organization_id=public.current_organization_id()));
create policy "custom values read" on public.wrike_task_custom_field_values for select using (exists(select 1 from public.wrike_tasks t where t.id=task_id and t.organization_id=public.current_organization_id()));
