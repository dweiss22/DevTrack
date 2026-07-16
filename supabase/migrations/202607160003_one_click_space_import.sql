-- One-click Wrike Space import configuration and a single task-centric reporting surface.

alter table public.organizations
  add column wrike_import_space_id text;

create or replace view public.wrike_space_report
with (security_invoker = true)
as
select
  t.id as task_id,
  t.organization_id,
  o.wrike_import_space_id as space_wrike_id,
  t.wrike_id as task_wrike_id,
  t.title,
  t.description,
  t.status,
  t.custom_status_id,
  t.task_type,
  t.created_at_wrike,
  t.updated_at_wrike,
  t.start_date,
  t.due_date,
  t.completed_at,
  t.planned_minutes,
  t.allocated_minutes,
  coalesce((
    select sum(e.minutes)
    from public.wrike_time_entries e
    where e.task_id=t.id and not e.is_deleted
  ),0)::bigint as actual_minutes,
  coalesce((
    select jsonb_agg(jsonb_build_object('id',u.id,'wrikeId',u.wrike_id,'name',u.display_name,'email',u.email) order by u.display_name)
    from public.wrike_task_assignees a
    join public.wrike_users u on u.id=a.user_id
    where a.task_id=t.id
  ),'[]'::jsonb) as assignees,
  coalesce((
    select jsonb_agg(jsonb_build_object('wrikeId',l.wrike_location_id,'folder',f.title,'project',p.title) order by coalesce(p.title,f.title,l.wrike_location_id))
    from public.wrike_task_locations l
    left join public.wrike_folders f on f.id=l.folder_id
    left join public.wrike_projects p on p.id=l.project_id
    where l.task_id=t.id
  ),'[]'::jsonb) as locations,
  coalesce((
    select jsonb_object_agg(cf.title,coalesce(cv.text_value,cv.value::text))
    from public.wrike_task_custom_field_values cv
    join public.wrike_custom_fields cf on cf.id=cv.custom_field_id
    where cv.task_id=t.id
  ),'{}'::jsonb) as custom_fields,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',e.id,
      'wrikeId',e.wrike_id,
      'date',e.entry_date,
      'minutes',e.minutes,
      'authorId',e.user_id,
      'author',u.display_name,
      'category',e.category,
      'comment',e.comment
    ) order by e.entry_date desc,e.id)
    from public.wrike_time_entries e
    left join public.wrike_users u on u.id=e.user_id
    where e.task_id=t.id and not e.is_deleted
  ),'[]'::jsonb) as time_entries,
  case when public.is_org_admin_for(t.organization_id) then t.raw_data else null end as admin_raw_data
from public.wrike_tasks t
join public.organizations o on o.id=t.organization_id
where not t.is_deleted
  and o.wrike_import_space_id is not null
  and exists (
    select 1
    from public.wrike_scope_tasks st
    join public.wrike_sync_scopes s on s.id=st.scope_id
    where st.task_id=t.id
      and s.organization_id=t.organization_id
      and s.is_active
      and s.scope_type='space'
      and o.wrike_import_space_id=any(s.source_ids)
  );

grant select on public.wrike_space_report to authenticated;
grant select on public.wrike_space_report to service_role;

comment on view public.wrike_space_report is 'Single task-centric reporting surface for the organization configured by wrike_import_space_id.';

create table public.wrike_space_report_rows (
  task_id uuid primary key references public.wrike_tasks(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  space_wrike_id text not null,
  task_wrike_id text not null,
  title text not null,
  status text not null,
  due_date date,
  planned_minutes integer,
  actual_minutes bigint not null default 0,
  report_data jsonb not null,
  imported_at timestamptz not null default now()
);

create index wrike_space_report_rows_org_idx on public.wrike_space_report_rows(organization_id, status, due_date);
alter table public.wrike_space_report_rows enable row level security;
create policy "administrator space snapshot rows" on public.wrike_space_report_rows for select
  using (public.is_org_admin_for(organization_id));
grant select on public.wrike_space_report_rows to authenticated;
grant all on public.wrike_space_report_rows to service_role;

create or replace function public.refresh_wrike_space_report_rows(target_organization_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare refreshed_count integer;
begin
  delete from public.wrike_space_report_rows where organization_id=target_organization_id;
  insert into public.wrike_space_report_rows(
    task_id,organization_id,space_wrike_id,task_wrike_id,title,status,due_date,planned_minutes,actual_minutes,report_data,imported_at
  )
  select
    report.task_id,
    report.organization_id,
    report.space_wrike_id,
    report.task_wrike_id,
    report.title,
    report.status,
    report.due_date,
    report.planned_minutes,
    report.actual_minutes,
    to_jsonb(report) - 'admin_raw_data',
    now()
  from public.wrike_space_report report
  where report.organization_id=target_organization_id;
  get diagnostics refreshed_count = row_count;
  return refreshed_count;
end;
$$;

revoke all on function public.refresh_wrike_space_report_rows(uuid) from public;
grant execute on function public.refresh_wrike_space_report_rows(uuid) to service_role;

comment on table public.wrike_space_report_rows is 'Administrator-only physical one-row-per-task snapshot refreshed by the one-click Wrike Space import.';
