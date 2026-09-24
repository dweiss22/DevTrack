-- Monthly hours time series for the Development Analytics page. Reuses the
-- existing organization-wide task filter (reporting_filtered_tasks) so it
-- honors every filter dimension already supported there (reporting year,
-- status, and normalized custom fields such as Designer, Tool, Course Type,
-- Course Style, Course Length, and Vertical) without duplicating that logic.

create or replace function public.reporting_hours_timeseries(filters jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  with filtered as (
    select task_id from public.reporting_filtered_tasks(filters)
  ), entries as (
    select date_trunc('month', entry.entry_date)::date as period_start, entry.minutes, entry.task_id
    from public.wrike_time_entries entry
    join filtered on filtered.task_id = entry.task_id
    where not entry.is_deleted and entry.minutes > 0
  ), periods as (
    select period_start, sum(minutes)::bigint as minutes, count(distinct task_id)::bigint as project_count
    from entries
    group by period_start
  )
  select jsonb_build_object(
    'totalCourses', (select count(*) from filtered),
    'totalMinutes', (select coalesce(sum(minutes),0) from entries),
    'periods', coalesce((
      select jsonb_agg(jsonb_build_object(
        'periodStart', period_start, 'minutes', minutes, 'projectCount', project_count
      ) order by period_start)
      from periods
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.reporting_hours_timeseries(jsonb) from public;
grant execute on function public.reporting_hours_timeseries(jsonb) to authenticated,service_role;

comment on function public.reporting_hours_timeseries(jsonb) is
  'Monthly recorded-hours buckets for the task set matched by reporting_filtered_tasks(filters); powers the Development Analytics cumulative-hours and comparative-metrics charts.';

select pg_notify('pgrst','reload schema');
