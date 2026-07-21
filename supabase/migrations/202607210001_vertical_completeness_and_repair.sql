-- Distinguish source-data quality from incomplete Wrike task responses and
-- normalize semantic all-Vertical values without rewriting their raw values.

alter table public.wrike_tasks
  add column if not exists custom_fields_sync_state text not null default 'unknown'
    check (custom_fields_sync_state in ('complete','incomplete','unknown')),
  add column if not exists custom_fields_verified_at timestamptz,
  add column if not exists custom_fields_sync_diagnostics jsonb not null default '{}'::jsonb,
  add column if not exists vertical_state text not null default 'synchronization_incomplete'
    check (vertical_state in ('resolved','cross_vertical','missing','unrecognized','synchronization_incomplete')),
  add column if not exists last_folder_import_run_id uuid references public.wrike_folder_task_import_runs(id) on delete set null;

alter table public.wrike_folder_task_import_runs
  add column if not exists task_custom_field_diagnostics jsonb not null default '{}'::jsonb;

create table if not exists public.wrike_vertical_repair_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  status text not null check (status in ('running','succeeded','failed')),
  examined_count integer not null default 0,
  repaired_count integer not null default 0,
  unchanged_count integer not null default 0,
  retained_count integer not null default 0,
  still_incomplete_count integer not null default 0,
  hydration_request_count integer not null default 0,
  diagnostics jsonb not null default '{}'::jsonb,
  error_summary text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.wrike_vertical_repair_runs enable row level security;
create policy "vertical repair runs admin read" on public.wrike_vertical_repair_runs for select
  using (organization_id=public.current_organization_id() and exists(
    select 1 from public.application_users viewer where viewer.auth_user_id=auth.uid() and viewer.role='admin'
  ));
grant select on public.wrike_vertical_repair_runs to authenticated;
grant all on public.wrike_vertical_repair_runs to service_role;

alter table public.wrike_vertical_aliases alter column approved_value drop not null;
alter table public.wrike_vertical_aliases add column if not exists is_cross_vertical boolean not null default false;
alter table public.wrike_vertical_aliases drop constraint if exists wrike_vertical_aliases_approved_value_check;
alter table public.wrike_vertical_aliases add constraint wrike_vertical_aliases_value_check check (
  (is_cross_vertical and approved_value is null) or
  (not is_cross_vertical and approved_value in ('P1A','C1A','D1A','FR1A','EMS1','LGU','Lexipol','Wellness'))
);

insert into public.wrike_vertical_aliases(alias_key,approved_value,sort_order,is_cross_vertical) values
  ('GENERAL',null,0,true),('CROSS VERTICAL',null,0,true),('CROSS-VERTICAL',null,0,true),('ALL VERTICALS',null,0,true)
