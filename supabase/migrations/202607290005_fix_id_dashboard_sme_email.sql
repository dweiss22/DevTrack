-- Application-user email addresses live in auth.users, not application_users.
-- Keep the field-derived SME dashboard row resolver aligned with that boundary.

create or replace function public.reporting_id_dashboard_rows(
  target_wrike_user_id uuid default null
)
returns table(
  task_id uuid,title text,status_name text,status_classification text,
  reviewed_wrike_user_id uuid,sme_identity_id uuid,
  reviewed_sme_name text,reviewed_sme_email text,
  reviewed_sme_application_user_id uuid,sme_mapping_status text,
  sme_identity_status text,sme_assignment_values text[],
  vertical text,publication_date date,publication_year integer,
  reporting_year integer,original_due_date date,due_date date,
  completed_at timestamptz,folder_context text,updated_at_wrike timestamptz,
  own_review jsonb,colleague_reviews jsonb
)
language plpgsql
stable
security definer
set search_path=public,extensions
as $$
declare
  viewer public.application_users%rowtype;
begin
  select * into viewer
  from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  if not found then
    raise exception using errcode='42501',message='Dashboard is unavailable.';
  end if;
  if viewer.role='id' then
    target_wrike_user_id:=viewer.wrike_user_id;
  elsif viewer.role not in ('super_admin','admin') then
    raise exception using errcode='42501',message='Dashboard is unavailable.';
  end if;
  if target_wrike_user_id is null or not exists(
    select 1
    from public.course_development_person_assignments_with_personas(
      viewer.organization_id,'id'
    ) assignment
    where assignment.wrike_user_id=target_wrike_user_id
  ) then return; end if;

  return query
  select task.id,task.title,coalesce(status.title,task.status),
    coalesce(status.dashboard_classification,'unclassified'),
    sme_identity.wrike_user_id,sme_identity.id,
    sme_identity.display_name,coalesce(sme_auth.email,wrike_sme.email),
    sme_identity.application_user_id,
    case when sme_identity.id is null then null
      when sme_identity.application_user_id is null then 'unmapped'
      else 'mapped' end,
    case
      when sme_assignment.source_has_conflict then 'conflict'
      when sme_identity.resolution_status='ambiguous' then 'ambiguous'
      when sme_identity.id is not null then sme_identity.resolution_status
      else 'missing'
    end,
    case when sme_assignment.observed_name is null then '{}'::text[]
      else array[sme_assignment.observed_name] end,
    vertical.vertical,publication.publication_date,
    extract(year from publication.publication_date)::integer,
    reporting.reporting_year,task.original_due_date,task.due_date,
    task.completed_at,
    coalesce((
      select string_agg(distinct folder.title,', ' order by folder.title)
      from public.wrike_task_locations location
      join public.wrike_folders folder on folder.id=location.folder_id
      where location.task_id=task.id
    ),'—'),task.updated_at_wrike,
    (
      select jsonb_build_object(
        'id',survey.id,'status',survey.status,'isLocked',survey.is_locked,
        'canEdit',public.can_edit_survey(survey.id),
        'revisionNumber',survey.revision_number
      )
      from public.survey_submissions survey
      where sme_identity.id is not null
        and survey.organization_id=viewer.organization_id
        and survey.task_id=task.id
        and survey.survey_type='id_sme_review'
        and survey.created_by=viewer.id
        and (
          survey.sme_identity_id=sme_identity.id
          or (
            survey.sme_identity_id is null
            and sme_identity.wrike_user_id is not null
            and survey.reviewed_wrike_user_id=sme_identity.wrike_user_id
          )
        )
      order by (survey.sme_identity_id=sme_identity.id) desc,
        survey.updated_at desc
      limit 1
    ),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',survey.id,'status',survey.status,'isLocked',survey.is_locked,
        'revisionNumber',survey.revision_number,
        'creatorName',case when creator.state='deleted' then 'Deleted user'
          else coalesce(creator.display_name,'Unnamed reviewer') end
      ) order by survey.updated_at desc)
      from public.survey_submissions survey
      join public.application_user_principals creator
        on creator.id=survey.created_by
      where sme_identity.id is not null
        and survey.organization_id=viewer.organization_id
        and survey.task_id=task.id
        and survey.survey_type='id_sme_review'
        and survey.created_by<>viewer.id
        and (
          survey.sme_identity_id=sme_identity.id
          or (
            survey.sme_identity_id is null
            and sme_identity.wrike_user_id is not null
            and survey.reviewed_wrike_user_id=sme_identity.wrike_user_id
          )
        )
    ),'[]'::jsonb)
  from public.course_development_person_assignments_with_personas(
    viewer.organization_id,'id'
  ) owner_assignment
  join public.wrike_tasks task
    on task.id=owner_assignment.task_id and not task.is_deleted
  left join public.sme_dashboard_task_assignments sme_assignment
    on sme_assignment.task_id=task.id
    and sme_assignment.organization_id=viewer.organization_id
  left join public.sme_dashboard_identities sme_identity
    on sme_identity.id=sme_assignment.sme_identity_id
    and sme_identity.organization_id=viewer.organization_id
  left join public.wrike_users wrike_sme
    on wrike_sme.id=sme_identity.wrike_user_id
  left join public.application_users sme_member
    on sme_member.id=sme_identity.application_user_id
    and sme_member.organization_id=viewer.organization_id
    and sme_member.account_state='active'
  left join auth.users sme_auth
    on sme_auth.id=sme_member.id
  left join public.wrike_workflow_statuses status
    on status.organization_id=task.organization_id
    and status.wrike_id=task.custom_status_id
  left join lateral (
    select field_value.vertical_reporting_category vertical
    from public.wrike_task_normalized_custom_field_values field_value
    join public.wrike_normalized_custom_fields field
      on field.id=field_value.normalized_field_id
    where field_value.task_id=task.id
      and field.normalized_key='vertical'
      and not field_value.has_conflict
    limit 1
  ) vertical on true
  left join lateral (
    select observed.value::date publication_date
    from public.wrike_task_normalized_custom_field_values field_value
    join public.wrike_normalized_custom_fields field
      on field.id=field_value.normalized_field_id
    cross join lateral unnest(field_value.display_values) observed(value)
    where field_value.task_id=task.id
      and field.normalized_key in (
        'publication','publication date','published date','publish date'
      )
      and not field_value.has_conflict
      and observed.value ~ '^\d{4}-\d{2}-\d{2}$'
    limit 1
  ) publication on true
  left join lateral (
    select field_value.reporting_year
    from public.wrike_task_normalized_custom_field_values field_value
    join public.wrike_normalized_custom_fields field
      on field.id=field_value.normalized_field_id
    where field_value.task_id=task.id
      and field.normalized_key in ('reporting','reporting year')
      and not field_value.has_conflict
    limit 1
  ) reporting on true
  where owner_assignment.wrike_user_id=target_wrike_user_id
  order by greatest(
      publication.publication_date,task.completed_at::date,task.due_date,
      task.original_due_date,task.start_date
    ) desc nulls last,
    task.updated_at_wrike desc nulls last,
    lower(task.title),lower(sme_identity.display_name) nulls last,
    sme_identity.id nulls last;
end;
$$;

revoke all on function public.reporting_id_dashboard_rows(uuid) from public;
grant execute on function public.reporting_id_dashboard_rows(uuid)
to authenticated,service_role;

comment on function public.reporting_id_dashboard_rows(uuid) is
  'ID-assigned projects with one row per durable SME custom-field identity. Linked application email is resolved from auth.users without duplicating credentials in application_users.';

select pg_notify('pgrst','reload schema');
