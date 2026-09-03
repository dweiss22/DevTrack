-- Wrike renamed its "ID Assigned" custom field. The normalized `id assigned`
-- field is currently sourced only from two Wrike fields literally titled
-- "ID Assigned," both of which now hold zero data — every task's assignment
-- actually lives under the field titled "[LCT] Assigned ID [Legacy]"
-- (wrike_id 'IEACHQK7JUAIXX6I'), which was never wired in as a source. That
-- silently emptied course_development_person_assignments(org_id,'id'),
-- breaking both the ID Dashboard admin picker (reporting_id_dashboard_identities)
-- and every user's own dashboard (reporting_id_dashboard_rows).
--
-- Record a manual mapping (the same mechanism the admin custom-field-mappings
-- UI uses) so this stays correct across future syncs regardless of what the
-- field is titled going forward — matching is by Wrike field id, not title.
insert into public.wrike_manual_mappings(
  organization_id,reference_type,wrike_id,action,target_normalized_field_id,manual_label,reprocess_status
)
select field.organization_id,'custom_field',field.wrike_id,'map_existing',logical.id,logical.title,'succeeded'
from public.wrike_custom_fields field
join public.wrike_normalized_custom_fields logical
  on logical.organization_id=field.organization_id and logical.normalized_key='id assigned'
where field.title='[LCT] Assigned ID [Legacy]'
on conflict (organization_id,reference_type,wrike_id) do update
  set action='map_existing',target_normalized_field_id=excluded.target_normalized_field_id,
    manual_label=excluded.manual_label,reprocess_status='succeeded',updated_at=now();

update public.wrike_custom_fields set has_manual_mapping=true,is_unresolved=false,updated_at=now()
where title='[LCT] Assigned ID [Legacy]';

-- Wire the source mapping immediately (the same table the API's map_existing
-- action writes to) so the fix takes effect without waiting for a full sync.
insert into public.wrike_normalized_custom_field_sources(normalized_field_id,custom_field_id,source_designation)
select logical.id,field.id,null
from public.wrike_custom_fields field
join public.wrike_normalized_custom_fields logical
  on logical.organization_id=field.organization_id and logical.normalized_key='id assigned'
where field.title='[LCT] Assigned ID [Legacy]'
on conflict (custom_field_id) do update
  set normalized_field_id=excluded.normalized_field_id,updated_at=now();

-- Backfill the resolved values for existing tasks (a normal sync/rebuild
-- would otherwise be needed to populate wrike_task_normalized_custom_field_values).
insert into public.wrike_task_normalized_custom_field_values(
  task_id,normalized_field_id,display_values,source_wrike_field_ids,source_titles,source_values,has_conflict,synced_at
)
select raw.task_id,logical.id,
  array(select jsonb_array_elements_text(raw.value)),
  array[field.wrike_id],array[field.title],
  jsonb_build_array(jsonb_build_object('id',field.wrike_id,'title',field.title,'value',raw.value)),
  false,now()
from public.wrike_task_custom_field_values raw
join public.wrike_custom_fields field on field.id=raw.custom_field_id and field.title='[LCT] Assigned ID [Legacy]'
join public.wrike_normalized_custom_fields logical
  on logical.organization_id=field.organization_id and logical.normalized_key='id assigned'
where jsonb_typeof(raw.value)='array'
on conflict (task_id,normalized_field_id) do update
  set display_values=excluded.display_values,source_wrike_field_ids=excluded.source_wrike_field_ids,
    source_titles=excluded.source_titles,source_values=excluded.source_values,
    has_conflict=excluded.has_conflict,synced_at=excluded.synced_at,updated_at=now();

select pg_notify('pgrst','reload schema');
