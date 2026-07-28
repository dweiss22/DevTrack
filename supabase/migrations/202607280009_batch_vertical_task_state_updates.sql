-- Persist read-back-verified Vertical task state without INSERT semantics.

create or replace function public.repair_wrike_vertical_task_states(
  target_organization_id uuid,
  task_updates jsonb
)
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  updated_count integer;
begin
  if jsonb_typeof(task_updates)<>'array' then
    raise exception 'Vertical task updates must be a JSON array';
  end if;
  update public.wrike_tasks task
  set vertical_state=source.vertical_state,
      vertical_repaired_at=source.vertical_repaired_at,
      enriched_metadata=source.enriched_metadata,
      updated_at=source.updated_at
  from jsonb_to_recordset(task_updates) as source(
    id uuid,
    vertical_state text,
    vertical_repaired_at timestamptz,
    enriched_metadata jsonb,
    updated_at timestamptz
  )
  where task.id=source.id
    and task.organization_id=target_organization_id
    and not task.is_deleted;
  get diagnostics updated_count=row_count;
  if updated_count<>jsonb_array_length(task_updates) then
    raise exception 'Vertical task update scope mismatch: expected %, updated %',
      jsonb_array_length(task_updates),updated_count;
  end if;
  return updated_count;
end;
$$;

revoke all on function public.repair_wrike_vertical_task_states(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.repair_wrike_vertical_task_states(uuid,jsonb) to service_role;

select pg_notify('pgrst','reload schema');
