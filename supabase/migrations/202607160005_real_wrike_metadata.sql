-- Preserve real Wrike folder-tree and custom-field response structures.

alter table public.wrike_folders
  add column child_wrike_ids text[] not null default '{}',
  add column scope text;

alter table public.wrike_projects
  add column author_wrike_id text,
  add column custom_status_id text,
  add column created_at_wrike timestamptz;

alter table public.wrike_tasks
  add column enriched_metadata jsonb not null default '{"folderIds":[],"folders":[],"folderNames":[],"customFields":[]}'::jsonb;

alter table public.wrike_task_custom_field_values
  add column display_value jsonb,
  add column option_values text[] not null default '{}',
  add column resolved boolean not null default false;

alter table public.wrike_folder_task_imports
  add column folder_id uuid references public.wrike_folders(id) on delete set null;

alter table public.wrike_folder_task_import_runs
  add column folder_definition_count integer not null default 0,
  add column custom_field_definition_count integer not null default 0,
  add column metadata_diagnostics jsonb not null default '{}'::jsonb;

create index wrike_folder_task_imports_folder_idx on public.wrike_folder_task_imports(folder_id, task_id);
create index wrike_tasks_enriched_metadata_idx on public.wrike_tasks using gin(enriched_metadata);

create or replace function public.reporting_task_rows(
  filters jsonb default '{}'::jsonb,
  result_limit integer default 50,
  result_offset integer default 0
)
returns table (
  task_id uuid,
  title text,
  status text,
  custom_status_id text,
  due_date date,
  completed_at timestamptz,
  planned_minutes integer,
  actual_minutes bigint,
  updated_at_wrike timestamptz,
  assignees jsonb,
  locations jsonb,
  custom_values jsonb,
  total_count bigint
)
language sql
stable
set search_path = public
as $$
  with filtered as (
    select t.*, ft.visible_actual_minutes
    from public.reporting_filtered_tasks(filters) ft
    join public.wrike_tasks t on t.id=ft.task_id
  )
  select f.id, f.title, f.status, f.custom_status_id, f.due_date, f.completed_at, f.planned_minutes, f.visible_actual_minutes, f.updated_at_wrike,
    coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',u.display_name) order by u.display_name) from public.wrike_task_assignees a join public.wrike_users u on u.id=a.user_id where a.task_id=f.id), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'folderId', l.folder_id,
        'projectId', l.project_id,
        'wrikeId', l.wrike_location_id,
        'title', coalesce(folder.title, project.title, l.wrike_location_id),
        'scope', folder.scope,
        'resolved', (l.folder_id is not null or l.project_id is not null)
      ) order by coalesce(folder.title, project.title, l.wrike_location_id))
      from public.wrike_task_locations l
      left join public.wrike_folders folder on folder.id=l.folder_id
      left join public.wrike_projects project on project.id=l.project_id
      where l.task_id=f.id
    ), '[]'::jsonb),
    coalesce((select jsonb_object_agg(cv.custom_field_id::text, cv.text_value) from public.wrike_task_custom_field_values cv where cv.task_id=f.id), '{}'::jsonb),
    count(*) over()
  from filtered f
  order by
    case when filters->>'sort'='title' then lower(f.title) end asc,
    case when filters->>'sort'='due' then f.due_date end asc nulls last,
    case when filters->>'sort'='actual' then f.visible_actual_minutes end desc,
    f.updated_at_wrike desc nulls last, f.id
  limit greatest(1, least(result_limit, 200)) offset greatest(0, result_offset);
$$;

comment on column public.wrike_tasks.enriched_metadata is 'Resolved folder and custom-field labels while preserving original Wrike IDs and values.';
comment on column public.wrike_folder_task_import_runs.metadata_diagnostics is 'Observed custom-field title-search responses, fallback usage, and final LCT matches.';
