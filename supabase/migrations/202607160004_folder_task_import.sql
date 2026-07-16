-- Focused first-stage import: Wrike tasks from an explicit folder allowlist.

create table public.wrike_folder_task_imports (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  folder_wrike_id text not null,
  task_id uuid not null references public.wrike_tasks(id) on delete cascade,
  imported_at timestamptz not null default now(),
  primary key (organization_id, folder_wrike_id, task_id)
);

create index wrike_folder_task_imports_task_idx on public.wrike_folder_task_imports(task_id, folder_wrike_id);

create table public.wrike_folder_task_import_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  status text not null check (status in ('succeeded','failed')),
  folder_counts jsonb not null default '{}'::jsonb,
  task_count integer not null default 0,
  error_summary text,
  created_at timestamptz not null default now()
);

alter table public.wrike_folder_task_imports enable row level security;
alter table public.wrike_folder_task_import_runs enable row level security;

create policy "authorized folder task sources" on public.wrike_folder_task_imports for select
  using (public.can_access_wrike_task(task_id));
create policy "folder task import runs admin read" on public.wrike_folder_task_import_runs for select
  using (organization_id=public.current_organization_id() and public.is_org_admin());

grant select on public.wrike_folder_task_imports to authenticated;
grant select on public.wrike_folder_task_import_runs to authenticated;
grant all on public.wrike_folder_task_imports to service_role;
grant all on public.wrike_folder_task_import_runs to service_role;

create or replace function public.reset_wrike_reporting_data(target_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.wrike_sync_runs where organization_id=target_organization_id;
  delete from public.wrike_sync_scopes where organization_id=target_organization_id;
  delete from public.wrike_tasks where organization_id=target_organization_id;
  delete from public.wrike_projects where organization_id=target_organization_id;
  delete from public.wrike_folders where organization_id=target_organization_id;
  delete from public.wrike_spaces where organization_id=target_organization_id;
  delete from public.wrike_groups where organization_id=target_organization_id;
  delete from public.wrike_users where organization_id=target_organization_id;
  delete from public.wrike_custom_fields where organization_id=target_organization_id;
  delete from public.wrike_workflow_statuses where organization_id=target_organization_id;
  delete from public.wrike_timelog_categories where organization_id=target_organization_id;
  update public.organizations
    set reporting_access_enforced=false,
        ask_enabled=false,
        wrike_import_space_id=null,
        updated_at=now()
    where id=target_organization_id;
end;
$$;

revoke all on function public.reset_wrike_reporting_data(uuid) from public;
grant execute on function public.reset_wrike_reporting_data(uuid) to service_role;

comment on function public.reset_wrike_reporting_data(uuid) is 'Clears Wrike-derived records for a single organization while retaining its OAuth connection and application users.';
