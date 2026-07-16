-- Reliable Wrike ingestion, scoped reporting, and saved Ask DevTrack history.
-- This migration is additive until reporting_access_enforced is enabled per organization.

create type public.reporting_match_mode as enum ('intersection', 'union');

alter table public.organizations
  add column timezone text not null default 'America/Chicago',
  add column reporting_access_enforced boolean not null default false,
  add column ask_enabled boolean not null default false;

alter table public.wrike_connections
  add column api_host text,
  add column api_base_url text;

alter table public.wrike_sync_runs
  add column sync_mode text not null default 'incremental'
    check (sync_mode in ('incremental', 'full'));

alter table public.wrike_tasks
  add column allocated_minutes integer,
  add column super_task_wrike_ids text[] not null default '{}';

alter table public.wrike_task_custom_field_values
  add column text_value text,
  add column numeric_value numeric,
  add column date_value date,
  add column option_ids text[] not null default '{}';

create table public.wrike_scope_tasks (
  scope_id uuid not null references public.wrike_sync_scopes(id) on delete cascade,
  task_id uuid not null references public.wrike_tasks(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  primary key (scope_id, task_id)
);

create table public.wrike_sync_leases (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  lease_token uuid not null default gen_random_uuid(),
  lease_expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create table public.wrike_workflow_statuses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  wrike_id text not null,
  workflow_id text not null,
  title text not null,
  status_group text,
  raw_data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (organization_id, wrike_id)
);

create table public.wrike_timelog_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  wrike_id text not null,
  title text not null,
  raw_data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (organization_id, wrike_id)
);

create table public.wrike_enabled_custom_fields (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  custom_field_id uuid not null references public.wrike_custom_fields(id) on delete cascade,
  enabled_by uuid references public.application_users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (organization_id, custom_field_id)
);

create table public.reporting_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  match_mode public.reporting_match_mode not null default 'intersection',
  is_active boolean not null default true,
  created_by uuid references public.application_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.reporting_group_members (
  group_id uuid not null references public.reporting_groups(id) on delete cascade,
  application_user_id uuid not null references public.application_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, application_user_id)
);

create table public.reporting_group_scopes (
  group_id uuid not null references public.reporting_groups(id) on delete cascade,
  scope_id uuid not null references public.wrike_sync_scopes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, scope_id)
);

create table public.reporting_group_wrike_users (
  group_id uuid not null references public.reporting_groups(id) on delete cascade,
  wrike_user_id uuid not null references public.wrike_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, wrike_user_id)
);

create table public.reporting_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.application_users(id) on delete cascade,
  title text not null default 'New question',
  last_filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.reporting_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.reporting_conversations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.application_users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 12000),
  parsed_query jsonb not null default '{}'::jsonb,
  result_references jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index wrike_scope_tasks_task_idx on public.wrike_scope_tasks(task_id, scope_id);
create index wrike_task_custom_text_idx on public.wrike_task_custom_field_values(custom_field_id, text_value);
create index wrike_task_custom_number_idx on public.wrike_task_custom_field_values(custom_field_id, numeric_value);
create index wrike_task_custom_date_idx on public.wrike_task_custom_field_values(custom_field_id, date_value);
create index reporting_group_members_user_idx on public.reporting_group_members(application_user_id, group_id);
create index reporting_group_scopes_scope_idx on public.reporting_group_scopes(scope_id, group_id);
create index reporting_group_users_user_idx on public.reporting_group_wrike_users(wrike_user_id, group_id);
create index reporting_conversations_user_idx on public.reporting_conversations(user_id, updated_at desc);
create index reporting_messages_conversation_idx on public.reporting_messages(conversation_id, created_at);
create index reporting_messages_retention_idx on public.reporting_messages(created_at);

create or replace function public.claim_wrike_sync_lease(target_organization_id uuid, target_token uuid, lease_minutes integer default 30)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare claimed uuid;
begin
  insert into public.wrike_sync_leases(organization_id, lease_token, lease_expires_at, updated_at)
  values(target_organization_id, target_token, now() + make_interval(mins => lease_minutes), now())
  on conflict (organization_id) do update
    set lease_token = excluded.lease_token,
        lease_expires_at = excluded.lease_expires_at,
        updated_at = now()
    where public.wrike_sync_leases.lease_expires_at < now()
       or public.wrike_sync_leases.lease_token = target_token
  returning lease_token into claimed;
  return claimed = target_token;
