-- Extend the existing reporting search predicate to resolved people without
-- changing task visibility, filter semantics, or pagination behavior.

create or replace function public.matches_reporting_normalized_custom_search(target_task_id uuid, query text)
returns boolean
language sql
stable
set search_path=public
as $$
  select exists (
    select 1
    from public.wrike_task_normalized_custom_field_values value
    join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
    where value.task_id=target_task_id
      and (field.title ilike '%' || query || '%' or exists(
        select 1 from unnest(value.display_values) item where item ilike '%' || query || '%'
      ))
  ) or exists (
    select 1
    from public.wrike_tasks task
    join public.wrike_users person on person.organization_id=task.organization_id
    where task.id=target_task_id
      and (person.display_name ilike '%' || query || '%' or coalesce(person.email,'') ilike '%' || query || '%')
      and (
        person.wrike_id=any(task.responsible_wrike_ids)
        or exists (
          select 1 from public.wrike_task_assignees assignee
          where assignee.task_id=task.id and assignee.user_id=person.id
        )
        or exists (
          select 1
          from public.wrike_task_normalized_custom_field_values value
          where value.task_id=task.id and person.wrike_id=any(value.display_values)
        )
      )
  );
$$;

comment on function public.matches_reporting_normalized_custom_search(uuid,text) is
  'Matches normalized custom-field text plus synchronized names/emails for assignees and contact-valued task fields.';

select pg_notify('pgrst','reload schema');
