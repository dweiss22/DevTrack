-- Centralized Wrike reference resolution, unresolved tracking, manual mappings,
-- and workflow-aware Online Learning dashboard classification.

alter table public.wrike_users
  add column if not exists user_type text,
  add column if not exists is_unresolved boolean not null default false,
  add column if not exists last_resolution_attempt_at timestamptz,
  add column if not exists last_resolution_error text;

alter table public.wrike_spaces
  add column if not exists is_unresolved boolean not null default false,
  add column if not exists synced_at timestamptz,
  add column if not exists last_resolution_error text;

alter table public.wrike_folders
  add column if not exists is_unresolved boolean not null default false,
  add column if not exists synced_at timestamptz,
  add column if not exists last_resolution_error text;

alter table public.wrike_custom_fields
  add column if not exists original_title text,
  add column if not exists allowed_values jsonb not null default '[]'::jsonb,
  add column if not exists source_designation text check (source_designation in ('M','L') or source_designation is null),
  add column if not exists is_unresolved boolean not null default false,
  add column if not exists has_manual_mapping boolean not null default false,
  add column if not exists resolved_at timestamptz,
  add column if not exists synced_at timestamptz,
  add column if not exists last_resolution_attempt_at timestamptz,
  add column if not exists last_resolution_error text;

alter table public.wrike_workflows
  add column if not exists workflow_type text,
  add column if not exists workflow_status text,
  add column if not exists is_unresolved boolean not null default false,
  add column if not exists last_resolution_error text;

alter table public.wrike_workflow_statuses
  add column if not exists workflow_record_id uuid references public.wrike_workflows(id) on delete set null,
  add column if not exists display_order integer,
  add column if not exists dashboard_classification text check (dashboard_classification in ('active','completed','stalled_or_canceled') or dashboard_classification is null),
  add column if not exists classification_source text check (classification_source in ('automatic','manual') or classification_source is null),
  add column if not exists classification_updated_by uuid references public.application_users(id) on delete set null,
  add column if not exists classification_updated_at timestamptz,
  add column if not exists is_unresolved boolean not null default false,
  add column if not exists last_resolution_error text;

alter table public.wrike_timelog_categories
  add column if not exists is_unresolved boolean not null default false,
  add column if not exists last_resolution_error text;

update public.wrike_custom_fields
set original_title=coalesce(original_title,title),
    synced_at=coalesce(synced_at,updated_at),
    resolved_at=coalesce(resolved_at,updated_at)
where not is_unresolved;

update public.wrike_users
set is_unresolved=(raw_data->>'referenceSource'='unresolved_placeholder')
where raw_data ? 'referenceSource';

update public.wrike_workflow_statuses status
set workflow_record_id=workflow.id
from public.wrike_workflows workflow
where workflow.organization_id=status.organization_id
  and workflow.wrike_id=status.workflow_id
  and status.workflow_record_id is null;

update public.wrike_workflow_statuses
set dashboard_classification=case
      when lower(title) ~ '(stalled|cancelled|canceled)' or lower(coalesce(status_group,'')) in ('cancelled','canceled') then 'stalled_or_canceled'
      when lower(coalesce(status_group,''))='completed' then 'completed'
      when lower(coalesce(status_group,'')) in ('active','deferred') then 'active'
      else null end,
    classification_source=case
      when lower(title) ~ '(stalled|cancelled|canceled)'
        or lower(coalesce(status_group,'')) in ('cancelled','canceled','completed','active','deferred')
      then 'automatic' else null end,
    classification_updated_at=coalesce(classification_updated_at,now())
where classification_source is null;

create table if not exists public.wrike_manual_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  reference_type text not null check (reference_type in ('custom_field')),
  wrike_id text not null,
  action text not null check (action in ('map_existing','create_new','ignore')),
  target_normalized_field_id uuid references public.wrike_normalized_custom_fields(id) on delete set null,
  manual_label text,
  reprocess_status text not null default 'pending' check (reprocess_status in ('pending','succeeded','failed')),
  reprocess_error text,
  created_by uuid references public.application_users(id) on delete set null,
  updated_by uuid references public.application_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,reference_type,wrike_id),
  check (action='ignore' or target_normalized_field_id is not null)
);

