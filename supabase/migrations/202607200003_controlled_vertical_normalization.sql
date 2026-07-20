-- Controlled Vertical normalization. Source values remain untouched; reporting
-- and filtering use the canonical columns maintained by this trigger.

create table public.wrike_vertical_aliases (
  alias_key text primary key,
  approved_value text not null,
  sort_order integer not null,
  check (approved_value in ('P1A','C1A','D1A','FR1A','EMS1','LGU','Lexipol','Wellness'))
);

insert into public.wrike_vertical_aliases(alias_key,approved_value,sort_order) values
  ('P1A','P1A',1),('C1A','C1A',2),('D1A','D1A',3),('FR1A','FR1A',4),
  ('EMS1','EMS1',5),('EMS1A','EMS1',5),('LGU','LGU',6),
  ('LEXIPOL','Lexipol',7),('WELLNESS','Wellness',8);

alter table public.wrike_task_normalized_custom_field_values
  add column normalized_verticals text[],
  add column vertical_reporting_category text,
  add column has_unresolved_vertical boolean,
  add column unresolved_vertical_tokens text[],
  add constraint wrike_vertical_values_allowed check (
    normalized_verticals is null or normalized_verticals <@ array['P1A','C1A','D1A','FR1A','EMS1','LGU','Lexipol','Wellness']::text[]
  ),
  add constraint wrike_vertical_category_allowed check (
    vertical_reporting_category is null or vertical_reporting_category in
      ('P1A','C1A','D1A','FR1A','EMS1','LGU','Lexipol','Wellness','Cross Vertical','Unresolved Vertical')
  );

create index wrike_task_vertical_membership_idx
  on public.wrike_task_normalized_custom_field_values using gin(normalized_verticals);
create index wrike_task_vertical_category_idx
  on public.wrike_task_normalized_custom_field_values(vertical_reporting_category,task_id)
  where vertical_reporting_category is not null;
create index wrike_task_vertical_unresolved_idx
  on public.wrike_task_normalized_custom_field_values(task_id)
  where has_unresolved_vertical;

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
  with raw_tokens as (
    select trim(regexp_replace(replace(piece,chr(92),''),'^[[:space:]\\[\\]"'']+|[[:space:]\\[\\]"'']+$','','g')) as token
    from unnest(coalesce(source_values,'{}'::text[])) source(value)
    cross join lateral regexp_split_to_table(source.value,'[,;|]') piece
  ), tokens as (
    select token,upper(token) as alias_key from raw_tokens where token<>''
  ), approved as (
    select alias.approved_value,min(alias.sort_order) as sort_order
    from tokens join public.wrike_vertical_aliases alias using(alias_key)
    group by alias.approved_value
  ), rejected as (
    select min(token) as token,lower(token) as token_key
    from tokens left join public.wrike_vertical_aliases alias using(alias_key)
    where alias.alias_key is null group by lower(token)
  ), result as (
    select coalesce((select array_agg(approved_value order by sort_order) from approved),'{}'::text[]) as values,
      coalesce((select array_agg(token order by token_key) from rejected),'{}'::text[]) as rejected
  )
  select values,
    case when cardinality(values)>1 then 'Cross Vertical'
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
declare field_key text;
declare result record;
declare vertical_inputs text[];
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
    new.normalized_verticals := result.normalized_verticals;
    new.vertical_reporting_category := result.vertical_reporting_category;
    new.has_unresolved_vertical := result.has_unresolved_vertical;
    new.unresolved_vertical_tokens := result.unresolved_vertical_tokens;
    new.display_values := result.normalized_verticals;
  else
    new.normalized_verticals := null;
    new.vertical_reporting_category := null;
    new.has_unresolved_vertical := null;
    new.unresolved_vertical_tokens := null;
  end if;
  return new;
end;
$$;

create trigger enforce_wrike_vertical_normalization
before insert or update of normalized_field_id,display_values,source_values on public.wrike_task_normalized_custom_field_values
for each row execute function public.enforce_wrike_vertical_normalization();

-- Fire the trigger for all pre-existing Vertical rows.
update public.wrike_task_normalized_custom_field_values value
set display_values=value.display_values,updated_at=value.updated_at
from public.wrike_normalized_custom_fields field
where field.id=value.normalized_field_id and field.normalized_key='vertical';

create or replace function public.matches_reporting_vertical_filters(target_task_id uuid,filters jsonb)
returns boolean language sql stable security definer set search_path=public as $$
  select
    (not (filters ? 'verticalReportingCategory') or exists(
      select 1 from public.wrike_task_normalized_custom_field_values value
      join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
      where value.task_id=target_task_id and field.normalized_key='vertical'
        and lower(value.vertical_reporting_category)=lower(filters->>'verticalReportingCategory')
    ))
    and (not (filters ? 'associatedVertical') or exists(
      select 1 from public.wrike_task_normalized_custom_field_values value
      join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
      where value.task_id=target_task_id and field.normalized_key='vertical'
        and filters->>'associatedVertical'=any(value.normalized_verticals)
    ))
    and (not coalesce((filters->>'unresolvedVerticalOnly')::boolean,false) or not exists(
      select 1 from public.wrike_task_normalized_custom_field_values value
      join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
      where value.task_id=target_task_id and field.normalized_key='vertical'
        and not coalesce(value.has_unresolved_vertical,false)
    ));
$$;

