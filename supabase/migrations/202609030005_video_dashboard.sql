-- Video Dashboard: a videographer's identity is resolved the same way as a
-- Designer's (course_development_person_assignments(org,'id')) since there is
-- no separate "videographer assigned" Wrike field — the Designer Assigned
-- field is the identity. Scope to Course Style = "Single Video" projects only.
-- Modeled on reporting_id_dashboard_identities/_rows/current_id_identity,
-- but self-scoping like reporting_sme_dashboard_identities (no hard
-- admin-only raise) since a videographer should see their own dashboard
-- without needing select_video_dashboard_user.

create or replace function public.reporting_current_video_identity()
returns table(wrike_user_id uuid,display_name text,email text,mapping_status text)
language sql stable security definer set search_path=public as $$
  select identity.id,identity.display_name,identity.email,
    case when member.wrike_user_id is null then 'missing'
         when identity.id is null or not identity.identity_verified then 'ambiguous' else 'mapped' end
  from public.application_users member
  left join public.wrike_users identity on identity.id=member.wrike_user_id
    and identity.organization_id=member.organization_id and identity.is_active and not identity.is_unresolved
  where member.id=auth.uid() and member.role='videographer';
$$;

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
  where viewer.role<>'videographer' or member.id=viewer.id
  union all
  select unresolved.identity_key,null::uuid,null::uuid,unresolved.display_name,unresolved.email,
    'unmapped',unresolved.identity_status,false
  from public.course_development_unresolved_person_options(viewer.organization_id,'id') unresolved
  where viewer.role<>'videographer'
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
  if not found then raise exception using errcode='42501',message='Dashboard is unavailable.'; end if;
  if viewer.role='videographer' then target_wrike_user_id:=viewer.wrike_user_id;
  elsif viewer.role not in ('super_admin','admin') then
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

revoke all on function public.reporting_current_video_identity() from public;
revoke all on function public.reporting_video_dashboard_identities() from public;
revoke all on function public.reporting_video_dashboard_rows(uuid) from public;
grant execute on function public.reporting_current_video_identity(),
  public.reporting_video_dashboard_identities(),public.reporting_video_dashboard_rows(uuid)
  to authenticated,service_role;

select pg_notify('pgrst','reload schema');
