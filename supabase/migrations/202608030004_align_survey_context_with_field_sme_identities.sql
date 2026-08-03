-- Survey launch was modernized to use field-derived SME identities, but the
-- trusted context builder still required a verified Wrike-user match. Build
-- the same trusted context from the identity assignment source used by the
-- dashboards and launch RPCs.
create or replace function public.survey_context_for_task_without_complete_management(
  target_task_id uuid,requested_type text
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,auth
as $$
declare
  viewer public.application_users%rowtype;
  task public.wrike_tasks%rowtype;
  reporting_year integer;
  vertical_value text;
  publication_date date;
  assigned_smes jsonb;
  viewer_email text;
  target_project_id uuid;
  project_count integer;
begin
  select application_user.* into viewer
  from public.application_users application_user
  where application_user.id=public.current_effective_user_id()
    and application_user.account_state='active';
  if not found or requested_type not in (
    'course_development_debrief','id_sme_review'
  ) then
    raise exception using errcode='42501',
      message='Survey context is unavailable.';
  end if;

  select synchronized_task.* into task
  from public.wrike_tasks synchronized_task
  where synchronized_task.id=target_task_id
    and synchronized_task.organization_id=viewer.organization_id
    and not synchronized_task.is_deleted;
  if not found or not exists(
    select 1
    from public.course_development_sme_identity_assignments(
      viewer.organization_id
    ) assignment
    join public.sme_dashboard_identities identity
      on identity.id=assignment.sme_identity_id
    where assignment.task_id=task.id
      and not assignment.source_has_conflict
      and identity.resolution_status<>'ambiguous'
  ) then
    raise exception using errcode='42501',
      message='Survey context is unavailable.';
  end if;

  if requested_type='id_sme_review'
    and not public.current_has_capability('manage_surveys')
    and (
      not public.current_has_operational_role('id')
      or not public.is_course_development_person_assigned(
        task.id,'id',public.current_operational_identity('id')
      )
    )
  then
    raise exception using errcode='42501',
      message='Survey context is unavailable.';
  end if;

  if requested_type='course_development_debrief'
    and not public.current_has_capability('manage_surveys')
    and (
      not public.current_has_operational_role('sme')
      or not public.is_sme_identity_assigned(
        task.id,public.current_sme_dashboard_identity()
      )
    )
  then
    raise exception using errcode='42501',
      message='Survey context is unavailable.';
  end if;

  select count(*),(array_agg(project.id order by project.id::text))[1]
    into project_count,target_project_id
  from (
    select distinct project.id
    from public.wrike_task_locations location
    join public.wrike_projects project on project.id=location.project_id
      and project.organization_id=viewer.organization_id
    where location.task_id=task.id and project.deleted_at is null
  ) project;
  if project_count<>1 then target_project_id:=null; end if;

  select value.reporting_year into reporting_year
  from public.wrike_task_normalized_custom_field_values value
  join public.wrike_normalized_custom_fields field
    on field.id=value.normalized_field_id
  where value.task_id=task.id
    and field.normalized_key in ('reporting','reporting year')
    and not value.has_conflict
  limit 1;

  select value.vertical_reporting_category into vertical_value
  from public.wrike_task_normalized_custom_field_values value
  join public.wrike_normalized_custom_fields field
    on field.id=value.normalized_field_id
  where value.task_id=task.id and field.normalized_key='vertical'
    and not value.has_conflict
  limit 1;

  select observed.value::date into publication_date
  from public.wrike_task_normalized_custom_field_values value
  join public.wrike_normalized_custom_fields field
    on field.id=value.normalized_field_id
  cross join lateral unnest(value.display_values) observed(value)
  where value.task_id=task.id
    and field.normalized_key in (
      'publication','publication date','publish date'
    )
    and not value.has_conflict
    and observed.value ~ '^\d{4}-\d{2}-\d{2}$'
  limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'applicationUserId',identity.application_user_id,
    'smeIdentityId',identity.id,
    'wrikeUserId',identity.wrike_user_id,
    'wrikeId',wrike_identity.wrike_id,
    'name',identity.display_name,
    'email',coalesce(subject_auth.email,wrike_identity.email),
    'mappingStatus',case when identity.application_user_id is null
      then 'unmapped' else 'mapped' end,
    'identityStatus',identity.resolution_status
  ) order by identity.display_name,identity.id),'[]'::jsonb)
  into assigned_smes
  from public.course_development_sme_identity_assignments(
    viewer.organization_id
  ) assignment
  join public.sme_dashboard_identities identity
    on identity.id=assignment.sme_identity_id
  left join public.wrike_users wrike_identity
    on wrike_identity.id=identity.wrike_user_id
  left join auth.users subject_auth
    on subject_auth.id=identity.application_user_id
  where assignment.task_id=task.id
    and not assignment.source_has_conflict
    and identity.resolution_status<>'ambiguous';

  select auth_user.email into viewer_email
  from auth.users auth_user
  where auth_user.id=viewer.id;

  return jsonb_build_object(
    'organizationId',viewer.organization_id,
    'taskId',task.id,
    'taskWrikeId',task.wrike_id,
    'taskTitle',task.title,
    'projectId',target_project_id,
    'projectTitle',(
      select project.title
      from public.wrike_projects project
      where project.id=target_project_id
    ),
    'originalDueDate',task.original_due_date,
    'originalDueYear',extract(year from task.original_due_date)::integer,
    'reportingYear',reporting_year,
    'status',task.status,
    'vertical',vertical_value,
    'publicationDate',publication_date,
    'publicationYear',extract(year from publication_date)::integer,
    'assignedSmes',assigned_smes,
    'viewer',jsonb_build_object(
      'id',viewer.id,
      'name',viewer.display_name,
      'email',viewer_email,
      'role',viewer.role
    )
  );
end;
$$;

revoke all on function public.survey_context_for_task_without_complete_management(uuid,text)
  from public;
grant execute on function public.survey_context_for_task_without_complete_management(uuid,text)
  to authenticated,service_role;

select pg_notify('pgrst','reload schema');
