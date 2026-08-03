-- The ID Dashboard is sourced from the persona-aware assignment resolver. A
-- later migration recreated this guard with the older resolver, so courses
-- visible as actionable on the dashboard could be rejected during draft
-- creation. Keep authorization and presentation on the same assignment set.
create or replace function public.is_course_development_person_assigned(
  target_task_id uuid,target_role text,target_wrike_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select target_wrike_user_id is not null and exists(
    select 1
    from public.wrike_tasks task
    join public.course_development_person_assignments_with_personas(
      task.organization_id,target_role
    ) assignment
      on assignment.task_id=task.id
      and assignment.wrike_user_id=target_wrike_user_id
    where task.id=target_task_id
      and task.organization_id=public.current_organization_id()
      and not task.is_deleted
  );
$$;

revoke all on function public.is_course_development_person_assigned(uuid,text,uuid)
  from public;
grant execute on function public.is_course_development_person_assigned(uuid,text,uuid)
  to authenticated,service_role;

select pg_notify('pgrst','reload schema');