create table if not exists public.wrike_unresolved_references (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  reference_type text not null check (reference_type in ('custom_field','user','custom_status','workflow','folder','space','timelog_category')),
  wrike_id text not null,
  sample_values jsonb not null default '[]'::jsonb,
  related_records jsonb not null default '[]'::jsonb,
  occurrence_count integer not null default 1,
  resolution_attempts integer not null default 0,
  first_encountered_at timestamptz not null default now(),
  last_encountered_at timestamptz not null default now(),
  last_attempted_at timestamptz,
  last_error text,
  resolution_status text not null default 'unresolved' check (resolution_status in ('unresolved','resolved','ignored')),
  resolved_at timestamptz,
  manual_mapping_id uuid references public.wrike_manual_mappings(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,reference_type,wrike_id)
);

alter table public.wrike_folder_task_import_runs
  add column if not exists unresolved_reference_count integer not null default 0,
  add column if not exists reference_resolution_diagnostics jsonb not null default '{}'::jsonb;

create index if not exists wrike_users_resolution_idx on public.wrike_users(organization_id,is_unresolved,synced_at);
create index if not exists wrike_custom_fields_resolution_idx on public.wrike_custom_fields(organization_id,is_unresolved,wrike_id);
create index if not exists wrike_status_workflow_record_idx on public.wrike_workflow_statuses(workflow_record_id,wrike_id);
create index if not exists wrike_status_classification_idx on public.wrike_workflow_statuses(organization_id,workflow_id,dashboard_classification);
create index if not exists wrike_unresolved_status_idx on public.wrike_unresolved_references(organization_id,resolution_status,reference_type,last_encountered_at desc);
create index if not exists wrike_manual_mapping_target_idx on public.wrike_manual_mappings(target_normalized_field_id);

alter table public.wrike_manual_mappings enable row level security;
alter table public.wrike_unresolved_references enable row level security;

drop policy if exists "manual mapping admin access" on public.wrike_manual_mappings;
create policy "manual mapping admin access" on public.wrike_manual_mappings for all
  using (organization_id=public.current_organization_id() and public.is_org_admin())
  with check (
    organization_id=public.current_organization_id()
    and public.is_org_admin()
    and (
      target_normalized_field_id is null
      or exists (
        select 1 from public.wrike_normalized_custom_fields target
        where target.id=target_normalized_field_id
          and target.organization_id=wrike_manual_mappings.organization_id
      )
    )
  );

drop policy if exists "unresolved reference admin access" on public.wrike_unresolved_references;
create policy "unresolved reference admin access" on public.wrike_unresolved_references for all
  using (organization_id=public.current_organization_id() and public.is_org_admin())
  with check (organization_id=public.current_organization_id() and public.is_org_admin());

grant select,insert,update,delete on public.wrike_manual_mappings to authenticated;
grant select,insert,update,delete on public.wrike_unresolved_references to authenticated;
grant all on public.wrike_manual_mappings to service_role;
grant all on public.wrike_unresolved_references to service_role;

-- Accept stable custom-status IDs while retaining title/base-status compatibility
-- for existing bookmarked report URLs.
create or replace function public.matches_reporting_status(target_organization_id uuid, status_value text, custom_status_value text, requested jsonb)
returns boolean language sql stable security definer set search_path = public as $$
  select requested is null
    or status_value in (select jsonb_array_elements_text(requested))
    or custom_status_value in (select jsonb_array_elements_text(requested))
    or exists(
      select 1 from public.wrike_workflow_statuses s
      where s.organization_id=target_organization_id and s.wrike_id=custom_status_value
        and s.title in (select jsonb_array_elements_text(requested))
    );
$$;

