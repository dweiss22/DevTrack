-- Viewer-scoped same-length course benchmarks for the project-detail Overview.
-- Functions remain security invoker except for the existing access resolver.

create or replace function public.wrike_course_length_value_minutes(source_value text)
returns integer
language plpgsql
immutable
set search_path=public
as $$
declare
  normalized text := lower(regexp_replace(trim(source_value), '\s+', ' ', 'g'));
  matched text[];
  result numeric;
begin
  if normalized is null or normalized='' then return null; end if;

  matched := regexp_match(normalized, '^(\d{1,4}):([0-5]\d)(?:\s*(?:hours?|hrs?|h))?$');
  if matched is not null then result := matched[1]::numeric * 60 + matched[2]::numeric;
  else
    matched := regexp_match(normalized, '^(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\s*(?:and\s*)?(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)$');
    if matched is not null then result := matched[1]::numeric * 60 + matched[2]::numeric;
    else
      matched := regexp_match(normalized, '^(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)$');
      if matched is not null then result := matched[1]::numeric * 60;
      else
        matched := regexp_match(normalized, '^(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)$');
        if matched is not null then result := matched[1]::numeric;
        elsif normalized ~ '^\d+\.\d+$' then result := normalized::numeric * 60;
        else return null;
        end if;
      end if;
    end if;
  end if;

  if result <= 0 then return null; end if;
  return round(result)::integer;
exception when others then
  return null;
end;
$$;

create or replace function public.wrike_course_length_minutes(source_values text[])
returns integer
language sql
immutable
set search_path=public
as $$
  with parsed as (
    select public.wrike_course_length_value_minutes(value) as minutes
    from unnest(coalesce(source_values,'{}'::text[])) value
  ), evidence as (
    select count(*) filter (where minutes is null) as invalid_count,
      count(distinct minutes) filter (where minutes is not null) as distinct_count,
      min(minutes) filter (where minutes is not null) as minutes
    from parsed
  )
  select case when invalid_count=0 and distinct_count=1 then minutes else null end from evidence;
$$;

create or replace function public.reporting_project_length_percentile(target_task_id uuid)
returns table (
  length_minutes integer,
  target_minutes bigint,
  cohort_average_minutes numeric,
  cohort_size bigint,
  lower_count bigint,
  tie_count bigint
)
language sql
stable
security invoker
set search_path=public
as $$
  with visible_tasks as materialized (
    select task.id
    from public.reporting_accessible_task_ids() accessible
    join public.wrike_tasks task on task.id=accessible.task_id
    where task.organization_id=public.current_organization_id()
      and not task.is_deleted
      and task.custom_fields_sync_state='complete'
  ), length_values as materialized (
    select visible.id as task_id,array_agg(item.value order by item.value) as source_values
    from visible_tasks visible
    join public.wrike_task_normalized_custom_field_values field_value on field_value.task_id=visible.id
    join public.wrike_normalized_custom_fields field on field.id=field_value.normalized_field_id
      and field.normalized_key in ('course length','course duration','estimated course length')
    cross join lateral unnest(field_value.display_values) item(value)
    group by visible.id
  ), courses as materialized (
    select task_id,public.wrike_course_length_minutes(source_values) as length_minutes
    from length_values
  ), target as materialized (
    select course.task_id,course.length_minutes
    from courses course
    where course.task_id=target_task_id and course.length_minutes is not null
  ), comparable as materialized (
    select course.task_id,course.length_minutes
    from courses course
    join target on target.length_minutes=course.length_minutes
  ), time_by_task as materialized (
    select comparable.task_id,comparable.length_minutes,
      coalesce(sum(entry.minutes) filter (
        where entry.id is not null and not entry.is_deleted and entry.minutes>=0
          and public.can_access_wrike_time_entry(entry.id)
      ),0)::bigint as minutes
    from comparable
    left join public.wrike_time_entries entry on entry.task_id=comparable.task_id
    group by comparable.task_id,comparable.length_minutes
  ), target_time as (
    select * from time_by_task where task_id=target_task_id
  )
  select target_time.length_minutes,target_time.minutes,
    round(avg(time_by_task.minutes)::numeric,2),count(*)::bigint,
    count(*) filter (where time_by_task.minutes<target_time.minutes)::bigint,
    count(*) filter (where time_by_task.minutes=target_time.minutes)::bigint
  from target_time
  join time_by_task on time_by_task.length_minutes=target_time.length_minutes
  group by target_time.length_minutes,target_time.minutes;
$$;

grant execute on function public.wrike_course_length_value_minutes(text) to authenticated,service_role;
grant execute on function public.wrike_course_length_minutes(text[]) to authenticated,service_role;
grant execute on function public.reporting_project_length_percentile(uuid) to authenticated,service_role;

comment on function public.reporting_project_length_percentile(uuid) is
  'Returns viewer-visible same-length course time counts for a midrank percentile; minimum cohort policy is applied by the application.';

select pg_notify('pgrst','reload schema');
