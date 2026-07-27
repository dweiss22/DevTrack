-- Expose the normalized Course Style field to Projects filters independently
-- of enabled-field configuration, matching the existing Course Type behavior.

create or replace function public.reporting_custom_field_options()
returns table (normalized_field_id uuid,normalized_title text,value text)
language sql stable security definer set search_path=public as $$
  with viewer as materialized (
    select public.current_organization_id() as organization_id
  ), visible_tasks as materialized (
    select task.id
    from viewer
    join public.wrike_tasks task on task.organization_id=viewer.organization_id
    where not task.is_deleted
  ), eligible_fields as materialized (
    select field.id,field.title,field.normalized_key
    from viewer
    join public.wrike_normalized_custom_fields field
      on field.organization_id=viewer.organization_id
    where field.normalized_key in ('course type','course style')
      or exists (
        select 1
        from public.wrike_normalized_custom_field_sources source
        join public.wrike_enabled_custom_fields enabled
          on enabled.custom_field_id=source.custom_field_id
          and enabled.organization_id=viewer.organization_id
        where source.normalized_field_id=field.id
      )
  ), observed_values as materialized (
    select field.id,field.title,field.normalized_key,observed.value
    from eligible_fields field
    join public.wrike_task_normalized_custom_field_values task_value
      on task_value.normalized_field_id=field.id
    join visible_tasks task on task.id=task_value.task_id
    cross join lateral unnest(task_value.display_values) observed(value)
    where trim(observed.value)<>''
    group by field.id,field.title,field.normalized_key,observed.value
  )
  select observed.id,observed.title,observed.value
  from observed_values observed
  union all
  select field.id,field.title,null::text
  from eligible_fields field
  where field.normalized_key in ('course type','course style')
    and not exists(
      select 1 from observed_values observed where observed.id=field.id
    )
  order by 2,3 nulls last;
$$;

revoke all on function public.reporting_custom_field_options() from public;
grant execute on function public.reporting_custom_field_options()
  to authenticated,service_role;

comment on function public.reporting_custom_field_options() is
  'Observed organization-accessible custom-field values; normalized Course Type and Course Style remain eligible independently of enabled-field configuration.';

create or replace function public.reporting_id_dashboard_course_styles(
  target_wrike_user_id uuid default null
)
returns table(task_id uuid,course_style text)
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  viewer public.application_users%rowtype;
  selected_identity public.wrike_users%rowtype;
begin
  select application_user.* into viewer
  from public.application_users application_user
  where application_user.id=public.current_effective_user_id()
    and application_user.account_state='active';

  if viewer.id is null then
    raise exception 'An active DevTrack account is required.' using errcode='42501';
  end if;

  if viewer.role='id' then
    target_wrike_user_id:=public.current_id_operational_identity();
  elsif viewer.role not in ('super_admin','admin') then
    raise exception 'ID Dashboard Course Style access denied.' using errcode='42501';
  end if;

  select identity.* into selected_identity
  from public.wrike_users identity
  where identity.id=target_wrike_user_id
    and identity.organization_id=viewer.organization_id
    and identity.is_active and not identity.is_unresolved
    and identity.identity_verified;

  if selected_identity.id is null then
    raise exception 'The selected ID is not an authorized organization identity.'
      using errcode='42501';
  end if;

  return query
  with assigned_tasks as materialized (
    select distinct assignment.task_id
    from public.course_development_person_assignments_with_personas(
      viewer.organization_id,'id'
    ) assignment
    where assignment.wrike_user_id=selected_identity.id
  )
  select assignment.task_id,style.course_style
  from assigned_tasks assignment
  left join lateral (
    select string_agg(recognized.label,', ' order by recognized.sort_order)
      as course_style
    from (
      select distinct
        case lower(btrim(observed.value))
          when 'full length' then 'Full Length'
          when 'single video' then 'Single Video'
        end label,
        case lower(btrim(observed.value))
          when 'full length' then 1
          when 'single video' then 2
        end sort_order
      from public.wrike_task_normalized_custom_field_values field_value
      join public.wrike_normalized_custom_fields field
        on field.id=field_value.normalized_field_id
        and field.organization_id=viewer.organization_id
      cross join lateral unnest(field_value.display_values) observed(value)
      where field_value.task_id=assignment.task_id
        and field.normalized_key='course style'
        and not field_value.has_conflict
        and lower(btrim(observed.value)) in ('full length','single video')
    ) recognized
  ) style on true;
end;
$$;

revoke all on function public.reporting_id_dashboard_course_styles(uuid) from public;
grant execute on function public.reporting_id_dashboard_course_styles(uuid)
  to authenticated,service_role;

comment on function public.reporting_id_dashboard_course_styles(uuid) is
  'Returns recognized Full Length or Single Video Course Style values for organization-scoped projects assigned to the selected ID.';

select pg_notify('pgrst','reload schema');
