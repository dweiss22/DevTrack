-- 202609030002's backfill only handled jsonb array values (matching the
-- legacy "Multiple"-type field's shape), but "[LCT] Designer Assigned (M)"
-- and "(L)" are DropDown fields whose stored value is a plain jsonb string
-- (e.g. "Rachel Frost"), so the array-only filter matched nothing and left
-- `id assigned` empty. Handle both shapes, matching customFieldDisplayValues().
insert into public.wrike_task_normalized_custom_field_values(
  task_id,normalized_field_id,display_values,source_wrike_field_ids,source_titles,source_values,has_conflict,synced_at
)
select raw.task_id,logical.id,
  case jsonb_typeof(raw.value)
    when 'array' then array(select jsonb_array_elements_text(raw.value))
    when 'string' then array[btrim(raw.value#>>'{}')]
    else array[raw.value::text]
  end,
  array[field.wrike_id],array[field.title],
  jsonb_build_array(jsonb_build_object('id',field.wrike_id,'title',field.title,'value',raw.value)),
  false,now()
from public.wrike_task_custom_field_values raw
join public.wrike_custom_fields field on field.id=raw.custom_field_id
  and field.wrike_id in ('IEACHQK7JUAJ7NNV','IEACHQK7JUAK3VML')
join public.wrike_normalized_custom_fields logical
  on logical.organization_id=field.organization_id and logical.normalized_key='id assigned'
where case jsonb_typeof(raw.value)
    when 'array' then jsonb_array_length(raw.value)>0
    when 'string' then btrim(raw.value#>>'{}')<>''
    else true
  end
on conflict (task_id,normalized_field_id) do update
  set display_values=excluded.display_values,source_wrike_field_ids=excluded.source_wrike_field_ids,
    source_titles=excluded.source_titles,source_values=excluded.source_values,
    has_conflict=excluded.has_conflict,synced_at=excluded.synced_at,updated_at=now();

select pg_notify('pgrst','reload schema');
