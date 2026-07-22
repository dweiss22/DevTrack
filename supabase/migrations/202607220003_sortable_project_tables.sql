-- Sort both project tables by their six visible columns across the full result set.

create or replace function public.reporting_project_sort_percentiles(target_task_ids uuid[])
returns table(task_id uuid,percentile numeric)
language sql stable security invoker set search_path=public as $$
  with requested as (
    select requested_id,row_number() over() as ordinal
    from unnest(coalesce(target_task_ids,'{}'::uuid[])) requested_id
  ), batches as (
    select array_agg(requested_id order by ordinal) as task_ids
    from requested group by ((ordinal-1)/200)::integer
  )
  select result.task_id,
    case when result.cohort_size>=5 then
      100::numeric*(result.lower_count+0.5::numeric*result.tie_count)/result.cohort_size
    else null end as percentile
  from batches
  cross join lateral public.reporting_project_length_percentiles(batches.task_ids) result;
$$;

revoke all on function public.reporting_project_sort_percentiles(uuid[]) from public;
grant execute on function public.reporting_project_sort_percentiles(uuid[]) to authenticated,service_role;

create or replace function public.reporting_task_rows(filters jsonb default '{}'::jsonb,result_limit integer default 50,result_offset integer default 0)
returns table (task_id uuid,title text,status text,custom_status_id text,due_date date,completed_at timestamptz,planned_minutes integer,actual_minutes bigint,updated_at_wrike timestamptz,assignees jsonb,locations jsonb,custom_values jsonb,total_count bigint)
language sql stable security definer set search_path=public as $$
  with settings as (
    select coalesce(filters->>'sort','updated') as sort_key,
      coalesce(filters->>'sortDirection',case when coalesce(filters->>'sort','updated') in ('updated','actual','percentile') then 'desc' else 'asc' end) as direction
  ), filtered as materialized (
    select task.*,source.visible_actual_minutes
    from public.reporting_filtered_tasks(filters) source
    join public.wrike_tasks task on task.id=source.task_id
  ), decorated as materialized (
    select filtered.*,
      lower(coalesce(status_ref.title,filtered.custom_status_id,filtered.status)) as status_sort,
      case when filtered.vertical_state='cross_vertical' then 'cross-vertical' else coalesce((select lower(coalesce(nullif(array_to_string(value.normalized_verticals,', '),''),nullif(array_to_string(value.display_values,', '),'')))
        from public.wrike_task_normalized_custom_field_values value
        join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
        where value.task_id=filtered.id and field.normalized_key='vertical' limit 1),
        case filtered.vertical_state when 'missing' then 'vertical not assigned' when 'unrecognized' then 'vertical value needs review' when 'synchronization_incomplete' then 'vertical data not fully synchronized' else '' end) end as vertical_sort,
      coalesce((select lower(coalesce(user_ref.display_name,value.display_values[1]))
        from public.wrike_task_normalized_custom_field_values value
        join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
        left join public.wrike_users user_ref on user_ref.organization_id=filtered.organization_id and user_ref.wrike_id=value.display_values[1]
        where value.task_id=filtered.id and field.normalized_key in ('instructional designer','course owner','project owner','owner','id','id assigned')
        order by field.normalized_key limit 1),'') as designer_sort,
      coalesce((select min(lower(coalesce(folder.title,project.title,location.wrike_location_id)))
        from public.wrike_task_locations location
        left join public.wrike_folders folder on folder.id=location.folder_id
        left join public.wrike_projects project on project.id=location.project_id
        where location.task_id=filtered.id),'') as folders_sort
    from filtered
    left join public.wrike_workflow_statuses status_ref on status_ref.organization_id=filtered.organization_id and status_ref.wrike_id=filtered.custom_status_id
  ), percentiles as materialized (
    select percentile.* from public.reporting_project_sort_percentiles(
      case when (select sort_key from settings)='percentile' then (select array_agg(id) from decorated) else '{}'::uuid[] end
    ) percentile
  ), ordered as materialized (
    select decorated.*,percentiles.percentile,count(*) over() as full_count
    from decorated left join percentiles on percentiles.task_id=decorated.id cross join settings
    order by
      case when settings.sort_key='title' and settings.direction='asc' then lower(decorated.title) end asc nulls last,
      case when settings.sort_key='title' and settings.direction='desc' then lower(decorated.title) end desc nulls last,
      case when settings.sort_key='status' and settings.direction='asc' then decorated.status_sort end asc nulls last,
      case when settings.sort_key='status' and settings.direction='desc' then decorated.status_sort end desc nulls last,
      case when settings.sort_key='vertical' and settings.direction='asc' then decorated.vertical_sort end asc nulls last,
      case when settings.sort_key='vertical' and settings.direction='desc' then decorated.vertical_sort end desc nulls last,
      case when settings.sort_key='designer' and settings.direction='asc' then decorated.designer_sort end asc nulls last,
      case when settings.sort_key='designer' and settings.direction='desc' then decorated.designer_sort end desc nulls last,
      case when settings.sort_key='folders' and settings.direction='asc' then decorated.folders_sort end asc nulls last,
      case when settings.sort_key='folders' and settings.direction='desc' then decorated.folders_sort end desc nulls last,
      case when settings.sort_key='percentile' and settings.direction='asc' then percentiles.percentile end asc nulls last,
      case when settings.sort_key='percentile' and settings.direction='desc' then percentiles.percentile end desc nulls last,
      case when settings.sort_key='due' and settings.direction='asc' then decorated.due_date end asc nulls last,
      case when settings.sort_key='due' and settings.direction='desc' then decorated.due_date end desc nulls last,
      case when settings.sort_key='actual' and settings.direction='asc' then decorated.visible_actual_minutes end asc nulls last,
      case when settings.sort_key='actual' and settings.direction='desc' then decorated.visible_actual_minutes end desc nulls last,
      case when settings.sort_key='updated' and settings.direction='asc' then decorated.updated_at_wrike end asc nulls last,
      case when settings.sort_key='updated' and settings.direction='desc' then decorated.updated_at_wrike end desc nulls last,
      decorated.id
    limit greatest(1,least(result_limit,200)) offset greatest(0,result_offset)
  )
  select item.id,item.title,item.status,item.custom_status_id,item.due_date,item.completed_at,item.planned_minutes,item.visible_actual_minutes,item.updated_at_wrike,
    coalesce((select jsonb_agg(jsonb_build_object('id',user_ref.id,'name',user_ref.display_name) order by user_ref.display_name) from public.wrike_task_assignees assignee join public.wrike_users user_ref on user_ref.id=assignee.user_id where assignee.task_id=item.id),'[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('folderId',location.folder_id,'projectId',location.project_id,'wrikeId',location.wrike_location_id,'title',coalesce(folder.title,project.title,location.wrike_location_id),'scope',folder.scope,'resolved',(location.folder_id is not null or location.project_id is not null)) order by coalesce(folder.title,project.title,location.wrike_location_id)) from public.wrike_task_locations location left join public.wrike_folders folder on folder.id=location.folder_id left join public.wrike_projects project on project.id=location.project_id where location.task_id=item.id),'[]'::jsonb),
    coalesce((select jsonb_object_agg(value.normalized_field_id::text,jsonb_build_object('title',field.title,'values',value.display_values,'conflict',value.has_conflict,'sourceFieldIds',value.source_wrike_field_ids,'sourceTitles',value.source_titles,'normalizedVerticals',value.normalized_verticals,'verticalReportingCategory',value.vertical_reporting_category,'hasUnresolvedVertical',item.vertical_state in ('missing','unrecognized','synchronization_incomplete'),'unresolvedVerticalTokens',value.unresolved_vertical_tokens,'verticalState',item.vertical_state)) from public.wrike_task_normalized_custom_field_values value join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id where value.task_id=item.id),'{}'::jsonb),
    item.full_count
  from ordered item;
$$;

revoke all on function public.reporting_task_rows(jsonb,integer,integer) from public;
grant execute on function public.reporting_task_rows(jsonb,integer,integer) to authenticated,service_role;

create or replace function public.reporting_development_project_rows(filters jsonb default '{}'::jsonb,result_limit integer default 50,result_offset integer default 0)
returns jsonb language sql stable security definer set search_path=public as $$
  with settings as (
    select coalesce(filters->>'sort','updated') as sort_key,
      coalesce(filters->>'sortDirection',case when coalesce(filters->>'sort','updated') in ('updated','actual','completed','percentile') then 'desc' else 'asc' end) as direction
  ), filtered as materialized (
    select task.*,source.actual_minutes,reporting.reporting_year,
      case when status_ref.wrike_id is null or status_ref.is_unresolved then 'Unknown Status' else status_ref.title end as status_name,
      case when status_ref.wrike_id is not null and not status_ref.is_unresolved then status_ref.color else null end as status_color,
      status_ref.wrike_id is not null and not status_ref.is_unresolved as status_resolved,
      case when status_ref.dashboard_classification='completed' then 'completed' else 'incomplete' end as completion_classification,
      status_ref.dashboard_classification is null as status_unmapped,
      case when task.vertical_state='cross_vertical' then 'cross-vertical' else coalesce((select lower(coalesce(nullif(array_to_string(value.normalized_verticals,', '),''),nullif(array_to_string(value.display_values,', '),''))) from public.wrike_task_normalized_custom_field_values value join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id where value.task_id=task.id and field.normalized_key='vertical' limit 1),case task.vertical_state when 'missing' then 'vertical not assigned' when 'unrecognized' then 'vertical value needs review' when 'synchronization_incomplete' then 'vertical data not fully synchronized' else '' end) end as vertical_sort,
      coalesce((select lower(coalesce(user_ref.display_name,value.display_values[1])) from public.wrike_task_normalized_custom_field_values value join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id left join public.wrike_users user_ref on user_ref.organization_id=task.organization_id and user_ref.wrike_id=value.display_values[1] where value.task_id=task.id and field.normalized_key in ('instructional designer','course owner','project owner','owner','id','id assigned') order by field.normalized_key limit 1),'') as designer_sort,
      coalesce((select min(lower(coalesce(folder.title,project.title,location.wrike_location_id))) from public.wrike_task_locations location left join public.wrike_folders folder on folder.id=location.folder_id left join public.wrike_projects project on project.id=location.project_id where location.task_id=task.id),'') as folders_sort
    from public.reporting_development_filtered_tasks(filters) source
    join public.wrike_tasks task on task.id=source.task_id
    left join public.wrike_workflow_statuses status_ref on status_ref.organization_id=task.organization_id and status_ref.wrike_id=task.custom_status_id
    left join public.wrike_normalized_custom_fields reporting_field on reporting_field.organization_id=task.organization_id and reporting_field.normalized_key='reporting'
    left join public.wrike_task_normalized_custom_field_values reporting on reporting.task_id=task.id and reporting.normalized_field_id=reporting_field.id
  ), percentiles as materialized (
    select percentile.* from public.reporting_project_sort_percentiles(case when (select sort_key from settings)='percentile' then (select array_agg(id) from filtered) else '{}'::uuid[] end) percentile
  ), ordered as materialized (
    select filtered.*,percentiles.percentile,count(*) over() as total_count
    from filtered left join percentiles on percentiles.task_id=filtered.id cross join settings
    order by
      case when settings.sort_key='title' and settings.direction='asc' then lower(filtered.title) end asc nulls last,case when settings.sort_key='title' and settings.direction='desc' then lower(filtered.title) end desc nulls last,
      case when settings.sort_key='status' and settings.direction='asc' then lower(filtered.status_name) end asc nulls last,case when settings.sort_key='status' and settings.direction='desc' then lower(filtered.status_name) end desc nulls last,
      case when settings.sort_key='vertical' and settings.direction='asc' then filtered.vertical_sort end asc nulls last,case when settings.sort_key='vertical' and settings.direction='desc' then filtered.vertical_sort end desc nulls last,
      case when settings.sort_key='designer' and settings.direction='asc' then filtered.designer_sort end asc nulls last,case when settings.sort_key='designer' and settings.direction='desc' then filtered.designer_sort end desc nulls last,
      case when settings.sort_key='folders' and settings.direction='asc' then filtered.folders_sort end asc nulls last,case when settings.sort_key='folders' and settings.direction='desc' then filtered.folders_sort end desc nulls last,
      case when settings.sort_key='percentile' and settings.direction='asc' then percentiles.percentile end asc nulls last,case when settings.sort_key='percentile' and settings.direction='desc' then percentiles.percentile end desc nulls last,
      case when settings.sort_key='priority' and settings.direction='asc' then lower(coalesce(filtered.importance,'')) end asc,case when settings.sort_key='priority' and settings.direction='desc' then lower(coalesce(filtered.importance,'')) end desc,
      case when settings.sort_key='start' and settings.direction='asc' then filtered.start_date end asc nulls last,case when settings.sort_key='start' and settings.direction='desc' then filtered.start_date end desc nulls last,
      case when settings.sort_key='due' and settings.direction='asc' then filtered.due_date end asc nulls last,case when settings.sort_key='due' and settings.direction='desc' then filtered.due_date end desc nulls last,
      case when settings.sort_key='completed' and settings.direction='asc' then filtered.completed_at end asc nulls last,case when settings.sort_key='completed' and settings.direction='desc' then filtered.completed_at end desc nulls last,
      case when settings.sort_key='actual' and settings.direction='asc' then filtered.actual_minutes end asc,case when settings.sort_key='actual' and settings.direction='desc' then filtered.actual_minutes end desc,
      case when settings.sort_key='updated' and settings.direction='asc' then filtered.updated_at_wrike end asc nulls last,case when settings.sort_key='updated' and settings.direction='desc' then filtered.updated_at_wrike end desc nulls last,
      filtered.id
    limit greatest(1,least(result_limit,200)) offset greatest(0,result_offset)
  ), rows as (
    select jsonb_build_object(
      'taskId',item.id,'title',item.title,'reportingYear',item.reporting_year,
      'status',jsonb_build_object('id',coalesce(item.custom_status_id,'__unknown__'),'name',item.status_name,'color',item.status_color,'resolved',item.status_resolved),
      'completionClassification',item.completion_classification,'statusUnmapped',item.status_unmapped,
      'assignees',coalesce((select jsonb_agg(jsonb_build_object('id',responsible.id,'name',coalesce(user_ref.display_name,responsible.id),'resolved',user_ref.wrike_id is not null and not user_ref.is_unresolved) order by responsible.ordinality) from unnest(item.responsible_wrike_ids) with ordinality responsible(id,ordinality) left join public.wrike_users user_ref on user_ref.organization_id=item.organization_id and user_ref.wrike_id=responsible.id),'[]'::jsonb),
      'priority',item.importance,'startDate',item.start_date,'dueDate',item.due_date,'completedAt',item.completed_at,'actualMinutes',item.actual_minutes,'permalink',item.permalink,'updatedAt',item.updated_at_wrike,
      'locations',coalesce((select jsonb_agg(jsonb_build_object('id',location.wrike_location_id,'name',coalesce(folder.title,project.title,location.wrike_location_id),'resolved',folder.id is not null or project.id is not null) order by coalesce(folder.title,project.title,location.wrike_location_id)) from public.wrike_task_locations location left join public.wrike_folders folder on folder.id=location.folder_id left join public.wrike_projects project on project.id=location.project_id where location.task_id=item.id),'[]'::jsonb),
      'customValues',coalesce((select jsonb_object_agg(field.normalized_key,jsonb_build_object('title',field.title,'values',value.display_values,'conflict',value.has_conflict)) from public.wrike_task_normalized_custom_field_values value join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id where value.task_id=item.id),'{}'::jsonb)
    ) as row,total_count from ordered item
  )
  select jsonb_build_object('rows',coalesce((select jsonb_agg(row) from rows),'[]'::jsonb),'total',coalesce((select max(total_count) from rows),0));
$$;

revoke all on function public.reporting_development_project_rows(jsonb,integer,integer) from public;
grant execute on function public.reporting_development_project_rows(jsonb,integer,integer) to authenticated,service_role;

comment on function public.reporting_project_sort_percentiles(uuid[]) is
  'Calculates the existing secured Development percentile in bounded 200-task batches for full-result project table ordering.';

select pg_notify('pgrst','reload schema');