create or replace function public.reporting_filtered_tasks(filters jsonb default '{}'::jsonb)
returns table (task_id uuid, visible_actual_minutes bigint)
language sql stable security definer set search_path=public as $$
  select filtered.task_id,filtered.visible_actual_minutes
  from public.reporting_filtered_tasks_without_dashboard_drilldown(
    case when filters ?| array['workflowIds','reportingYear','dashboardClassification','dashboardField','dashboardValue','verticalReportingCategory','associatedVertical','unresolvedVerticalOnly']
      then filters - 'state' else filters end
  ) filtered
  where public.matches_reporting_dashboard_drilldown(filtered.task_id,filters)
    and public.matches_reporting_vertical_filters(filtered.task_id,filters);
$$;

create or replace function public.reporting_task_rows(filters jsonb default '{}'::jsonb,result_limit integer default 50,result_offset integer default 0)
returns table (task_id uuid,title text,status text,custom_status_id text,due_date date,completed_at timestamptz,planned_minutes integer,actual_minutes bigint,updated_at_wrike timestamptz,assignees jsonb,locations jsonb,custom_values jsonb,total_count bigint)
language sql stable set search_path=public as $$
  with filtered as (select t.*,ft.visible_actual_minutes from public.reporting_filtered_tasks(filters) ft join public.wrike_tasks t on t.id=ft.task_id)
  select f.id,f.title,f.status,f.custom_status_id,f.due_date,f.completed_at,f.planned_minutes,f.visible_actual_minutes,f.updated_at_wrike,
    coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',u.display_name) order by u.display_name) from public.wrike_task_assignees a join public.wrike_users u on u.id=a.user_id where a.task_id=f.id),'[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('folderId',l.folder_id,'projectId',l.project_id,'wrikeId',l.wrike_location_id,'title',coalesce(folder.title,project.title,l.wrike_location_id),'scope',folder.scope,'resolved',(l.folder_id is not null or l.project_id is not null)) order by coalesce(folder.title,project.title,l.wrike_location_id)) from public.wrike_task_locations l left join public.wrike_folders folder on folder.id=l.folder_id left join public.wrike_projects project on project.id=l.project_id where l.task_id=f.id),'[]'::jsonb),
    coalesce((select jsonb_object_agg(value.normalized_field_id::text,jsonb_build_object('title',field.title,'values',value.display_values,'conflict',value.has_conflict,'sourceFieldIds',value.source_wrike_field_ids,'sourceTitles',value.source_titles,'normalizedVerticals',value.normalized_verticals,'verticalReportingCategory',value.vertical_reporting_category,'hasUnresolvedVertical',value.has_unresolved_vertical,'unresolvedVerticalTokens',value.unresolved_vertical_tokens)) from public.wrike_task_normalized_custom_field_values value join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id where value.task_id=f.id),'{}'::jsonb),
    count(*) over()
  from filtered f
  order by case when filters->>'sort'='title' then lower(f.title) end asc,case when filters->>'sort'='due' then f.due_date end asc nulls last,case when filters->>'sort'='actual' then f.visible_actual_minutes end desc,f.updated_at_wrike desc nulls last,f.id
  limit greatest(1,least(result_limit,200)) offset greatest(0,result_offset);
$$;

-- Preserve the existing analytics implementation and normalize only its
-- Vertical output/diagnostic until the next analytics RPC version.
do $$ begin
  if to_regprocedure('public.reporting_online_learning_dashboard_without_vertical_normalization(jsonb)') is null then
    alter function public.reporting_online_learning_dashboard_v2(jsonb) rename to reporting_online_learning_dashboard_without_vertical_normalization;
  end if;
end $$;

create or replace function public.reporting_online_learning_dashboard_v2(filters jsonb default '{}'::jsonb)
returns jsonb language sql stable security definer set search_path=public as $$
  with base as (select public.reporting_online_learning_dashboard_without_vertical_normalization(filters) as payload),
  unresolved as (
    select count(*)::bigint as projects
    from public.reporting_filtered_tasks(filters - 'state') filtered
    join public.wrike_tasks task on task.id=filtered.task_id
    left join public.wrike_workflow_statuses status_ref on status_ref.organization_id=task.organization_id and status_ref.wrike_id=task.custom_status_id
    where (task.workflow_id='IEACHQK7K4BHMLHM' or status_ref.workflow_id='IEACHQK7K4BHMLHM')
      and not exists (
        select 1 from public.wrike_task_normalized_custom_field_values value
        join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
        where value.task_id=task.id and field.normalized_key='vertical'
          and not coalesce(value.has_unresolved_vertical,false)
      )
  )
  select jsonb_set(
    jsonb_set(base.payload,'{verticals}',coalesce((select jsonb_agg(item) from jsonb_array_elements(base.payload->'verticals') item where item->>'name'<>'Unassigned'),'[]'::jsonb)),
    '{metrics,unresolvedVerticalProjects}',to_jsonb(unresolved.projects),true
  ) from base cross join unresolved;
$$;

revoke all on table public.wrike_vertical_aliases from public;
revoke all on function public.normalize_wrike_vertical_values(text[]) from public;
revoke all on function public.matches_reporting_vertical_filters(uuid,jsonb) from public;
grant select on public.wrike_vertical_aliases to authenticated,service_role;
grant execute on function public.normalize_wrike_vertical_values(text[]) to authenticated,service_role;
grant execute on function public.reporting_filtered_tasks(jsonb) to authenticated,service_role;
grant execute on function public.reporting_task_rows(jsonb,integer,integer) to authenticated,service_role;
grant execute on function public.reporting_online_learning_dashboard_v2(jsonb) to authenticated,service_role;

comment on column public.wrike_task_normalized_custom_field_values.normalized_verticals is 'Approved associated Verticals in controlled reporting order.';
comment on column public.wrike_task_normalized_custom_field_values.vertical_reporting_category is 'One project-level category: one approved Vertical, Cross Vertical, or Unresolved Vertical.';
select pg_notify('pgrst','reload schema');