on conflict(alias_key) do update set approved_value=excluded.approved_value,sort_order=excluded.sort_order,is_cross_vertical=true;

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
    select regexp_replace(token,'[[:space:]]+',' ','g') as token,
      upper(regexp_replace(token,'[[:space:]]+',' ','g')) as alias_key
    from raw_tokens where token<>''
  ), matched as (
    select tokens.token,tokens.alias_key,alias.approved_value,alias.sort_order,alias.is_cross_vertical
    from tokens left join public.wrike_vertical_aliases alias using(alias_key)
  ), cross_state as (
    select coalesce(bool_or(is_cross_vertical),false) as semantic_cross from matched
  ), approved as (
    select alias.approved_value,min(alias.sort_order) as sort_order
    from matched alias where alias.approved_value is not null group by alias.approved_value
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

-- Re-run the existing trigger so General and established equivalents become
-- canonical while source_values continues to preserve the original tokens.
update public.wrike_task_normalized_custom_field_values value
set display_values=value.display_values,updated_at=value.updated_at
from public.wrike_normalized_custom_fields field
where field.id=value.normalized_field_id and field.normalized_key='vertical';

with task_quality as (
  select task.id,
    case when jsonb_typeof(task.raw_data->'customFields')='array' then 'complete' else 'incomplete' end as sync_state,
    case when jsonb_typeof(task.raw_data->'customFields')='array' then task.last_seen_at end as verified_at,
    vertical.normalized_verticals,vertical.vertical_reporting_category,vertical.unresolved_vertical_tokens,
    exists(select 1 from public.wrike_task_normalized_custom_field_values any_value where any_value.task_id=task.id) as has_normalized_data,
    exists(select 1 from public.wrike_task_custom_field_values raw_value where raw_value.task_id=task.id and not raw_value.resolved) as has_unresolved_custom_fields,
    coalesce(jsonb_array_length(case when jsonb_typeof(task.raw_data->'customFields')='array' then task.raw_data->'customFields' else '[]'::jsonb end),0) as raw_field_count
  from public.wrike_tasks task
  left join public.wrike_normalized_custom_fields field on field.organization_id=task.organization_id and field.normalized_key='vertical'
  left join public.wrike_task_normalized_custom_field_values vertical on vertical.task_id=task.id and vertical.normalized_field_id=field.id
)
update public.wrike_tasks task set
  custom_fields_sync_state=quality.sync_state,
  custom_fields_verified_at=quality.verified_at,
  vertical_state=case
    when quality.sync_state='incomplete' then 'synchronization_incomplete'
    when coalesce(cardinality(quality.unresolved_vertical_tokens),0)>0 then 'unrecognized'
    when quality.vertical_reporting_category='Cross Vertical' then 'cross_vertical'
    when coalesce(cardinality(quality.normalized_verticals),0)>0 then 'resolved'
    when quality.has_unresolved_custom_fields or (quality.raw_field_count>0 and not quality.has_normalized_data) then 'synchronization_incomplete'
    else 'missing' end
from task_quality quality where quality.id=task.id;

update public.wrike_task_normalized_custom_field_values value set
  has_unresolved_vertical=task.vertical_state in ('missing','unrecognized','synchronization_incomplete')
from public.wrike_tasks task,public.wrike_normalized_custom_fields field
where value.task_id=task.id and value.normalized_field_id=field.id and field.normalized_key='vertical';

create index if not exists wrike_tasks_vertical_state_idx on public.wrike_tasks(organization_id,vertical_state,id) where not is_deleted;
create index if not exists wrike_tasks_custom_field_sync_idx on public.wrike_tasks(organization_id,custom_fields_sync_state,id) where not is_deleted;

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
    and (not (filters ? 'verticalState') or exists(
      select 1 from public.wrike_tasks task where task.id=target_task_id and task.vertical_state=filters->>'verticalState'
    ))
    and (not coalesce((filters->>'unresolvedVerticalOnly')::boolean,false) or exists(
      select 1 from public.wrike_tasks task where task.id=target_task_id
        and task.vertical_state in ('missing','unrecognized','synchronization_incomplete')
    ));
$$;

create or replace function public.reporting_task_rows(filters jsonb default '{}'::jsonb,result_limit integer default 50,result_offset integer default 0)
returns table (task_id uuid,title text,status text,custom_status_id text,due_date date,completed_at timestamptz,planned_minutes integer,actual_minutes bigint,updated_at_wrike timestamptz,assignees jsonb,locations jsonb,custom_values jsonb,total_count bigint)
language sql stable set search_path=public as $$
  with filtered as (select t.*,ft.visible_actual_minutes from public.reporting_filtered_tasks(filters) ft join public.wrike_tasks t on t.id=ft.task_id)
  select f.id,f.title,f.status,f.custom_status_id,f.due_date,f.completed_at,f.planned_minutes,f.visible_actual_minutes,f.updated_at_wrike,
    coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',u.display_name) order by u.display_name) from public.wrike_task_assignees a join public.wrike_users u on u.id=a.user_id where a.task_id=f.id),'[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('folderId',l.folder_id,'projectId',l.project_id,'wrikeId',l.wrike_location_id,'title',coalesce(folder.title,project.title,l.wrike_location_id),'scope',folder.scope,'resolved',(l.folder_id is not null or l.project_id is not null)) order by coalesce(folder.title,project.title,l.wrike_location_id)) from public.wrike_task_locations l left join public.wrike_folders folder on folder.id=l.folder_id left join public.wrike_projects project on project.id=l.project_id where l.task_id=f.id),'[]'::jsonb),
    coalesce((select jsonb_object_agg(value.normalized_field_id::text,jsonb_build_object('title',field.title,'values',value.display_values,'conflict',value.has_conflict,'sourceFieldIds',value.source_wrike_field_ids,'sourceTitles',value.source_titles,'normalizedVerticals',value.normalized_verticals,'verticalReportingCategory',value.vertical_reporting_category,'hasUnresolvedVertical',f.vertical_state in ('missing','unrecognized','synchronization_incomplete'),'unresolvedVerticalTokens',value.unresolved_vertical_tokens,'verticalState',f.vertical_state)) from public.wrike_task_normalized_custom_field_values value join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id where value.task_id=f.id),'{}'::jsonb),
    count(*) over()
  from filtered f
  order by case when filters->>'sort'='title' then lower(f.title) end asc,case when filters->>'sort'='due' then f.due_date end asc nulls last,case when filters->>'sort'='actual' then f.visible_actual_minutes end desc,f.updated_at_wrike desc nulls last,f.id
  limit greatest(1,least(result_limit,200)) offset greatest(0,result_offset);
