-- ID Dashboard analytics grouped by the course Reporting Year custom field.
-- Development averages use only the selected ID's time and include assigned
-- projects with zero logged minutes. Category periods use the same course
-- Reporting Year rather than the timelog entry's calendar year.

create or replace function public.reporting_id_dashboard_analytics(
  target_wrike_user_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  viewer public.application_users%rowtype;
  selected_identity public.wrike_users%rowtype;
  can_select_identity boolean;
begin
  select application_user.* into viewer
  from public.application_users application_user
  where application_user.id=public.current_effective_user_id()
    and application_user.account_state='active';

  if viewer.id is null then
    raise exception 'An active DevTrack account is required.' using errcode='42501';
  end if;

  can_select_identity:=public.current_has_management_role('admin')
    or public.current_has_management_role('super_admin');
  if public.current_has_operational_role('id') and not can_select_identity then
    target_wrike_user_id:=public.current_operational_identity('id');
  elsif not can_select_identity then
    raise exception 'ID Dashboard analytics access denied.' using errcode='42501';
  end if;

  select identity.* into selected_identity
  from public.wrike_users identity
  where identity.id=target_wrike_user_id
    and identity.organization_id=viewer.organization_id
    and identity.is_active and not identity.is_unresolved
    and identity.identity_verified;

  if selected_identity.id is null or not exists(
    select 1
    from public.course_development_person_assignments_with_personas(
      viewer.organization_id,'id'
    ) assignment
    where assignment.wrike_user_id=selected_identity.id
  ) then
    raise exception 'The selected ID is not an authorized organization identity.'
      using errcode='42501';
  end if;

  return (
    with assigned_tasks as materialized (
      select distinct assignment.task_id
      from public.course_development_person_assignments_with_personas(
        viewer.organization_id,'id'
      ) assignment
      where assignment.wrike_user_id=selected_identity.id
    ), assigned_projects as materialized (
      select task.id task_id,reporting.reporting_year
      from assigned_tasks assignment
      join public.wrike_tasks task
        on task.id=assignment.task_id
        and task.organization_id=viewer.organization_id
        and not task.is_deleted
      left join lateral (
        select value.reporting_year
        from public.wrike_task_normalized_custom_field_values value
        join public.wrike_normalized_custom_fields field
          on field.id=value.normalized_field_id
        where value.task_id=task.id
          and field.normalized_key in ('reporting','reporting year')
          and not value.has_conflict
          and value.reporting_year is not null
        limit 1
      ) reporting on true
    ), development_minutes_by_project as materialized (
      select project.task_id,project.reporting_year,
        coalesce(sum(entry.minutes) filter(
          where entry.id is not null and not entry.is_deleted and entry.minutes>=0
        ),0)::bigint total_minutes
      from assigned_projects project
      left join public.wrike_time_entries entry
        on entry.task_id=project.task_id
        and entry.organization_id=viewer.organization_id
        and (
          entry.user_id=selected_identity.id
          or (
            entry.user_id is null
            and lower(coalesce(entry.user_wrike_id,''))=
              lower(selected_identity.wrike_id)
          )
        )
      where project.reporting_year is not null
      group by project.task_id,project.reporting_year
    ), development_by_year as (
      select project.reporting_year,
        count(distinct project.task_id)::bigint project_count,
        round(
          sum(project.total_minutes)::numeric/
            nullif(count(distinct project.task_id),0),
          2
        ) average_minutes,
        sum(project.total_minutes)::bigint total_minutes
      from development_minutes_by_project project
      group by project.reporting_year
    ), selected_entries as materialized (
      select entry.task_id,project.reporting_year,entry.minutes,
        case
          when entry.category is null or btrim(entry.category)=''
            or category.id is null or category.is_unresolved
            then 'Uncategorized'
          else category.title
        end category_name
      from assigned_projects project
      join public.wrike_time_entries entry
        on entry.task_id=project.task_id
        and entry.organization_id=viewer.organization_id
        and not entry.is_deleted
        and entry.minutes>0
        and (
          entry.user_id=selected_identity.id
          or (
            entry.user_id is null
            and lower(coalesce(entry.user_wrike_id,''))=
              lower(selected_identity.wrike_id)
          )
        )
      left join public.wrike_timelog_categories category
        on category.organization_id=entry.organization_id
        and category.wrike_id=entry.category
    ), expanded_entries as materialized (
      select 'all'::text period_key,null::integer reporting_year,
        entry.task_id,entry.minutes,entry.category_name
      from selected_entries entry
      union all
      select entry.reporting_year::text,entry.reporting_year,
        entry.task_id,entry.minutes,entry.category_name
      from selected_entries entry
      where entry.reporting_year is not null
    ), period_summary as materialized (
      select entry.period_key,entry.reporting_year,
        count(distinct entry.task_id)::bigint qualifying_project_count,
        sum(entry.minutes)::bigint total_minutes,
        count(*)::bigint entry_count
      from expanded_entries entry
      group by entry.period_key,entry.reporting_year
    ), category_summary as materialized (
      select entry.period_key,entry.reporting_year,entry.category_name,
        sum(entry.minutes)::bigint total_minutes
      from expanded_entries entry
      group by entry.period_key,entry.reporting_year,entry.category_name
      having sum(entry.minutes)>0
    ), category_periods as (
      select period.period_key,period.reporting_year,
        jsonb_build_object(
          'year',period.reporting_year,
          'qualifyingProjectCount',period.qualifying_project_count,
          'totalMinutes',period.total_minutes,
          'entryCount',period.entry_count,
          'categories',coalesce((
            select jsonb_agg(jsonb_build_object(
              'name',category.category_name,
              'averageMinutes',round(
                category.total_minutes::numeric/
                  nullif(period.qualifying_project_count,0),2
              ),
              'totalMinutes',category.total_minutes,
              'percentage',round(
                category.total_minutes::numeric*100/
                  nullif(period.total_minutes,0),2
              )
            ) order by category.total_minutes desc,category.category_name)
            from category_summary category
            where category.period_key=period.period_key
              and category.total_minutes>0
          ),'[]'::jsonb)
        ) value
      from period_summary period
    ), sync_state as (
      select exists(
        select 1
        from public.wrike_folder_task_import_runs run
        where run.organization_id=viewer.organization_id
          and run.status='succeeded'
      ) synchronized
    )
    select jsonb_build_object(
      'timeDataSynchronized',(select synchronized from sync_state),
      'developmentTimeByYear',coalesce((
        select jsonb_agg(jsonb_build_object(
          'year',development.reporting_year,
          'projectCount',development.project_count,
          'averageMinutes',development.average_minutes,
          'totalMinutes',development.total_minutes
        ) order by development.reporting_year)
        from development_by_year development
      ),'[]'::jsonb),
      'categoryTime',jsonb_build_object(
        'denominatorDefinition',
          'Distinct ID-assigned projects on which the selected ID logged time, grouped by course reporting year.',
        'allTime',coalesce((
          select period.value from category_periods period
          where period.period_key='all'
        ),jsonb_build_object(
          'year',null,'qualifyingProjectCount',0,'totalMinutes',0,
          'entryCount',0,'categories','[]'::jsonb
        )),
        'years',coalesce((
          select jsonb_agg(period.value order by period.reporting_year)
          from category_periods period
          where period.reporting_year is not null
        ),'[]'::jsonb)
      )
    )
  );
end;
$$;

revoke all on function public.reporting_id_dashboard_analytics(uuid) from public;
grant execute on function public.reporting_id_dashboard_analytics(uuid)
  to authenticated,service_role;

comment on function public.reporting_id_dashboard_analytics(uuid) is
  'Returns selected-ID development averages and category totals grouped by the course Reporting Year custom field. Assigned reporting-year projects with zero selected-ID minutes remain in the development average.';
