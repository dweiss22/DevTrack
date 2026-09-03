-- Correction to 202609030001: that migration mapped the legacy field
-- "[LCT] Assigned ID [Legacy]" into the `id assigned` normalized key, but
-- those 335 rows belong to old tasks outside the active development workflow
-- (workflow_id is null) and never feed course_development_person_assignments
-- regardless. The real post-rename fields are "[LCT] Designer Assigned (M)"
-- and "[LCT] Designer Assigned (L)" (159/390 populated rows), which the sync
-- already auto-mapped to a brand-new `designer assigned` normalized key —
-- distinct from `id assigned`, so every hardcoded normalized_key='id assigned'
-- check across the app kept seeing nothing. Undo the legacy mapping and pin
-- the real (M)/(L) fields to the existing `id assigned` key instead, so the
-- normalized_key stays stable for the app while resolving from Wrike's
-- actual current field names.

-- Undo the incorrect legacy-field mapping.
delete from public.wrike_task_normalized_custom_field_values value
using public.wrike_normalized_custom_fields logical
where value.normalized_field_id=logical.id and logical.normalized_key='id assigned'
  and value.source_wrike_field_ids=array['IEACHQK7JUAIXX6I'];
delete from public.wrike_normalized_custom_field_sources
where custom_field_id=(select id from public.wrike_custom_fields where wrike_id='IEACHQK7JUAIXX6I');
delete from public.wrike_manual_mappings
where reference_type='custom_field' and wrike_id='IEACHQK7JUAIXX6I';
update public.wrike_custom_fields set has_manual_mapping=false,updated_at=now()
where wrike_id='IEACHQK7JUAIXX6I';

-- Pin the real post-rename fields to the existing `id assigned` normalized key.
insert into public.wrike_manual_mappings(
  organization_id,reference_type,wrike_id,action,target_normalized_field_id,manual_label,reprocess_status
)
select field.organization_id,'custom_field',field.wrike_id,'map_existing',logical.id,logical.title,'succeeded'
from public.wrike_custom_fields field
join public.wrike_normalized_custom_fields logical
  on logical.organization_id=field.organization_id and logical.normalized_key='id assigned'
where field.wrike_id in ('IEACHQK7JUAJ7NNV','IEACHQK7JUAK3VML')
on conflict (organization_id,reference_type,wrike_id) do update
  set action='map_existing',target_normalized_field_id=excluded.target_normalized_field_id,
    manual_label=excluded.manual_label,reprocess_status='succeeded',updated_at=now();

update public.wrike_custom_fields set has_manual_mapping=true,is_unresolved=false,updated_at=now()
where wrike_id in ('IEACHQK7JUAJ7NNV','IEACHQK7JUAK3VML');

insert into public.wrike_normalized_custom_field_sources(normalized_field_id,custom_field_id,source_designation)
select logical.id,field.id,case field.wrike_id when 'IEACHQK7JUAJ7NNV' then 'M' when 'IEACHQK7JUAK3VML' then 'L' end
from public.wrike_custom_fields field
join public.wrike_normalized_custom_fields logical
  on logical.organization_id=field.organization_id and logical.normalized_key='id assigned'
where field.wrike_id in ('IEACHQK7JUAJ7NNV','IEACHQK7JUAK3VML')
on conflict (custom_field_id) do update
  set normalized_field_id=excluded.normalized_field_id,source_designation=excluded.source_designation,updated_at=now();

-- Backfill resolved values for existing tasks (no task currently carries a
-- value in both (M) and (L), so there is no cross-source conflict to merge).
insert into public.wrike_task_normalized_custom_field_values(
  task_id,normalized_field_id,display_values,source_wrike_field_ids,source_titles,source_values,has_conflict,synced_at
)
select raw.task_id,logical.id,
  array(select jsonb_array_elements_text(raw.value)),
  array[field.wrike_id],array[field.title],
  jsonb_build_array(jsonb_build_object('id',field.wrike_id,'title',field.title,'value',raw.value)),
  false,now()
from public.wrike_task_custom_field_values raw
join public.wrike_custom_fields field on field.id=raw.custom_field_id
  and field.wrike_id in ('IEACHQK7JUAJ7NNV','IEACHQK7JUAK3VML')
join public.wrike_normalized_custom_fields logical
  on logical.organization_id=field.organization_id and logical.normalized_key='id assigned'
where jsonb_typeof(raw.value)='array'
on conflict (task_id,normalized_field_id) do update
  set display_values=excluded.display_values,source_wrike_field_ids=excluded.source_wrike_field_ids,
    source_titles=excluded.source_titles,source_values=excluded.source_values,
    has_conflict=excluded.has_conflict,synced_at=excluded.synced_at,updated_at=now();

select pg_notify('pgrst','reload schema');