end;
$$;

create or replace function public.release_wrike_sync_lease(target_organization_id uuid, target_token uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.wrike_sync_leases where organization_id = target_organization_id and lease_token = target_token;
$$;

revoke all on function public.claim_wrike_sync_lease(uuid, uuid, integer) from public;
revoke all on function public.release_wrike_sync_lease(uuid, uuid) from public;
grant execute on function public.claim_wrike_sync_lease(uuid, uuid, integer) to service_role;
grant execute on function public.release_wrike_sync_lease(uuid, uuid) to service_role;

create or replace function public.is_org_admin_for(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.application_users
    where id = auth.uid()
      and organization_id = target_organization_id
      and role = 'admin'
  );
$$;

create or replace function public.can_access_wrike_task(target_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select t.id, t.organization_id
    from public.wrike_tasks t
    where t.id = target_task_id
  ), candidate_groups as (
    select g.id, g.match_mode,
      exists(select 1 from public.reporting_group_scopes gs where gs.group_id = g.id) as has_sources,
      exists(select 1 from public.reporting_group_wrike_users gu where gu.group_id = g.id) as has_people,
      exists(
        select 1 from public.reporting_group_scopes gs
        join public.wrike_scope_tasks st on st.scope_id = gs.scope_id
        where gs.group_id = g.id and st.task_id = target_task_id
      ) as source_match,
      exists(
        select 1 from public.reporting_group_wrike_users gu
        where gu.group_id = g.id and (
          exists(select 1 from public.wrike_task_assignees a where a.task_id = target_task_id and a.user_id = gu.wrike_user_id)
          or exists(select 1 from public.wrike_time_entries e where e.task_id = target_task_id and e.user_id = gu.wrike_user_id and not e.is_deleted)
        )
      ) as people_match
    from public.reporting_groups g
    join public.reporting_group_members gm on gm.group_id = g.id and gm.application_user_id = auth.uid()
    join target t on t.organization_id = g.organization_id
    where g.is_active
  )
  select exists (
    select 1 from target t
    join public.organizations o on o.id = t.organization_id
    where public.is_org_admin_for(t.organization_id)
      or (
        public.current_organization_id() = t.organization_id
        and not o.reporting_access_enforced
      )
      or exists (
        select 1 from candidate_groups g
        where (g.has_sources or g.has_people)
          and case
            when g.has_sources and not g.has_people then g.source_match
            when g.has_people and not g.has_sources then g.people_match
            when g.match_mode = 'intersection' then g.source_match and g.people_match
            else g.source_match or g.people_match
          end
      )
  );
$$;

create or replace function public.can_access_wrike_time_entry(target_entry_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select e.id, e.organization_id, e.task_id, e.user_id
    from public.wrike_time_entries e
    where e.id = target_entry_id
  ), candidate_groups as (
    select g.id, g.match_mode,
      exists(select 1 from public.reporting_group_scopes gs where gs.group_id = g.id) as has_sources,
      exists(select 1 from public.reporting_group_wrike_users gu where gu.group_id = g.id) as has_people,
      exists(
        select 1 from public.reporting_group_scopes gs
        join public.wrike_scope_tasks st on st.scope_id = gs.scope_id
        join target t on t.task_id = st.task_id
        where gs.group_id = g.id
      ) as source_match,
      exists(
        select 1 from public.reporting_group_wrike_users gu
        join target t on t.user_id = gu.wrike_user_id
        where gu.group_id = g.id
      ) as people_match
    from public.reporting_groups g
    join public.reporting_group_members gm on gm.group_id = g.id and gm.application_user_id = auth.uid()
    join target t on t.organization_id = g.organization_id
    where g.is_active
  )
  select exists (
    select 1 from target t
    join public.organizations o on o.id = t.organization_id
    where public.is_org_admin_for(t.organization_id)
      or (public.current_organization_id() = t.organization_id and not o.reporting_access_enforced)
      or exists (
        select 1 from candidate_groups g
        where (g.has_sources or g.has_people)
          and case
            when g.has_sources and not g.has_people then g.source_match
            when g.has_people and not g.has_sources then g.people_match
            when g.match_mode = 'intersection' then g.source_match and g.people_match
            else g.source_match or g.people_match
          end
      )
  );
$$;

create or replace function public.can_access_wrike_user(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.wrike_users u
    join public.organizations o on o.id = u.organization_id
    where u.id = target_user_id and (
      public.is_org_admin_for(u.organization_id)
      or (public.current_organization_id() = u.organization_id and not o.reporting_access_enforced)
      or exists (
        select 1 from public.reporting_group_wrike_users gu
        join public.reporting_group_members gm on gm.group_id = gu.group_id
        join public.reporting_groups g on g.id = gu.group_id and g.is_active
        where gu.wrike_user_id = u.id and gm.application_user_id = auth.uid()
      )
      or exists (
        select 1 from public.wrike_task_assignees a
        where a.user_id = u.id and public.can_access_wrike_task(a.task_id)
      )
      or exists (
        select 1 from public.wrike_time_entries e
        where e.user_id = u.id and public.can_access_wrike_time_entry(e.id)
      )
    )
  );
$$;

create or replace function public.is_reporting_group_member(target_group_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.reporting_group_members where group_id=target_group_id and application_user_id=auth.uid());
$$;
create or replace function public.is_reporting_group_admin(target_group_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.reporting_groups g where g.id=target_group_id and public.is_org_admin_for(g.organization_id));
$$;

create or replace function public.can_access_wrike_folder(target_folder_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.wrike_folders f join public.organizations o on o.id=f.organization_id where f.id=target_folder_id and (
    public.is_org_admin_for(f.organization_id)
    or (public.current_organization_id()=f.organization_id and not o.reporting_access_enforced)
    or exists(select 1 from public.wrike_task_locations l where l.folder_id=f.id and public.can_access_wrike_task(l.task_id))
    or exists(select 1 from public.wrike_sync_scopes s join public.reporting_group_scopes gs on gs.scope_id=s.id where s.organization_id=f.organization_id and f.wrike_id=any(s.source_ids) and public.is_reporting_group_member(gs.group_id))
  ));
$$;
create or replace function public.can_access_wrike_project(target_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.wrike_projects p join public.organizations o on o.id=p.organization_id where p.id=target_project_id and (
    public.is_org_admin_for(p.organization_id)
    or (public.current_organization_id()=p.organization_id and not o.reporting_access_enforced)
    or exists(select 1 from public.wrike_task_locations l where l.project_id=p.id and public.can_access_wrike_task(l.task_id))
  ));
$$;
create or replace function public.can_access_wrike_space(target_space_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.wrike_spaces s join public.organizations o on o.id=s.organization_id where s.id=target_space_id and (
    public.is_org_admin_for(s.organization_id)
    or (public.current_organization_id()=s.organization_id and not o.reporting_access_enforced)
    or exists(select 1 from public.wrike_sync_scopes ss join public.reporting_group_scopes gs on gs.scope_id=ss.id where ss.organization_id=s.organization_id and s.wrike_id=any(ss.source_ids) and public.is_reporting_group_member(gs.group_id))
  ));
$$;
create or replace function public.can_access_wrike_custom_field(target_field_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.wrike_custom_fields f join public.organizations o on o.id=f.organization_id where f.id=target_field_id and (
    public.is_org_admin_for(f.organization_id)
    or (public.current_organization_id()=f.organization_id and not o.reporting_access_enforced)
    or exists(select 1 from public.wrike_enabled_custom_fields e where e.custom_field_id=f.id)
  ));
$$;

drop policy if exists "org read wrike_tasks" on public.wrike_tasks;
drop policy if exists "org read wrike_time_entries" on public.wrike_time_entries;
drop policy if exists "org read wrike_users" on public.wrike_users;
drop policy if exists "org read wrike_folders" on public.wrike_folders;
drop policy if exists "org read wrike_projects" on public.wrike_projects;
drop policy if exists "org read wrike_spaces" on public.wrike_spaces;
drop policy if exists "org read wrike_custom_fields" on public.wrike_custom_fields;
drop policy if exists "task assignees read" on public.wrike_task_assignees;
drop policy if exists "task locations read" on public.wrike_task_locations;
drop policy if exists "custom values read" on public.wrike_task_custom_field_values;

create policy "scoped task read" on public.wrike_tasks for select using (public.can_access_wrike_task(id));
create policy "scoped entry read" on public.wrike_time_entries for select using (public.can_access_wrike_time_entry(id));
create policy "scoped wrike user read" on public.wrike_users for select using (public.can_access_wrike_user(id));
create policy "scoped folder read" on public.wrike_folders for select using (public.can_access_wrike_folder(id));
create policy "scoped project read" on public.wrike_projects for select using (public.can_access_wrike_project(id));
create policy "scoped space read" on public.wrike_spaces for select using (public.can_access_wrike_space(id));
create policy "scoped custom field read" on public.wrike_custom_fields for select using (public.can_access_wrike_custom_field(id));
create policy "scoped assignee read" on public.wrike_task_assignees for select using (public.can_access_wrike_task(task_id));
create policy "scoped task location read" on public.wrike_task_locations for select using (public.can_access_wrike_task(task_id));
create policy "scoped custom value read" on public.wrike_task_custom_field_values for select using (public.can_access_wrike_task(task_id));

alter table public.wrike_scope_tasks enable row level security;
alter table public.wrike_sync_leases enable row level security;
alter table public.wrike_workflow_statuses enable row level security;
alter table public.wrike_timelog_categories enable row level security;
alter table public.wrike_enabled_custom_fields enable row level security;
alter table public.reporting_groups enable row level security;
alter table public.reporting_group_members enable row level security;
alter table public.reporting_group_scopes enable row level security;
alter table public.reporting_group_wrike_users enable row level security;
alter table public.reporting_conversations enable row level security;
alter table public.reporting_messages enable row level security;

create policy "scope task read" on public.wrike_scope_tasks for select using (public.can_access_wrike_task(task_id));
create policy "workflow status org read" on public.wrike_workflow_statuses for select using (organization_id = public.current_organization_id());
create policy "timelog category org read" on public.wrike_timelog_categories for select using (organization_id = public.current_organization_id());
create policy "enabled custom fields org read" on public.wrike_enabled_custom_fields for select using (organization_id = public.current_organization_id());
create policy "enabled custom fields admin write" on public.wrike_enabled_custom_fields for all
  using (organization_id = public.current_organization_id() and public.is_org_admin())
  with check (organization_id = public.current_organization_id() and public.is_org_admin());

create policy "reporting groups member read" on public.reporting_groups for select using (
  organization_id = public.current_organization_id()
  and (public.is_org_admin() or public.is_reporting_group_member(id))
);
create policy "reporting groups admin write" on public.reporting_groups for all
  using (organization_id = public.current_organization_id() and public.is_org_admin())
  with check (organization_id = public.current_organization_id() and public.is_org_admin());

create policy "reporting members read" on public.reporting_group_members for select using (
  application_user_id = auth.uid() or public.is_reporting_group_admin(group_id)
);
create policy "reporting members admin write" on public.reporting_group_members for all
  using (public.is_reporting_group_admin(group_id))
  with check (public.is_reporting_group_admin(group_id));

create policy "reporting scopes read" on public.reporting_group_scopes for select using (
  public.is_reporting_group_member(group_id) or public.is_reporting_group_admin(group_id)
);
create policy "reporting scopes admin write" on public.reporting_group_scopes for all
  using (public.is_reporting_group_admin(group_id))
  with check (public.is_reporting_group_admin(group_id));

create policy "reporting wrike users read" on public.reporting_group_wrike_users for select using (
  public.is_reporting_group_member(group_id) or public.is_reporting_group_admin(group_id)
);
create policy "reporting wrike users admin write" on public.reporting_group_wrike_users for all
  using (public.is_reporting_group_admin(group_id))
  with check (public.is_reporting_group_admin(group_id));

create policy "conversation owner or admin read" on public.reporting_conversations for select using (
  user_id = auth.uid() or public.is_org_admin_for(organization_id)
);
create policy "conversation owner insert" on public.reporting_conversations for insert with check (
  user_id = auth.uid() and organization_id = public.current_organization_id()
);
create policy "conversation owner update" on public.reporting_conversations for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "conversation owner or admin delete" on public.reporting_conversations for delete using (
  user_id = auth.uid() or public.is_org_admin_for(organization_id)
);

create policy "message owner or admin read" on public.reporting_messages for select using (
  user_id = auth.uid() or public.is_org_admin_for(organization_id)
);
create policy "message owner insert" on public.reporting_messages for insert with check (
  user_id = auth.uid() and organization_id = public.current_organization_id()
  and exists(select 1 from public.reporting_conversations c where c.id = conversation_id and c.user_id = auth.uid())
);
create policy "message owner or admin delete" on public.reporting_messages for delete using (
  user_id = auth.uid() or public.is_org_admin_for(organization_id)
);

create or replace function public.cleanup_reporting_messages(retention_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare deleted_count integer;
begin
  delete from public.reporting_messages where created_at < now() - make_interval(days => retention_days);
  get diagnostics deleted_count = row_count;
  delete from public.reporting_conversations c
  where not exists(select 1 from public.reporting_messages m where m.conversation_id = c.id)
    and c.updated_at < now() - make_interval(days => retention_days);
  return deleted_count;
end;
$$;

revoke all on function public.cleanup_reporting_messages(integer) from public;
grant execute on function public.cleanup_reporting_messages(integer) to service_role;

create or replace function public.matches_reporting_status(target_organization_id uuid, status_value text, custom_status_value text, requested jsonb)
returns boolean language sql stable security definer set search_path = public as $$
  select requested is null
    or status_value in (select jsonb_array_elements_text(requested))
    or exists(
      select 1 from public.wrike_workflow_statuses s
      where s.organization_id=target_organization_id and s.wrike_id=custom_status_value
        and s.title in (select jsonb_array_elements_text(requested))
    );
$$;

create or replace function public.reporting_filtered_tasks(filters jsonb default '{}'::jsonb)
returns table (task_id uuid, visible_actual_minutes bigint)
language sql
stable
set search_path = public
as $$
  with candidates as (
    select t.id as task_id,
      coalesce((
        select sum(e.minutes)
        from public.wrike_time_entries e
        where e.task_id=t.id and not e.is_deleted and public.can_access_wrike_time_entry(e.id)
          and (not (filters ? 'categoryIds') or e.category in (select jsonb_array_elements_text(filters->'categoryIds')))
          and (coalesce(filters->>'dateField','due') <> 'tracked' or not (filters ? 'from') or e.entry_date >= (filters->>'from')::date)
          and (coalesce(filters->>'dateField','due') <> 'tracked' or not (filters ? 'to') or e.entry_date <= (filters->>'to')::date)
      ),0)::bigint as actual
    from public.wrike_tasks t
    where not t.is_deleted and public.can_access_wrike_task(t.id)
      and (not (filters ? 'taskIds') or t.id::text in (select jsonb_array_elements_text(filters->'taskIds')))
      and (not (filters ? 'q') or t.title ilike '%' || (filters->>'q') || '%' or coalesce(t.description,'') ilike '%' || (filters->>'q') || '%')
      and (not (filters ? 'statuses') or public.matches_reporting_status(t.organization_id,t.status,t.custom_status_id,filters->'statuses'))
      and (not (filters ? 'state') or case filters->>'state'
        when 'completed' then t.completed_at is not null or lower(t.status)='completed'
        when 'cancelled' then lower(t.status)='cancelled'
        when 'open' then t.completed_at is null and lower(t.status) in ('active','deferred')
        when 'overdue' then t.completed_at is null and lower(t.status) in ('active','deferred') and t.due_date < current_date
        else true end)
      and (coalesce(filters->>'dateField','due')='tracked' or not (filters ? 'from') or
        case coalesce(filters->>'dateField','due') when 'start' then t.start_date when 'created' then t.created_at_wrike::date when 'completed' then t.completed_at::date else t.due_date end >= (filters->>'from')::date)
      and (coalesce(filters->>'dateField','due')='tracked' or not (filters ? 'to') or
        case coalesce(filters->>'dateField','due') when 'start' then t.start_date when 'created' then t.created_at_wrike::date when 'completed' then t.completed_at::date else t.due_date end <= (filters->>'to')::date)
      and (not (filters ? 'assigneeIds') or exists(select 1 from public.wrike_task_assignees a where a.task_id=t.id and a.user_id::text in (select jsonb_array_elements_text(filters->'assigneeIds'))))
      and (not (filters ? 'scopeIds') or exists(select 1 from public.wrike_scope_tasks st where st.task_id=t.id and st.scope_id::text in (select jsonb_array_elements_text(filters->'scopeIds'))))
      and (not (filters ? 'folderIds') or exists(select 1 from public.wrike_task_locations l where l.task_id=t.id and l.folder_id::text in (select jsonb_array_elements_text(filters->'folderIds'))))
      and (not (filters ? 'projectIds') or exists(select 1 from public.wrike_task_locations l where l.task_id=t.id and l.project_id::text in (select jsonb_array_elements_text(filters->'projectIds'))))
      and (not (filters ? 'customFields') or not exists (
        select 1 from jsonb_each_text(filters->'customFields') requested
        where not exists (
          select 1 from public.wrike_task_custom_field_values cv
          where cv.task_id=t.id and cv.custom_field_id::text=requested.key
            and coalesce(cv.text_value,cv.numeric_value::text,cv.date_value::text,array_to_string(cv.option_ids,','),'') ilike '%' || requested.value || '%'
        )
      ))
  )
  select c.task_id, c.actual
  from candidates c
  where (coalesce(filters->>'dateField','due') <> 'tracked' or (not (filters ? 'from') and not (filters ? 'to')) or c.actual > 0)
    and (not (filters ? 'categoryIds') or c.actual > 0)
    and (not (filters ? 'timeState') or case filters->>'timeState' when 'with-time' then c.actual > 0 when 'no-time' then c.actual = 0 else true end)
    and (not (filters ? 'minMinutes') or c.actual >= (filters->>'minMinutes')::bigint)
    and (not (filters ? 'maxMinutes') or c.actual <= (filters->>'maxMinutes')::bigint)
    and (not (filters ? 'minPlannedMinutes') or (select coalesce(t.planned_minutes,0) from public.wrike_tasks t where t.id=c.task_id) >= (filters->>'minPlannedMinutes')::integer)
    and (not (filters ? 'maxPlannedMinutes') or (select coalesce(t.planned_minutes,0) from public.wrike_tasks t where t.id=c.task_id) <= (filters->>'maxPlannedMinutes')::integer);
$$;

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
    coalesce((select jsonb_agg(jsonb_build_object('folderId',l.folder_id,'projectId',l.project_id,'wrikeId',l.wrike_location_id)) from public.wrike_task_locations l where l.task_id=f.id), '[]'::jsonb),
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

create or replace function public.reporting_time_rows(
  filters jsonb default '{}'::jsonb,
  result_limit integer default 50,
  result_offset integer default 0
)
returns table (
  entry_id uuid,
  entry_date date,
  minutes integer,
  category text,
  comment text,
  task_id uuid,
  task_title text,
  task_status text,
  user_id uuid,
  user_name text,
  total_count bigint
)
language sql
stable
set search_path = public
as $$
  select e.id, e.entry_date, e.minutes, e.category, e.comment, t.id, t.title, t.status, u.id, u.display_name, count(*) over()
  from public.wrike_time_entries e
  join public.wrike_tasks t on t.id=e.task_id
  left join public.wrike_users u on u.id=e.user_id
  where not e.is_deleted and not t.is_deleted and public.can_access_wrike_time_entry(e.id)
    and (not (filters ? 'taskIds') or t.id::text in (select jsonb_array_elements_text(filters->'taskIds')))
    and (not (filters ? 'q') or t.title ilike '%' || (filters->>'q') || '%' or coalesce(e.comment,'') ilike '%' || (filters->>'q') || '%')
    and (not (filters ? 'from') or case coalesce(filters->>'dateField','tracked') when 'due' then t.due_date when 'start' then t.start_date when 'created' then t.created_at_wrike::date when 'completed' then t.completed_at::date else e.entry_date end >= (filters->>'from')::date)
    and (not (filters ? 'to') or case coalesce(filters->>'dateField','tracked') when 'due' then t.due_date when 'start' then t.start_date when 'created' then t.created_at_wrike::date when 'completed' then t.completed_at::date else e.entry_date end <= (filters->>'to')::date)
    and (not (filters ? 'statuses') or public.matches_reporting_status(t.organization_id,t.status,t.custom_status_id,filters->'statuses'))
    and (not (filters ? 'state') or case filters->>'state'
      when 'completed' then t.completed_at is not null or lower(t.status)='completed'
      when 'cancelled' then lower(t.status)='cancelled'
      when 'open' then t.completed_at is null and lower(t.status) in ('active','deferred')
      when 'overdue' then t.completed_at is null and lower(t.status) in ('active','deferred') and t.due_date < current_date
      else true end)
    and (not (filters ? 'assigneeIds') or e.user_id::text in (select jsonb_array_elements_text(filters->'assigneeIds')))
    and (not (filters ? 'categoryIds') or e.category in (select jsonb_array_elements_text(filters->'categoryIds')))
    and (not (filters ? 'scopeIds') or exists(select 1 from public.wrike_scope_tasks st where st.task_id=t.id and st.scope_id::text in (select jsonb_array_elements_text(filters->'scopeIds'))))
    and (not (filters ? 'folderIds') or exists(select 1 from public.wrike_task_locations l where l.task_id=t.id and l.folder_id::text in (select jsonb_array_elements_text(filters->'folderIds'))))
    and (not (filters ? 'projectIds') or exists(select 1 from public.wrike_task_locations l where l.task_id=t.id and l.project_id::text in (select jsonb_array_elements_text(filters->'projectIds'))))
    and (not (filters ? 'customFields') or not exists (
      select 1 from jsonb_each_text(filters->'customFields') requested where not exists (
        select 1 from public.wrike_task_custom_field_values cv where cv.task_id=t.id and cv.custom_field_id::text=requested.key
          and coalesce(cv.text_value,cv.numeric_value::text,cv.date_value::text,array_to_string(cv.option_ids,','),'') ilike '%' || requested.value || '%'
      )
    ))
    and (not (filters ? 'timeState') or filters->>'timeState' <> 'no-time')
    and (not (filters ? 'minMinutes') or e.minutes >= (filters->>'minMinutes')::integer)
    and (not (filters ? 'maxMinutes') or e.minutes <= (filters->>'maxMinutes')::integer)
    and (not (filters ? 'minPlannedMinutes') or coalesce(t.planned_minutes,0) >= (filters->>'minPlannedMinutes')::integer)
    and (not (filters ? 'maxPlannedMinutes') or coalesce(t.planned_minutes,0) <= (filters->>'maxPlannedMinutes')::integer)
  order by
    case when filters->>'sort'='title' then lower(t.title) end asc,
    case when filters->>'sort'='due' then t.due_date end asc nulls last,
    case when filters->>'sort'='actual' then e.minutes end desc,
    e.entry_date desc, e.id
  limit greatest(1, least(result_limit, 200)) offset greatest(0, result_offset);
$$;

create or replace function public.reporting_time_summary(
  filters jsonb default '{}'::jsonb,
  group_by text default 'total'
)
returns table (group_key text, label text, minutes bigint, entry_count bigint)
language sql
stable
set search_path = public
as $$
  with visible as (
    select e.*, t.title as task_title, t.status as task_status, u.display_name as user_name,
      (select p.title from public.wrike_task_locations l join public.wrike_projects p on p.id=l.project_id where l.task_id=t.id order by p.title limit 1) as project_title,
      (select cv.text_value from public.wrike_task_custom_field_values cv where cv.task_id=t.id and cv.custom_field_id::text=filters->>'groupCustomFieldId' limit 1) as custom_group
    from public.wrike_time_entries e
    join public.wrike_tasks t on t.id=e.task_id
    left join public.wrike_users u on u.id=e.user_id
    where not e.is_deleted and not t.is_deleted and public.can_access_wrike_time_entry(e.id)
      and (not (filters ? 'taskIds') or t.id::text in (select jsonb_array_elements_text(filters->'taskIds')))
      and (not (filters ? 'q') or t.title ilike '%' || (filters->>'q') || '%' or coalesce(e.comment,'') ilike '%' || (filters->>'q') || '%')
      and (not (filters ? 'from') or case coalesce(filters->>'dateField','tracked') when 'due' then t.due_date when 'start' then t.start_date when 'created' then t.created_at_wrike::date when 'completed' then t.completed_at::date else e.entry_date end >= (filters->>'from')::date)
      and (not (filters ? 'to') or case coalesce(filters->>'dateField','tracked') when 'due' then t.due_date when 'start' then t.start_date when 'created' then t.created_at_wrike::date when 'completed' then t.completed_at::date else e.entry_date end <= (filters->>'to')::date)
      and (not (filters ? 'statuses') or public.matches_reporting_status(t.organization_id,t.status,t.custom_status_id,filters->'statuses'))
      and (not (filters ? 'state') or case filters->>'state'
        when 'completed' then t.completed_at is not null or lower(t.status)='completed'
        when 'cancelled' then lower(t.status)='cancelled'
        when 'open' then t.completed_at is null and lower(t.status) in ('active','deferred')
        when 'overdue' then t.completed_at is null and lower(t.status) in ('active','deferred') and t.due_date < current_date
        else true end)
      and (not (filters ? 'assigneeIds') or e.user_id::text in (select jsonb_array_elements_text(filters->'assigneeIds')))
      and (not (filters ? 'categoryIds') or e.category in (select jsonb_array_elements_text(filters->'categoryIds')))
      and (not (filters ? 'scopeIds') or exists(select 1 from public.wrike_scope_tasks st where st.task_id=t.id and st.scope_id::text in (select jsonb_array_elements_text(filters->'scopeIds'))))
      and (not (filters ? 'folderIds') or exists(select 1 from public.wrike_task_locations l where l.task_id=t.id and l.folder_id::text in (select jsonb_array_elements_text(filters->'folderIds'))))
      and (not (filters ? 'projectIds') or exists(select 1 from public.wrike_task_locations l where l.task_id=t.id and l.project_id::text in (select jsonb_array_elements_text(filters->'projectIds'))))
      and (not (filters ? 'customFields') or not exists (
        select 1 from jsonb_each_text(filters->'customFields') requested where not exists (
          select 1 from public.wrike_task_custom_field_values cv where cv.task_id=t.id and cv.custom_field_id::text=requested.key
            and coalesce(cv.text_value,cv.numeric_value::text,cv.date_value::text,array_to_string(cv.option_ids,','),'') ilike '%' || requested.value || '%'
        )
      ))
      and (not (filters ? 'timeState') or filters->>'timeState' <> 'no-time')
      and (not (filters ? 'minMinutes') or e.minutes >= (filters->>'minMinutes')::integer)
      and (not (filters ? 'maxMinutes') or e.minutes <= (filters->>'maxMinutes')::integer)
      and (not (filters ? 'minPlannedMinutes') or coalesce(t.planned_minutes,0) >= (filters->>'minPlannedMinutes')::integer)
      and (not (filters ? 'maxPlannedMinutes') or coalesce(t.planned_minutes,0) <= (filters->>'maxPlannedMinutes')::integer)
  ), grouped as (
    select case group_by
      when 'person' then coalesce(user_id::text,'unknown')
      when 'task' then task_id::text
      when 'status' then task_status
      when 'project' then coalesce(project_title,'No project')
      when 'day' then entry_date::text
      when 'week' then date_trunc('week', entry_date)::date::text
      when 'month' then to_char(entry_date, 'YYYY-MM')
      when 'custom' then coalesce(custom_group,'Not set')
      else 'total' end as key,
      case group_by
      when 'person' then coalesce(user_name,'Unknown')
      when 'task' then task_title
      when 'status' then task_status
      when 'project' then coalesce(project_title,'No project')
      when 'day' then entry_date::text
      when 'week' then date_trunc('week', entry_date)::date::text
      when 'month' then to_char(entry_date, 'YYYY-MM')
      when 'custom' then coalesce(custom_group,'Not set')
      else 'Total' end as display,
      minutes
    from visible
  )
  select key, display, sum(grouped.minutes)::bigint, count(*)::bigint
  from grouped group by key, display order by sum(grouped.minutes) desc, display limit 200;
$$;

create or replace function public.reporting_task_metrics(filters jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
set search_path = public
as $$
  with visible as (
    select t.*, ft.visible_actual_minutes as actual
    from public.reporting_filtered_tasks(filters) ft
    join public.wrike_tasks t on t.id=ft.task_id
  )
  select jsonb_build_object(
    'trackedTasks', count(*),
    'completedTasks', count(*) filter(where completed_at is not null or lower(status)='completed'),
    'cancelledTasks', count(*) filter(where lower(status)='cancelled'),
    'openTasks', count(*) filter(where completed_at is null and lower(status) in ('active','deferred')),
    'overdueTasks', count(*) filter(where completed_at is null and lower(status) in ('active','deferred') and due_date < current_date),
    'totalMinutes', coalesce(sum(actual),0),
    'plannedMinutes', coalesce(sum(planned_minutes),0),
    'noTimeTasks', count(*) filter(where actual=0),
    'overPlanTasks', count(*) filter(where planned_minutes is not null and actual>planned_minutes)
  ) from visible;
$$;

create or replace function public.reporting_task_status_summary(filters jsonb default '{}'::jsonb)
returns table (name text, tasks bigint)
language sql
stable
set search_path = public
as $$
  select t.status, count(*)
  from public.reporting_filtered_tasks(filters) ft
  join public.wrike_tasks t on t.id=ft.task_id
  group by t.status order by count(*) desc, t.status;
$$;