$$;

create or replace function public.reporting_online_learning_dashboard_overview_v4()
returns jsonb language sql stable security definer set search_path=public as $$
  with projects as materialized (
    select source.*,case when source.dashboard_classification='completed' then 'completed' when source.dashboard_classification='stalled_or_canceled' then 'stalled_or_canceled' else 'active' end as effective_classification
    from public.reporting_online_learning_dashboard_tasks() source
  ), field_values as (
    select value.task_id,field.normalized_key,value.display_values,value.has_conflict,value.vertical_reporting_category
    from public.wrike_task_normalized_custom_field_values value join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id join projects on projects.task_id=value.task_id
    where field.normalized_key in ('reporting','course type','authoring tool','vertical')
  ), project_fields as (
    select project.*,task.vertical_state,course.display_values as course_values,tool.display_values as tool_values,
      vertical.vertical_reporting_category,
      coalesce(reporting.has_conflict,false) or coalesce(course.has_conflict,false) or coalesce(tool.has_conflict,false) or coalesce(vertical.has_conflict,false) as field_conflict
    from projects project join public.wrike_tasks task on task.id=project.task_id
    left join field_values reporting on reporting.task_id=project.task_id and reporting.normalized_key='reporting'
    left join field_values course on course.task_id=project.task_id and course.normalized_key='course type'
    left join field_values tool on tool.task_id=project.task_id and tool.normalized_key='authoring tool'
    left join field_values vertical on vertical.task_id=project.task_id and vertical.normalized_key='vertical'
  ), categories as (
    select task_id,'courseType'::text as kind,case when coalesce(cardinality(course_values),0)=0 then 'Unassigned' when cardinality(course_values)=1 then course_values[1] else 'Multiple Course Types' end as category from project_fields
    union all select task_id,'authoringTool',case when coalesce(cardinality(tool_values),0)=0 then 'Unassigned' when cardinality(tool_values)=1 then tool_values[1] else 'Multiple Authoring Tools' end from project_fields
    union all select task_id,'vertical',case vertical_state when 'missing' then 'Vertical not assigned' when 'unrecognized' then 'Vertical value needs review' when 'synchronization_incomplete' then 'Vertical data not fully synchronized' when 'cross_vertical' then 'Cross-Vertical' else vertical_reporting_category end from project_fields
  ), category_counts as (
    select kind,category,count(*)::bigint as projects from categories where category is not null group by kind,category
  ), year_summary as (
    select reporting_year,count(*) filter(where effective_classification='stalled_or_canceled')::bigint as stalled,count(*) filter(where effective_classification='active')::bigint as active,count(*) filter(where effective_classification='completed')::bigint as completed,count(*)::bigint as total,
      coalesce(jsonb_agg(distinct status_name) filter(where effective_classification='stalled_or_canceled'),'[]'::jsonb) as stalled_statuses,coalesce(jsonb_agg(distinct status_name) filter(where effective_classification='active'),'[]'::jsonb) as active_statuses,coalesce(jsonb_agg(distinct status_name) filter(where effective_classification='completed'),'[]'::jsonb) as completed_statuses
    from project_fields group by reporting_year
  )
  select jsonb_build_object(
    'metrics',jsonb_build_object('totalProjects',(select count(*) from project_fields),'activeProjects',(select count(*) from project_fields where effective_classification='active'),'completedProjects',(select count(*) from project_fields where effective_classification='completed'),'stalledOrCanceledProjects',(select count(*) from project_fields where effective_classification='stalled_or_canceled'),'unresolvedStatusProjects',(select count(*) from project_fields where dashboard_classification is null),'customFieldConflictProjects',(select count(*) from project_fields where field_conflict),'unresolvedVerticalProjects',(select count(*) from project_fields where vertical_state in ('missing','unrecognized','synchronization_incomplete')),'missingVerticalProjects',(select count(*) from project_fields where vertical_state='missing'),'unrecognizedVerticalProjects',(select count(*) from project_fields where vertical_state='unrecognized'),'incompleteVerticalProjects',(select count(*) from project_fields where vertical_state='synchronization_incomplete')),
    'projectsByReportingYear',coalesce((select jsonb_agg(jsonb_build_object('label',reporting_year::text,'sortYear',reporting_year,'projects',completed) order by reporting_year) from year_summary),'[]'::jsonb),
    'projectsByStatus',coalesce((select jsonb_agg(jsonb_build_object('label',reporting_year::text,'sortYear',reporting_year,'stalledOrCanceled',stalled,'active',active,'completed',completed,'total',total,'stalledStatuses',stalled_statuses,'activeStatuses',active_statuses,'completedStatuses',completed_statuses) order by reporting_year) from year_summary),'[]'::jsonb),
    'courseTypes',coalesce((select jsonb_agg(jsonb_build_object('name',category,'projects',projects) order by projects desc,category) from category_counts where kind='courseType' and category<>'Unassigned'),'[]'::jsonb),
    'authoringTools',coalesce((select jsonb_agg(jsonb_build_object('name',category,'projects',projects) order by projects desc,category) from category_counts where kind='authoringTool' and category<>'Unassigned'),'[]'::jsonb),
    'verticals',coalesce((select jsonb_agg(jsonb_build_object('name',category,'projects',projects) order by projects desc,category) from category_counts where kind='vertical'),'[]'::jsonb)
  );
