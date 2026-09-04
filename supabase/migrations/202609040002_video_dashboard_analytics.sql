-- Videographer Dashboard analytics, modeled on reporting_id_dashboard_
-- analytics: average development time per completed Single Video project by
-- calendar year, plus a time-by-workflow-category breakdown. Scoped to
-- course_development_video_person_assignments (Online Learning +
-- Microtraining Development) so Roll Call Training work is included
-- alongside Online Learning single-video projects, per the combined-section
-- decision for this dashboard.
--
-- Microtraining Development statuses are expected to synchronize with a
-- "Completed" Wrike status group (automaticStatusClassification already
-- classifies any workflow's statuses that way), but "Ready for Publication"
-- (IEACHQK7JMGZVZAK) and "Closed-Released" (IEACHQK7JMGH6TV5) are also
-- checked explicitly as a fallback in case that workflow's statuses are ever
-- returned with a different group.

create or replace function public.reporting_video_dashboard_analytics(
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
  current_year integer:=extract(year from current_date)::integer;
begin
  select application_user.* into viewer
  from public.application_users application_user
  where application_user.id=auth.uid();

  if viewer.id is null then
    raise exception 'An active DevTrack account is required.' using errcode='42501';
  end if;

  if viewer.role='videographer' then
    target_wrike_user_id:=viewer.wrike_user_id;
  elsif viewer.role not in ('super_admin','admin') then
    raise exception 'Video Dashboard analytics access denied.' using errcode='42501';
  end if;

  select identity.* into selected_identity
  from public.wrike_users identity
  where identity.id=target_wrike_user_id
    and identity.organization_id=viewer.organization_id
    and identity.is_active and not identity.is_unresolved
    and identity.identity_verified;

  if selected_identity.id is null or not exists(
    select 1
    from public.course_development_video_person_assignments(viewer.organization_id) assignment
    where assignment.wrike_user_id=selected_identity.id
  ) then
    raise exception 'The selected videographer is not an authorized organization identity.'
      using errcode='42501';
  end if;

  return (
    with assigned_tasks as materialized (
      select distinct assignment.task_id
      from public.course_development_video_person_assignments(viewer.organization_id) assignment
      where assignment.wrike_user_id=selected_identity.id
    ), single_video_tasks as materialized (
      select assignment.task_id
      from assigned_tasks assignment
      where exists(
        select 1
        from public.wrike_task_normalized_custom_field_values value
        join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
          and field.organization_id=viewer.organization_id and field.normalized_key='course style'
        cross join lateral unnest(value.display_values) observed(value)
        where value.task_id=assignment.task_id and not value.has_conflict
          and lower(btrim(observed.value))='single video'
      )
    ), completed_projects as materialized (
      select task.id task_id,
        extract(year from task.completed_at)::integer completion_year
      from single_video_tasks assignment
      join public.wrike_tasks task
        on task.id=assignment.task_id
        and task.organization_id=viewer.organization_id
        and not task.is_deleted
      left join public.wrike_workflow_statuses status
        on status.organization_id=task.organization_id
        and status.wrike_id=task.custom_status_id
      where task.completed_at is not null
        and extract(year from task.completed_at)::integer<=current_year
        and (
          (status.wrike_id is not null and not status.is_unresolved and status.dashboard_classification='completed')
          or task.custom_status_id in ('IEACHQK7JMGZVZAK','IEACHQK7JMGH6TV5')
        )
    ), first_assignment_year as (
      select min(completion_year) first_year from completed_projects
    ), calendar_years as (
      select generated.year::integer
      from first_assignment_year first_year
      cross join lateral generate_series(
        first_year.first_year,current_year
      ) generated(year)
      where first_year.first_year is not null
    ), development_minutes_by_project as materialized (
      select project.task_id,project.completion_year,
        coalesce(sum(entry.minutes) filter(
          where entry.id is not null and not entry.is_deleted
        ),0)::bigint total_minutes
      from completed_projects project
      left join public.wrike_time_entries entry
        on entry.task_id=project.task_id
        and entry.organization_id=viewer.organization_id
      group by project.task_id,project.completion_year
    ), development_by_year as (
      select year.year,
        count(project.task_id)::bigint project_count,
        case when count(project.task_id)=0 then null
          else round(avg(project.total_minutes)::numeric,2) end average_minutes,
        case when count(project.task_id)=0 then null
          else sum(project.total_minutes)::bigint end total_minutes
      from calendar_years year
      left join development_minutes_by_project project
        on project.completion_year=year.year
      group by year.year
    ), selected_entries as materialized (
      select entry.task_id,entry.entry_date,entry.minutes,
        case
          when entry.category is null or btrim(entry.category)=''
            or category.id is null or category.is_unresolved
            then 'Uncategorized'
          else category.title
        end category_name
      from single_video_tasks assignment
      join public.wrike_time_entries entry
        on entry.task_id=assignment.task_id
        and entry.organization_id=viewer.organization_id
        and not entry.is_deleted
        and entry.minutes>=0
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
      select extract(year from entry.entry_date)::integer::text,
        extract(year from entry.entry_date)::integer,
        entry.task_id,entry.minutes,entry.category_name
      from selected_entries entry
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
          'year',year.year,
          'projectCount',year.project_count,
          'averageMinutes',year.average_minutes,
          'totalMinutes',year.total_minutes
        ) order by year.year)
        from development_by_year year
      ),'[]'::jsonb),
      'categoryTime',jsonb_build_object(
        'denominatorDefinition',
          'Distinct Single Video projects assigned to the selected videographer on which they logged time in the selected period.',
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

revoke all on function public.reporting_video_dashboard_analytics(uuid) from public;
grant execute on function public.reporting_video_dashboard_analytics(uuid)
  to authenticated,service_role;

comment on function public.reporting_video_dashboard_analytics(uuid) is
  'Returns organization-scoped, video-assignment-scoped annual development effort and selected-videographer timelog category averages across Single Video projects (Online Learning and Microtraining Development workflows).';

select pg_notify('pgrst','reload schema');
