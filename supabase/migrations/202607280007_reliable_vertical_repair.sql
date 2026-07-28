-- Make database Vertical normalization agree with the application parser,
-- backfill stale rows, and expose organization-scoped repair diagnostics.

alter table public.wrike_tasks
  add column if not exists vertical_repaired_at timestamptz;

alter table public.wrike_vertical_repair_runs
  add column if not exists unresolved_count integer not null default 0,
  add column if not exists conflicting_count integer not null default 0,
  add column if not exists failed_count integer not null default 0;

create or replace function public.parse_wrike_vertical_tokens(source_values text[])
returns setof text
language plpgsql
immutable
set search_path=public
as $$
declare
  source_value text;
  decoded text;
  candidate text;
  parsed jsonb;
begin
  foreach source_value in array coalesce(source_values,'{}'::text[]) loop
    decoded := btrim(replace(replace(source_value,chr(92)||'"','"'),chr(92)||'''',''''));
    if decoded='' then continue; end if;
    if left(decoded,1)='[' and right(decoded,1)=']' then
      begin
        parsed := decoded::jsonb;
        if jsonb_typeof(parsed)='array' then
          for candidate in select jsonb_array_elements_text(parsed) loop
            candidate := btrim(regexp_replace(candidate,'^[^[:alnum:]]+|[^[:alnum:]]+$','','g'));
            if candidate<>'' then return next regexp_replace(candidate,'[[:space:]]+',' ','g'); end if;
          end loop;
          continue;
        end if;
      exception when others then
        -- Preserve malformed input for an actionable unrecognized diagnostic.
      end;
    end if;
    foreach candidate in array regexp_split_to_array(decoded,'[,;|]') loop
      candidate := btrim(regexp_replace(candidate,'^[^[:alnum:]]+|[^[:alnum:]]+$','','g'));
      if candidate<>'' then return next regexp_replace(candidate,'[[:space:]]+',' ','g'); end if;
    end loop;
  end loop;
end;
$$;

create or replace function public.normalize_wrike_vertical_values(source_values text[])
returns table (
  normalized_verticals text[],
  vertical_reporting_category text,
  has_unresolved_vertical boolean,
  unresolved_vertical_tokens text[]
)
language sql
stable
set search_path=public
as $$
  with tokens as (
    select token,
      upper(regexp_replace(token,'[^[:alnum:]]+','','g')) as alias_key
    from public.parse_wrike_vertical_tokens(source_values) token
  ), aliases as (
    select alias.*,
      upper(regexp_replace(alias.alias_key,'[^[:alnum:]]+','','g')) as normalized_alias_key
    from public.wrike_vertical_aliases alias
  ), matched as (
    select tokens.token,tokens.alias_key,alias.approved_value,alias.sort_order,alias.is_cross_vertical
    from tokens left join aliases alias on alias.normalized_alias_key=tokens.alias_key
  ), cross_state as (
    select coalesce(bool_or(is_cross_vertical),false) as semantic_cross from matched
  ), approved as (
    select matched.approved_value,min(matched.sort_order) as sort_order
    from matched where matched.approved_value is not null group by matched.approved_value
  ), rejected as (
    select min(token) as token,lower(token) as token_key
    from matched where approved_value is null and not coalesce(is_cross_vertical,false) group by lower(token)
  ), result as (
    select case when cross_state.semantic_cross then array['P1A','C1A','D1A','FR1A','EMS1','LGU','Lexipol','Wellness']::text[]
      else coalesce((select array_agg(approved_value order by sort_order) from approved),'{}'::text[]) end as values,
      coalesce((select array_agg(token order by token_key) from rejected),'{}'::text[]) as rejected,
      cross_state.semantic_cross
    from cross_state
  )
  select values,
    case when semantic_cross or cardinality(values)>1 then 'Cross Vertical'
      when cardinality(values)=1 then values[1]
      else 'Unresolved Vertical' end,
    cardinality(values)=0 or cardinality(rejected)>0,
    rejected
  from result;
$$;

create or replace function public.enforce_wrike_vertical_normalization()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  field_key text;
  result record;
  vertical_inputs text[];
begin
  select normalized_key into field_key from public.wrike_normalized_custom_fields where id=new.normalized_field_id;
  if field_key='vertical' then
    select array_agg(candidate.value) into vertical_inputs
    from jsonb_array_elements(coalesce(new.source_values,'[]'::jsonb)) source(item)
    cross join lateral (
      select array_item.value
      from jsonb_array_elements_text(case when jsonb_typeof(source.item->'displayValue')='array' then source.item->'displayValue' else '[]'::jsonb end) array_item(value)
      union all
      select source.item->>'displayValue'
      where jsonb_typeof(source.item->'displayValue') in ('string','number','boolean')
    ) candidate
    where candidate.value is not null;
    select * into result from public.normalize_wrike_vertical_values(
      case when coalesce(cardinality(vertical_inputs),0)>0 then vertical_inputs else new.display_values end
    );
    if coalesce(new.has_conflict,false) then
      new.normalized_verticals := '{}'::text[];
      new.vertical_reporting_category := 'Unresolved Vertical';
      new.has_unresolved_vertical := true;
      new.unresolved_vertical_tokens := case when cardinality(result.unresolved_vertical_tokens)>0
        then result.unresolved_vertical_tokens else array['Conflicting Vertical sources']::text[] end;
      new.display_values := '{}'::text[];
    else
      new.normalized_verticals := result.normalized_verticals;
      new.vertical_reporting_category := result.vertical_reporting_category;
      new.has_unresolved_vertical := result.has_unresolved_vertical;
      new.unresolved_vertical_tokens := result.unresolved_vertical_tokens;
      new.display_values := result.normalized_verticals;
    end if;
  else
    new.normalized_verticals := null;
    new.vertical_reporting_category := null;
    new.has_unresolved_vertical := null;
    new.unresolved_vertical_tokens := null;
  end if;
  return new;
end;
$$;

create temporary table vertical_repair_migration_before on commit drop as
select task.organization_id,task.id as task_id,task.vertical_state,
  coalesce(value.normalized_verticals,'{}'::text[]) as normalized_verticals,
  coalesce(value.unresolved_vertical_tokens,'{}'::text[]) as unresolved_vertical_tokens,
  coalesce(value.has_conflict,false) as has_conflict
from public.wrike_tasks task
left join public.wrike_normalized_custom_fields field
  on field.organization_id=task.organization_id and field.normalized_key='vertical'
left join public.wrike_task_normalized_custom_field_values value
  on value.task_id=task.id and value.normalized_field_id=field.id
where not task.is_deleted;

-- Re-fire the corrected trigger without modifying authoritative Wrike source data.
update public.wrike_task_normalized_custom_field_values value
set source_values=value.source_values
from public.wrike_normalized_custom_fields field
where field.id=value.normalized_field_id and field.normalized_key='vertical';

with quality as (
  select task.id,
    case
      when task.custom_fields_sync_state<>'complete' then 'synchronization_incomplete'
      when coalesce(vertical.has_conflict,false) then 'unrecognized'
      when coalesce(cardinality(vertical.unresolved_vertical_tokens),0)>0 then 'unrecognized'
      when vertical.vertical_reporting_category='Cross Vertical' then 'cross_vertical'
      when coalesce(cardinality(vertical.normalized_verticals),0)>0 then 'resolved'
      else 'missing'
    end as state
  from public.wrike_tasks task
  left join public.wrike_normalized_custom_fields field
    on field.organization_id=task.organization_id and field.normalized_key='vertical'
  left join public.wrike_task_normalized_custom_field_values vertical
    on vertical.task_id=task.id and vertical.normalized_field_id=field.id
  where not task.is_deleted
)
update public.wrike_tasks task
set vertical_state=quality.state,
  vertical_repaired_at=now()
from quality where quality.id=task.id;

insert into public.wrike_vertical_repair_runs(
  organization_id,status,examined_count,repaired_count,unchanged_count,
  unresolved_count,conflicting_count,failed_count,diagnostics,started_at,completed_at
)
select before.organization_id,'succeeded',
  count(*)::integer,
  count(*) filter(where before.vertical_state is distinct from task.vertical_state
    or before.normalized_verticals is distinct from coalesce(value.normalized_verticals,'{}'::text[])
    or before.unresolved_vertical_tokens is distinct from coalesce(value.unresolved_vertical_tokens,'{}'::text[]))::integer,
  count(*) filter(where before.vertical_state is not distinct from task.vertical_state
    and before.normalized_verticals is not distinct from coalesce(value.normalized_verticals,'{}'::text[])
    and before.unresolved_vertical_tokens is not distinct from coalesce(value.unresolved_vertical_tokens,'{}'::text[]))::integer,
  count(*) filter(where task.vertical_state in ('missing','unrecognized','synchronization_incomplete'))::integer,
  count(*) filter(where coalesce(value.has_conflict,false))::integer,
  0,
  jsonb_build_object('repairMode','migration_backfill','parserVersion',2,'readBackVerified',true),
  now(),now()
from vertical_repair_migration_before before
join public.wrike_tasks task on task.id=before.task_id
left join public.wrike_normalized_custom_fields field
  on field.organization_id=before.organization_id and field.normalized_key='vertical'
left join public.wrike_task_normalized_custom_field_values value
  on value.task_id=before.task_id and value.normalized_field_id=field.id
group by before.organization_id;

create or replace function public.reporting_vertical_repair_diagnostics(result_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  viewer_organization_id uuid;
  result jsonb;
begin
  select viewer.organization_id into viewer_organization_id
  from public.application_users viewer
  where viewer.id=auth.uid() and public.current_has_capability('manage_data');
  if viewer_organization_id is null then
    raise exception 'Administrator access is required' using errcode='42501';
  end if;

  with vertical_field as (
    select field.id from public.wrike_normalized_custom_fields field
    where field.organization_id=viewer_organization_id and field.normalized_key='vertical'
  ), rows as (
    select task.id,task.title,task.wrike_id,task.vertical_state,task.custom_fields_sync_state,
      task.custom_fields_verified_at,task.vertical_repaired_at,
      value.source_wrike_field_ids,value.source_titles,value.source_values,value.has_conflict,
      coalesce(value.normalized_verticals,'{}'::text[]) as normalized_verticals,
      coalesce(value.unresolved_vertical_tokens,'{}'::text[]) as unresolved_tokens,
      coalesce((select array_agg(parsed.token) from public.parse_wrike_vertical_tokens(
        coalesce((select array_agg(candidate.display_value)
          from jsonb_array_elements(coalesce(value.source_values,'[]'::jsonb)) item
          cross join lateral (
            select array_item.value as display_value
            from jsonb_array_elements_text(case when jsonb_typeof(item->'displayValue')='array' then item->'displayValue' else '[]'::jsonb end) array_item(value)
            union all
            select item->>'displayValue'
            where jsonb_typeof(item->'displayValue') in ('string','number','boolean')
          ) candidate),'{}'::text[])
      ) parsed(token)),'{}'::text[]) as parsed_values
    from public.wrike_tasks task
    left join vertical_field field on true
    left join public.wrike_task_normalized_custom_field_values value
      on value.task_id=task.id and value.normalized_field_id=field.id
    where task.organization_id=viewer_organization_id and not task.is_deleted
  ), diagnosed as (
    select rows.*,
      case
        when custom_fields_sync_state<>'complete' then 'not_synchronized'
        when source_wrike_field_ids is null then 'source_field_missing'
        when coalesce(cardinality(parsed_values),0)=0 then 'blank'
        when coalesce(has_conflict,false) then 'conflicted'
        when coalesce(cardinality(unresolved_tokens),0)>0 then 'unrecognized'
        when coalesce(cardinality(normalized_verticals),0)=0 then 'normalization_missing'
        else 'resolved'
      end as reason
    from rows
  ), unresolved as (
    select * from diagnosed where reason<>'resolved'
  ), samples as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'projectId',id,'projectTitle',title,'wrikeTaskId',wrike_id,
      'verticalFieldIds',coalesce(source_wrike_field_ids,'{}'::text[]),
      'verticalFieldTitles',coalesce(source_titles,'{}'::text[]),
      'rawStoredValue',coalesce(source_values,'[]'::jsonb),
      'parsedDisplayValues',parsed_values,'normalizedResult',normalized_verticals,
      'reason',reason,'verticalState',vertical_state,'lastSynchronizedAt',custom_fields_verified_at,
      'lastRepairedAt',vertical_repaired_at
    ) order by title,wrike_id),'[]'::jsonb) as items
    from (select * from unresolved order by title,wrike_id limit greatest(1,least(result_limit,1000))) limited
  )
  select jsonb_build_object(
    'generatedAt',now(),
    'counts',jsonb_build_object(
      'inspected',(select count(*) from diagnosed),
      'resolved',(select count(*) from diagnosed where reason='resolved'),
      'unresolved',(select count(*) from unresolved),
      'missingSource',(select count(*) from unresolved where reason='source_field_missing'),
      'blank',(select count(*) from unresolved where reason='blank'),
      'unrecognized',(select count(*) from unresolved where reason='unrecognized'),
      'conflicting',(select count(*) from unresolved where reason='conflicted'),
      'notSynchronized',(select count(*) from unresolved where reason='not_synchronized'),
      'normalizationMissing',(select count(*) from unresolved where reason='normalization_missing')
    ),
    'projects',(select items from samples)
  ) into result;
  return result;
end;
$$;

drop policy if exists "vertical repair runs admin read" on public.wrike_vertical_repair_runs;
create policy "vertical repair runs admin read"
on public.wrike_vertical_repair_runs for select
using (
  organization_id=public.current_organization_id()
  and public.current_has_capability('manage_data')
);

revoke all on function public.parse_wrike_vertical_tokens(text[]) from public;
revoke all on function public.reporting_vertical_repair_diagnostics(integer) from public;
grant execute on function public.parse_wrike_vertical_tokens(text[]) to authenticated,service_role;
grant execute on function public.reporting_vertical_repair_diagnostics(integer) to authenticated,service_role;

select pg_notify('pgrst','reload schema');