$$;

create or replace function public.reporting_vertical_data_quality()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare viewer_organization_id uuid; result jsonb;
begin
  select viewer.organization_id into viewer_organization_id from public.application_users viewer where viewer.auth_user_id=auth.uid() and viewer.role='admin';
  if viewer_organization_id is null then raise exception 'Administrator access is required' using errcode='42501'; end if;
  with tasks as materialized (
    select task.id,task.wrike_id,task.title,task.vertical_state,task.custom_fields_sync_state,task.custom_fields_sync_diagnostics,task.last_folder_import_run_id,
      case when task.raw_data is null or jsonb_typeof(task.raw_data)<>'object' or not (task.raw_data ? 'customFields') then 'omitted' when jsonb_typeof(task.raw_data->'customFields')<>'array' then 'invalid' when jsonb_array_length(task.raw_data->'customFields')=0 then 'empty' else 'present' end as raw_state,
      reporting.reporting_year,
      (task.workflow_id='IEACHQK7K4BHMLHM' or status_ref.workflow_id='IEACHQK7K4BHMLHM') as online_learning,
      coalesce(vertical.normalized_verticals,'{}'::text[]) as normalized_verticals,coalesce(vertical.unresolved_vertical_tokens,'{}'::text[]) as unresolved_tokens,
      exists(select 1 from public.wrike_task_normalized_custom_field_values value where value.task_id=task.id) as has_normalized_values
    from public.wrike_tasks task
    left join public.wrike_workflow_statuses status_ref on status_ref.organization_id=task.organization_id and status_ref.wrike_id=task.custom_status_id
    left join public.wrike_normalized_custom_fields reporting_field on reporting_field.organization_id=task.organization_id and reporting_field.normalized_key='reporting'
    left join public.wrike_task_normalized_custom_field_values reporting on reporting.task_id=task.id and reporting.normalized_field_id=reporting_field.id
    left join public.wrike_normalized_custom_fields vertical_field on vertical_field.organization_id=task.organization_id and vertical_field.normalized_key='vertical'
    left join public.wrike_task_normalized_custom_field_values vertical on vertical.task_id=task.id and vertical.normalized_field_id=vertical_field.id
    where task.organization_id=viewer_organization_id and not task.is_deleted
  ), folder_breakdown as (
    select coalesce(folder.title,mapping.folder_wrike_id) as title,count(distinct task.id)::bigint as tasks
    from tasks task join public.wrike_folder_task_imports mapping on mapping.task_id=task.id
    left join public.wrike_folders folder on folder.organization_id=viewer_organization_id and folder.wrike_id=mapping.folder_wrike_id
    group by coalesce(folder.title,mapping.folder_wrike_id)
  ), year_breakdown as (
    select reporting_year,count(*)::bigint as tasks from tasks group by reporting_year
  ), run_breakdown as (
    select last_folder_import_run_id,count(*)::bigint as tasks from tasks group by last_folder_import_run_id
  ), strategy_breakdown as (
    select coalesce(custom_fields_sync_diagnostics->>'selectedSource','historical_unknown') as strategy,count(*)::bigint as tasks from tasks group by coalesce(custom_fields_sync_diagnostics->>'selectedSource','historical_unknown')
  ), membership_breakdown as (
    select membership,count(distinct task.id)::bigint as tasks from tasks task cross join lateral unnest(task.normalized_verticals) membership group by membership
  ), samples as (
    select jsonb_agg(jsonb_build_object('taskId',id,'wrikeId',wrike_id,'title',title,'verticalState',vertical_state,'rawState',raw_state,'reportingYear',reporting_year,'source',custom_fields_sync_diagnostics->>'selectedSource') order by title) as rows
    from (select * from tasks where vertical_state in ('missing','unrecognized','synchronization_incomplete') order by title limit 25) sample
  ), focus as (
    select jsonb_agg(jsonb_build_object('taskId',task.id,'wrikeId',task.wrike_id,'title',task.title,'verticalState',task.vertical_state,'rawState',task.raw_state,'normalizedVerticals',task.normalized_verticals,'unrecognizedTokens',task.unresolved_tokens,'diagnostics',task.custom_fields_sync_diagnostics,
      'definitionUnavailableCount',(select count(*) from jsonb_array_elements(case when task.raw_state in ('present','empty') then (select raw_data->'customFields' from public.wrike_tasks stored where stored.id=task.id) else '[]'::jsonb end) raw_field(item) left join public.wrike_custom_fields definition on definition.organization_id=viewer_organization_id and definition.wrike_id=raw_field.item->>'id' where definition.id is null or definition.is_unresolved),
      'folders',coalesce((select jsonb_agg(distinct coalesce(folder.title,mapping.folder_wrike_id)) from public.wrike_folder_task_imports mapping left join public.wrike_folders folder on folder.organization_id=viewer_organization_id and folder.wrike_id=mapping.folder_wrike_id where mapping.task_id=task.id),'[]'::jsonb))) as rows
    from tasks task where lower(task.title)=lower('De-escalation Strategies and Techniques')
  )
  select jsonb_build_object(
    'generatedAt',now(),'metrics',jsonb_build_object('totalSynchronizedTasks',(select count(*) from tasks),'onlineLearningTasks',(select count(*) from tasks where online_learning),'validReportingYearTasks',(select count(*) from tasks where reporting_year is not null),'tasksIn2026Courses',(select count(distinct task.id) from tasks task join public.wrike_folder_task_imports mapping on mapping.task_id=task.id left join public.wrike_folders folder on folder.organization_id=viewer_organization_id and folder.wrike_id=mapping.folder_wrike_id where lower(coalesce(folder.title,mapping.folder_wrike_id))=lower('2026 Courses')),'rawCustomFieldsOmitted',(select count(*) from tasks where raw_state='omitted'),'rawCustomFieldsInvalid',(select count(*) from tasks where raw_state='invalid'),'rawCustomFieldsEmpty',(select count(*) from tasks where raw_state='empty'),'rawCustomFieldsPresent',(select count(*) from tasks where raw_state='present'),'rawFieldsWithoutNormalizedStorage',(select count(*) from tasks where raw_state='present' and not has_normalized_values),'generalNormalizedToCrossVertical',(select count(distinct task.id) from tasks task join public.wrike_task_normalized_custom_field_values value on value.task_id=task.id join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id where field.normalized_key='vertical' and value.source_values::text ~* 'general'),'resolvedVerticals',(select count(*) from tasks where vertical_state='resolved'),'crossVerticals',(select count(*) from tasks where vertical_state='cross_vertical'),'missingVerticals',(select count(*) from tasks where vertical_state='missing'),'unrecognizedVerticals',(select count(*) from tasks where vertical_state='unrecognized'),'synchronizationIncompleteVerticals',(select count(*) from tasks where vertical_state='synchronization_incomplete'),'responseDisagreements',(select count(*) from tasks where coalesce((custom_fields_sync_diagnostics->>'disagreement')::boolean,false))),
    'byReportingYear',coalesce((select jsonb_agg(jsonb_build_object('reportingYear',reporting_year,'tasks',tasks) order by reporting_year nulls last) from year_breakdown),'[]'::jsonb),'bySourceFolder',coalesce((select jsonb_agg(jsonb_build_object('folder',title,'tasks',tasks) order by title) from folder_breakdown),'[]'::jsonb),'byImportRun',coalesce((select jsonb_agg(jsonb_build_object('runId',last_folder_import_run_id,'tasks',tasks)) from run_breakdown),'[]'::jsonb),'byRetrievalStrategy',coalesce((select jsonb_agg(jsonb_build_object('strategy',strategy,'tasks',tasks) order by strategy) from strategy_breakdown),'[]'::jsonb),'byApprovedVerticalMembership',coalesce((select jsonb_agg(jsonb_build_object('vertical',membership,'tasks',tasks) order by membership) from membership_breakdown),'[]'::jsonb),'samples',coalesce((select rows from samples),'[]'::jsonb),'exampleTask',coalesce((select rows from focus),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.reporting_vertical_data_quality() from public;
grant execute on function public.reporting_vertical_data_quality() to authenticated;
grant execute on function public.matches_reporting_vertical_filters(uuid,jsonb) to authenticated,service_role;
grant execute on function public.reporting_task_rows(jsonb,integer,integer) to authenticated,service_role;
grant execute on function public.reporting_online_learning_dashboard_overview_v4() to authenticated,service_role;

comment on column public.wrike_tasks.custom_fields_sync_state is 'Whether the latest task response authoritatively included a customFields array.';
comment on column public.wrike_tasks.custom_fields_sync_diagnostics is 'Safe response-presence, hydration, provenance, and prior-retention evidence; no OAuth tokens or full responses.';
comment on column public.wrike_tasks.vertical_state is 'Resolved, cross-vertical, missing, unrecognized, or synchronization-incomplete Associated Vertical classification.';
select pg_notify('pgrst','reload schema');
