-- Any videographer may view any other videographer's Video Dashboard (they
-- all now hold select_video_dashboard_user), so treat 'videographer' like
-- 'admin'/'super_admin' for identity listing and row selection instead of
-- self-scoping it. Also add a "contributor" rows RPC: Single Video projects
-- where the videographer logged time but is not the Designer Assigned,
-- shown as a separate section from their own (owned) projects.

create or replace function public.reporting_video_dashboard_identities()
returns table(identity_key text,wrike_user_id uuid,application_user_id uuid,display_name text,email text,
  mapping_status text,identity_status text,selectable boolean)
language plpgsql stable security definer set search_path=public as $$
declare viewer public.application_users%rowtype;
begin
  select * into viewer from public.application_users where id=auth.uid();
  if not found or viewer.role not in ('super_admin','admin','videographer') then
    raise exception using errcode='42501',message='Dashboard is unavailable.';
  end if;
  return query
  with assigned as (
    select distinct assignment.wrike_user_id
    from public.course_development_person_assignments(viewer.organization_id,'id') assignment
  )
  select 'wrike:'||identity.id::text,identity.id,member.id,identity.display_name,identity.email,
    case when member.id is null then 'unmapped' else 'mapped' end,'verified',true
  from assigned
  join public.wrike_users identity on identity.id=assigned.wrike_user_id
  left join public.application_users member on member.organization_id=viewer.organization_id
    and member.role='videographer' and member.wrike_user_id=identity.id
  union all
  select unresolved.identity_key,null::uuid,null::uuid,unresolved.display_name,unresolved.email,
    'unmapped',unresolved.identity_status,false
  from public.course_development_unresolved_person_options(viewer.organization_id,'id') unresolved
  order by 4;
end;
$$;

create or replace function public.reporting_video_dashboard_rows(target_wrike_user_id uuid default null)
returns table(task_id uuid,title text,status_name text,status_classification text,
  original_due_date date,due_date date,completed_at timestamptz,folder_context text,
  updated_at_wrike timestamptz,course_style text,runtime text)
language plpgsql stable security definer set search_path=public as $$
declare viewer public.application_users%rowtype;
begin
  select * into viewer from public.application_users where id=auth.uid();
  if not found or viewer.role not in ('super_admin','admin','videographer') then
    raise exception using errcode='42501',message='Dashboard is unavailable.';
  end if;
  if target_wrike_user_id is null or not exists(
    select 1 from public.course_development_person_assignments(viewer.organization_id,'id') assignment
    where assignment.wrike_user_id=target_wrike_user_id
  ) then return; end if;
  return query
  select task.id,task.title,coalesce(status.title,task.status),coalesce(status.dashboard_classification,'unclassified'),
    task.original_due_date,task.due_date,task.completed_at,
    coalesce((select string_agg(distinct folder.title,', ' order by folder.title)
      from public.wrike_task_locations location join public.wrike_folders folder on folder.id=location.folder_id
      where location.task_id=task.id),'—'),task.updated_at_wrike,
    style.course_style,runtime.runtime
  from public.course_development_person_assignments(viewer.organization_id,'id') assignment
  join public.wrike_tasks task on task.id=assignment.task_id
  left join public.wrike_workflow_statuses status on status.organization_id=task.organization_id
    and status.wrike_id=task.custom_status_id
  left join lateral (
    select observed.value course_style
    from public.wrike_task_normalized_custom_field_values value
    join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
      and field.organization_id=viewer.organization_id and field.normalized_key='course style'
    cross join lateral unnest(value.display_values) observed(value)
    where value.task_id=task.id and not value.has_conflict and lower(btrim(observed.value))='single video'
    limit 1
  ) style on true
  left join lateral (
    select value.display_values[1] runtime
    from public.wrike_task_normalized_custom_field_values value
    join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
      and field.organization_id=viewer.organization_id and field.normalized_key='runtime'
    where value.task_id=task.id and not value.has_conflict and cardinality(value.display_values)>0
    limit 1
  ) runtime on true
  where assignment.wrike_user_id=target_wrike_user_id and style.course_style is not null
  order by task.completed_at nulls first,task.due_date nulls last,task.title;
end;
$$;

create or replace function public.reporting_video_dashboard_contributor_rows(target_wrike_user_id uuid default null)
returns table(task_id uuid,title text,status_name text,status_classification text,
  original_due_date date,due_date date,completed_at timestamptz,folder_context text,
  updated_at_wrike timestamptz,course_style text,runtime text,contributed_minutes bigint)
language plpgsql stable security definer set search_path=public as $$
declare viewer public.application_users%rowtype;
begin
  select * into viewer from public.application_users where id=auth.uid();
  if not found or viewer.role not in ('super_admin','admin','videographer') then
    raise exception using errcode='42501',message='Dashboard is unavailable.';
  end if;
  if target_wrike_user_id is null then return; end if;
  return query
  with owned as (
    select distinct assignment.task_id
    from public.course_development_person_assignments(viewer.organization_id,'id') assignment
    where assignment.wrike_user_id=target_wrike_user_id
  ), contributed as (
    select entry.task_id,sum(entry.minutes) minutes
    from public.wrike_time_entries entry
    where entry.organization_id=viewer.organization_id and not entry.is_deleted
      and entry.user_id=target_wrike_user_id
      and entry.task_id not in (select task_id from owned)
    group by entry.task_id
  )
  select task.id,task.title,coalesce(status.title,task.status),coalesce(status.dashboard_classification,'unclassified'),
    task.original_due_date,task.due_date,task.completed_at,
    coalesce((select string_agg(distinct folder.title,', ' order by folder.title)
      from public.wrike_task_locations location join public.wrike_folders folder on folder.id=location.folder_id
      where location.task_id=task.id),'—'),task.updated_at_wrike,
    style.course_style,runtime.runtime,contributed.minutes
  from contributed
  join public.wrike_tasks task on task.id=contributed.task_id and task.organization_id=viewer.organization_id
  left join public.wrike_workflow_statuses status on status.organization_id=task.organization_id
    and status.wrike_id=task.custom_status_id
  left join lateral (
    select observed.value course_style
    from public.wrike_task_normalized_custom_field_values value
    join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
      and field.organization_id=viewer.organization_id and field.normalized_key='course style'
    cross join lateral unnest(value.display_values) observed(value)
    where value.task_id=task.id and not value.has_conflict and lower(btrim(observed.value))='single video'
    limit 1
  ) style on true
  left join lateral (
    select value.display_values[1] runtime
    from public.wrike_task_normalized_custom_field_values value
    join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
      and field.organization_id=viewer.organization_id and field.normalized_key='runtime'
    where value.task_id=task.id and not value.has_conflict and cardinality(value.display_values)>0
    limit 1
  ) runtime on true
  where style.course_style is not null
  order by task.completed_at nulls first,task.due_date nulls last,task.title;
end;
$$;

revoke all on function public.reporting_video_dashboard_contributor_rows(uuid) from public;
grant execute on function public.reporting_video_dashboard_contributor_rows(uuid) to authenticated,service_role;

select pg_notify('pgrst','reload schema');
