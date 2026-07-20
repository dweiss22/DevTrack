-- These task parentIds are higher-level Wrike ancestors outside the selected
-- DevTrack reporting folders. Remove their derived relationships and mark the
-- retained diagnostic records ignored. Original task raw_data is preserved.

do $$
declare
  ignored_folder_ids text[] := array[
    'IEACHQK7I4PFONLA',
    'IEACHQK7I4PFONKX',
    'IEACHQK7I4PFONKR',
    'IEACHQK7I7777777'
  ];
begin
  delete from public.wrike_task_locations
  where wrike_location_id=any(ignored_folder_ids);

  delete from public.wrike_folders
  where wrike_id=any(ignored_folder_ids);

  update public.wrike_tasks task
  set parent_wrike_ids=coalesce(array(
      select parent_id from unnest(task.parent_wrike_ids) parent_id
      where not parent_id=any(ignored_folder_ids)
    ),'{}'::text[]),
    enriched_metadata=case when task.enriched_metadata is null then null else
      jsonb_set(
        jsonb_set(task.enriched_metadata,'{folderIds}',coalesce((
          select jsonb_agg(folder_id)
          from jsonb_array_elements(coalesce(task.enriched_metadata->'folderIds','[]'::jsonb)) folder_id
          where not (folder_id #>> '{}')=any(ignored_folder_ids)
        ),'[]'::jsonb),true),
        '{folders}',coalesce((
          select jsonb_agg(folder)
          from jsonb_array_elements(coalesce(task.enriched_metadata->'folders','[]'::jsonb)) folder
          where not (folder->>'id')=any(ignored_folder_ids)
        ),'[]'::jsonb),true)
      end,
    updated_at=now()
  where task.parent_wrike_ids && ignored_folder_ids
    or exists (
      select 1 from jsonb_array_elements(coalesce(task.enriched_metadata->'folderIds','[]'::jsonb)) folder_id
      where (folder_id #>> '{}')=any(ignored_folder_ids)
    );

  update public.wrike_unresolved_references
  set resolution_status='ignored',resolved_at=now(),last_error=null,updated_at=now()
  where reference_type='folder' and wrike_id=any(ignored_folder_ids)
    and resolution_status='unresolved';
end
$$;
