-- Restore the Admin/SuperAdmin equivalence promised by the centralized
-- capability matrix for older administrator-only database interfaces.

create or replace function public.is_org_admin()
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1
    from public.application_users
    where id=auth.uid() and role in ('super_admin','admin')
  );
$$;

create or replace function public.is_org_admin_for(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1
    from public.application_users
    where id=auth.uid()
      and organization_id=target_organization_id
      and role in ('super_admin','admin')
  );
$$;

drop policy if exists "vertical repair runs admin read" on public.wrike_vertical_repair_runs;
create policy "vertical repair runs admin read"
on public.wrike_vertical_repair_runs
for select
using (
  organization_id=public.current_organization_id()
  and public.is_org_admin()
);

create or replace function public.reporting_vertical_data_quality()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare viewer_organization_id uuid; result jsonb;
begin
  select viewer.organization_id into viewer_organization_id
  from public.application_users viewer
  where viewer.id=auth.uid() and viewer.role in ('super_admin','admin');
  if viewer_organization_id is null then
    raise exception 'Administrator access is required' using errcode='42501';
  end if;
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

revoke all on function public.is_org_admin() from public;
revoke all on function public.is_org_admin_for(uuid) from public;
revoke all on function public.reporting_vertical_data_quality() from public;
grant execute on function public.is_org_admin(),public.is_org_admin_for(uuid) to authenticated,service_role;
grant execute on function public.reporting_vertical_data_quality() to authenticated,service_role;

select pg_notify('pgrst','reload schema');