create or replace function public.reporting_online_learning_dashboard(filters jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
set search_path = public
as $$
  with visible as (
    select t.*,
      case when status_ref.workflow_id='IEACHQK7K4BHMLHM' then status_ref.dashboard_classification else null end as confirmed_classification
    from public.reporting_filtered_tasks(filters - 'state') filtered
    join public.wrike_tasks t on t.id=filtered.task_id
    left join public.wrike_workflow_statuses status_ref
      on status_ref.organization_id=t.organization_id and status_ref.wrike_id=t.custom_status_id
    where (t.workflow_id='IEACHQK7K4BHMLHM' or status_ref.workflow_id='IEACHQK7K4BHMLHM')
      and (not (filters ? 'state') or case filters->>'state'
        when 'completed' then status_ref.workflow_id='IEACHQK7K4BHMLHM' and status_ref.dashboard_classification='completed'
        when 'cancelled' then status_ref.workflow_id='IEACHQK7K4BHMLHM' and status_ref.dashboard_classification='stalled_or_canceled'
        when 'open' then status_ref.workflow_id='IEACHQK7K4BHMLHM' and status_ref.dashboard_classification='active'
        when 'overdue' then status_ref.workflow_id='IEACHQK7K4BHMLHM' and status_ref.dashboard_classification='active' and t.completed_at is null and t.due_date<current_date
        else true end)
  )
  select jsonb_build_object(
    'totalProjects',count(*),
    'activeProjects',count(*) filter(where confirmed_classification='active'),
    'completedProjects',count(*) filter(where confirmed_classification='completed'),
    'stalledOrCanceledProjects',count(*) filter(where confirmed_classification='stalled_or_canceled'),
    'unresolvedStatusProjects',count(*) filter(where confirmed_classification is null),
    'plannedMinutes',coalesce(sum(planned_minutes),0),
    'overdueProjects',count(*) filter(where confirmed_classification='active' and completed_at is null and due_date<current_date)
  ) from visible;
$$;

create or replace function public.reporting_online_learning_status_summary(filters jsonb default '{}'::jsonb)
returns table (status_id text,name text,color text,classification text,resolved boolean,tasks bigint)
language sql
stable
set search_path = public
as $$
  select t.custom_status_id,
    coalesce(status_ref.title,t.custom_status_id,t.status),
    status_ref.color,
    case when status_ref.workflow_id='IEACHQK7K4BHMLHM' then status_ref.dashboard_classification else null end,
    status_ref.id is not null and status_ref.workflow_id='IEACHQK7K4BHMLHM',
    count(*)
  from public.reporting_filtered_tasks(filters - 'state') filtered
  join public.wrike_tasks t on t.id=filtered.task_id
  left join public.wrike_workflow_statuses status_ref
    on status_ref.organization_id=t.organization_id and status_ref.wrike_id=t.custom_status_id
  where (t.workflow_id='IEACHQK7K4BHMLHM' or status_ref.workflow_id='IEACHQK7K4BHMLHM')
    and (not (filters ? 'state') or case filters->>'state'
      when 'completed' then status_ref.workflow_id='IEACHQK7K4BHMLHM' and status_ref.dashboard_classification='completed'
      when 'cancelled' then status_ref.workflow_id='IEACHQK7K4BHMLHM' and status_ref.dashboard_classification='stalled_or_canceled'
      when 'open' then status_ref.workflow_id='IEACHQK7K4BHMLHM' and status_ref.dashboard_classification='active'
      when 'overdue' then status_ref.workflow_id='IEACHQK7K4BHMLHM' and status_ref.dashboard_classification='active' and t.completed_at is null and t.due_date<current_date
      else true end)
  group by t.custom_status_id,coalesce(status_ref.title,t.custom_status_id,t.status),status_ref.color,
    case when status_ref.workflow_id='IEACHQK7K4BHMLHM' then status_ref.dashboard_classification else null end,
    status_ref.id,status_ref.workflow_id
  order by count(*) desc,coalesce(status_ref.title,t.custom_status_id,t.status);
$$;

grant execute on function public.reporting_online_learning_dashboard(jsonb) to authenticated;
grant execute on function public.reporting_online_learning_status_summary(jsonb) to authenticated;

comment on table public.wrike_unresolved_references is 'Deduplicated unresolved Wrike IDs and safe administrator diagnostics retained across synchronization runs.';
comment on table public.wrike_manual_mappings is 'Administrator corrections stored separately from authoritative raw Wrike reference data.';
comment on column public.wrike_workflow_statuses.dashboard_classification is 'Editable Online Learning dashboard classification; null values are reported as unresolved.';
