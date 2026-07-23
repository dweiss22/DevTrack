create or replace function public.clear_wrike_run_history(target_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  import_run_count integer;
  repair_run_count integer;
begin
  delete from public.wrike_vertical_repair_runs
    where organization_id = target_organization_id;
  get diagnostics repair_run_count = row_count;

  delete from public.wrike_folder_task_import_runs
    where organization_id = target_organization_id;
  get diagnostics import_run_count = row_count;

  return jsonb_build_object(
    'importRunsDeleted', import_run_count,
    'repairRunsDeleted', repair_run_count
  );
end;
$$;

revoke all on function public.clear_wrike_run_history(uuid) from public;
grant execute on function public.clear_wrike_run_history(uuid) to service_role;

comment on function public.clear_wrike_run_history(uuid) is
  'Atomically clears the displayed Wrike import and Vertical repair logs for one organization without deleting synchronized data.';
