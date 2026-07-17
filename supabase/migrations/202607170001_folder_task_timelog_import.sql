-- Combined folder-based task and timelog import with non-destructive reconciliation.

alter table public.wrike_connections
  add column timelog_descendant_strategy text not null default 'unknown'
    check (timelog_descendant_strategy in ('unknown','folder_recursive','explicit_tree')),
  add column timelog_descendant_verified_at timestamptz,
  add column timelog_descendant_diagnostics jsonb not null default '{}'::jsonb;

alter table public.wrike_time_entries
  add column task_wrike_id text,
  add column user_wrike_id text,
  add column hours numeric;

update public.wrike_time_entries entry
set task_wrike_id = task.wrike_id
from public.wrike_tasks task
where task.id = entry.task_id and entry.task_wrike_id is null;

update public.wrike_time_entries entry
set user_wrike_id = usr.wrike_id
from public.wrike_users usr
where usr.id = entry.user_id and entry.user_wrike_id is null;

update public.wrike_time_entries
set hours = minutes::numeric / 60
where hours is null;

alter table public.wrike_time_entries
  alter column task_wrike_id set not null,
  alter column hours set not null,
  alter column task_id drop not null,
  drop constraint if exists wrike_time_entries_task_id_fkey,
  add constraint wrike_time_entries_task_id_fkey foreign key (task_id) references public.wrike_tasks(id) on delete set null;

alter table public.wrike_time_entries
  add constraint wrike_time_entries_hours_nonnegative check (hours >= 0);

create index wrike_time_entries_task_wrike_idx on public.wrike_time_entries(organization_id, task_wrike_id);
create index wrike_time_entries_user_wrike_idx on public.wrike_time_entries(organization_id, user_wrike_id);

alter table public.wrike_folder_task_imports
  add column folder_id uuid references public.wrike_folders(id) on delete set null;

update public.wrike_folder_task_imports source
set folder_id = folder.id
from public.wrike_folders folder
where folder.organization_id = source.organization_id
  and folder.wrike_id = source.folder_wrike_id
  and source.folder_id is null;

create index wrike_folder_task_imports_folder_idx on public.wrike_folder_task_imports(folder_id, task_id);

create table public.wrike_folder_timelog_imports (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  folder_wrike_id text not null,
  folder_id uuid references public.wrike_folders(id) on delete set null,
  time_entry_id uuid not null references public.wrike_time_entries(id) on delete cascade,
  imported_at timestamptz not null default now(),
  primary key (organization_id, folder_wrike_id, time_entry_id)
);

create index wrike_folder_timelog_imports_entry_idx on public.wrike_folder_timelog_imports(time_entry_id, folder_wrike_id);
create index wrike_folder_timelog_imports_folder_idx on public.wrike_folder_timelog_imports(folder_id, time_entry_id);

alter table public.wrike_folder_timelog_imports enable row level security;
create policy "authorized folder timelog sources" on public.wrike_folder_timelog_imports for select
  using (public.can_access_wrike_time_entry(time_entry_id));
grant select on public.wrike_folder_timelog_imports to authenticated;
grant all on public.wrike_folder_timelog_imports to service_role;

alter table public.wrike_folder_task_import_runs
  drop constraint if exists wrike_folder_task_import_runs_status_check;

alter table public.wrike_folder_task_import_runs
  add constraint wrike_folder_task_import_runs_status_check check (status in ('running','succeeded','failed')),
  add column started_at timestamptz not null default now(),
  add column completed_at timestamptz,
  add column duration_ms integer,
  add column selected_folder_count integer not null default 0,
  add column processed_folder_count integer not null default 0,
  add column task_request_count integer not null default 0,
  add column task_record_count integer not null default 0,
  add column unique_task_count integer not null default 0,
  add column duplicate_task_count integer not null default 0,
  add column timelog_request_count integer not null default 0,
  add column timelog_record_count integer not null default 0,
  add column unique_timelog_count integer not null default 0,
  add column duplicate_timelog_count integer not null default 0,
  add column failed_folder_request_count integer not null default 0,
  add column folder_failures jsonb not null default '[]'::jsonb,
  add column timelog_folder_counts jsonb not null default '{}'::jsonb,
  add column task_request_contract jsonb not null default '{}'::jsonb,
  add column timelog_descendant_strategy text not null default 'unknown'
    check (timelog_descendant_strategy in ('unknown','folder_recursive','explicit_tree')),
  add column timelog_descendant_diagnostics jsonb not null default '{}'::jsonb;

update public.wrike_folder_task_import_runs
set started_at = created_at,
    completed_at = coalesce(completed_at, created_at),
    selected_folder_count = 13,
    processed_folder_count = case when status = 'succeeded' then 13 else 0 end,
    unique_task_count = task_count
where selected_folder_count = 0;

comment on table public.wrike_folder_timelog_imports is 'Many-to-many selected top-level source folders for imported Wrike timelogs.';
comment on column public.wrike_folder_task_imports.folder_id is 'Normalized selected source folder; folder_wrike_id remains the stable raw source identifier.';
comment on column public.wrike_time_entries.task_wrike_id is 'Raw Wrike task ID retained even when the local task foreign key cannot be resolved.';
comment on column public.wrike_time_entries.user_wrike_id is 'Raw Wrike user ID retained even when no local Wrike user row exists.';
comment on column public.wrike_connections.timelog_descendant_strategy is 'Observed folder timelog behavior: recursive response or explicit folder-tree traversal.';
