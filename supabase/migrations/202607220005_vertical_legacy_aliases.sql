-- Recognize the verified legacy Vertical labels that accompany canonical
-- Associated Vertical values in older Wrike course records. Raw source values
-- remain unchanged; only normalized reporting state is recalculated.

insert into public.wrike_vertical_aliases(alias_key,approved_value,sort_order,is_cross_vertical) values
  ('LE','P1A',1,false),
  ('C','C1A',2,false),
  ('FIRE','FR1A',4,false),
  ('EMS','EMS1',5,false)
on conflict(alias_key) do update set
  approved_value=excluded.approved_value,
  sort_order=excluded.sort_order,
  is_cross_vertical=false;

-- Fire the normalization trigger only for rows currently carrying one of the
-- verified legacy labels as an unresolved token.
update public.wrike_task_normalized_custom_field_values value
set display_values=value.display_values,updated_at=value.updated_at
from public.wrike_normalized_custom_fields field
where field.id=value.normalized_field_id
  and field.normalized_key='vertical'
  and exists (
    select 1 from unnest(coalesce(value.unresolved_vertical_tokens,'{}'::text[])) token
    where upper(trim(token))=any(array['LE','C','FIRE','EMS']::text[])
  );

-- Clear the task-level warning only when normalization leaves no rejected
-- tokens. Mixed values containing another unknown token remain unrecognized.
update public.wrike_tasks task set vertical_state=case
  when vertical.vertical_reporting_category='Cross Vertical' then 'cross_vertical'
  else 'resolved'
end
from public.wrike_task_normalized_custom_field_values vertical
join public.wrike_normalized_custom_fields field on field.id=vertical.normalized_field_id
where task.id=vertical.task_id
  and field.normalized_key='vertical'
  and task.custom_fields_sync_state='complete'
  and task.vertical_state='unrecognized'
  and coalesce(cardinality(vertical.normalized_verticals),0)>0
  and coalesce(cardinality(vertical.unresolved_vertical_tokens),0)=0;

notify pgrst,'reload schema';
