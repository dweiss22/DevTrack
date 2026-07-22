-- Expose normalized Course Type from observed accessible task values even when
-- its Wrike source is not part of the separately configured enabled-field set.

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
    join public.wrike_normalized_custom_fields field on field.organization_id=viewer.organization_id
    where field.normalized_key='course type'
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
    join public.wrike_task_normalized_custom_field_values task_value on task_value.normalized_field_id=field.id
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
  where field.normalized_key='course type'
    and not exists(select 1 from observed_values observed where observed.id=field.id)
  order by 2,3 nulls last;
$$;

create or replace function public.matches_reporting_normalized_custom_fields(target_task_id uuid,requested jsonb)
returns boolean
language sql stable
set search_path=public
as $$
  select requested is null or not exists (
    select 1
    from jsonb_each(requested) wanted(key,requested_values)
    where not exists (
      select 1
      from public.wrike_task_normalized_custom_field_values field_value
      where field_value.task_id=target_task_id
        and field_value.normalized_field_id::text=wanted.key
        and exists (
          select 1
          from jsonb_array_elements_text(
            case jsonb_typeof(wanted.requested_values)
              when 'array' then wanted.requested_values
              else jsonb_build_array(wanted.requested_values)
            end
          ) selected(value)
          where selected.value=any(field_value.display_values)
        )
    )
  );
$$;

revoke all on function public.reporting_custom_field_options() from public;
revoke all on function public.matches_reporting_normalized_custom_fields(uuid,jsonb) from public;
grant execute on function public.reporting_custom_field_options() to authenticated,service_role;
grant execute on function public.matches_reporting_normalized_custom_fields(uuid,jsonb) to authenticated,service_role;

comment on function public.reporting_custom_field_options() is
  'Observed organization-accessible custom-field values; normalized Course Type remains eligible independently of enabled-field configuration.';
comment on function public.matches_reporting_normalized_custom_fields(uuid,jsonb) is
  'ANDs requested normalized fields while ORing the selected observed values within each field.';

select pg_notify('pgrst','reload schema');
