-- Persona-aware, organization-scoped ID Dashboard analytics.
--
-- Development time follows the established portfolio reporting rule: total
-- non-deleted timelog minutes per completed project, averaged across projects.
-- The ID chart uses completed_at's calendar year because it is a calendar-year
-- view rather than the separately maintained Wrike Reporting custom field.
--
-- Category averages use one common denominator per period: distinct projects
-- assigned to the selected ID on which that ID logged qualifying time. Category
-- percentages use the selected ID's total qualifying minutes in that period.

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
  current_year integer:=extract(year from current_date)::integer;
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
    ), completed_projects as materialized (
      select task.id task_id,
        extract(year from task.completed_at)::integer completion_year
      from assigned_tasks assignment
      join public.wrike_tasks task
        on task.id=assignment.task_id
        and task.organization_id=viewer.organization_id
        and not task.is_deleted
      join public.wrike_workflow_statuses status
        on status.organization_id=task.organization_id
        and status.wrike_id=task.custom_status_id
        and not status.is_unresolved
        and status.dashboard_classification='completed'
      where task.completed_at is not null
        and extract(year from task.completed_at)::integer<=current_year
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
      from assigned_tasks assignment
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
          'Distinct ID-assigned projects on which the selected ID logged time in the selected period.',
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
  'Returns organization-scoped, ID-assignment-scoped annual development effort and selected-ID timelog category averages. Calendar project year is completed_at; timelog filter year is entry_date.';
