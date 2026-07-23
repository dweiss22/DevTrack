-- Restricted SME project detail, assigned-ID project controls, and secured
-- finalized course-draft links.

create unique index if not exists wrike_tasks_id_organization_idx
  on public.wrike_tasks(id,organization_id);
create unique index if not exists wrike_users_id_organization_idx
  on public.wrike_users(id,organization_id);

create table public.project_finalized_course_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid not null,
  url text,
  assigned_id_wrike_user_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  updated_by uuid not null,
  removed_at timestamptz,
  removed_by uuid,
  unique(organization_id,task_id),
  foreign key(task_id,organization_id)
    references public.wrike_tasks(id,organization_id) on delete cascade,
  foreign key(assigned_id_wrike_user_id,organization_id)
    references public.wrike_users(id,organization_id),
  foreign key(created_by,organization_id)
    references public.application_users(id,organization_id),
  foreign key(updated_by,organization_id)
    references public.application_users(id,organization_id),
  foreign key(removed_by,organization_id)
    references public.application_users(id,organization_id),
  check (
    (url is not null and removed_at is null and removed_by is null)
    or (url is null and removed_at is not null and removed_by is not null)
  )
);

create index project_finalized_course_drafts_assignment_idx
  on public.project_finalized_course_drafts(
    organization_id,assigned_id_wrike_user_id,task_id
  );

create table public.project_finalized_course_draft_audit (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid not null,
  draft_id uuid not null references public.project_finalized_course_drafts(id) on delete cascade,
  event_type text not null check(event_type in ('created','updated','removed')),
  actor_id uuid not null,
  assigned_id_wrike_user_id uuid not null,
  previous_available boolean not null,
  new_available boolean not null,
  created_at timestamptz not null default now(),
  foreign key(task_id,organization_id)
    references public.wrike_tasks(id,organization_id) on delete cascade,
  foreign key(assigned_id_wrike_user_id,organization_id)
    references public.wrike_users(id,organization_id),
  foreign key(actor_id,organization_id)
    references public.application_users(id,organization_id)
);

create index project_finalized_course_draft_audit_task_idx
  on public.project_finalized_course_draft_audit(
    organization_id,task_id,created_at desc
  );

alter table public.project_finalized_course_drafts enable row level security;
alter table public.project_finalized_course_draft_audit enable row level security;

revoke all on public.project_finalized_course_drafts from anon,authenticated;
revoke all on public.project_finalized_course_draft_audit from anon,authenticated;
grant all on public.project_finalized_course_drafts to service_role;
grant all on public.project_finalized_course_draft_audit to service_role;

create or replace function public.is_safe_finalized_course_draft_url(candidate text)
returns boolean
language sql
immutable
set search_path=public
as $$
  select candidate is not null
    and length(candidate) between 1 and 2048
    and candidate=btrim(candidate)
    and candidate !~ '[[:cntrl:][:space:]]'
    and candidate ~ '^https://[^/?#@:]+(:[0-9]{1,5})?([/?#].*)?$';
$$;

create or replace function public.save_project_finalized_course_draft(
  target_task_id uuid,
  target_url text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  viewer public.application_users%rowtype;
  existing public.project_finalized_course_drafts%rowtype;
  saved public.project_finalized_course_drafts%rowtype;
  event_name text;
begin
  select application_user.* into viewer
  from public.application_users application_user
  where application_user.id=auth.uid();

  if not found or viewer.role<>'id' or viewer.wrike_user_id is null
    or not exists(
      select 1
      from public.course_development_person_assignments(viewer.organization_id,'id') assignment
      where assignment.task_id=target_task_id
        and assignment.wrike_user_id=viewer.wrike_user_id
    )
  then
    raise exception using errcode='42501',message='Project action is unavailable.';
  end if;

  if not public.is_safe_finalized_course_draft_url(target_url) then
    raise exception using errcode='22023',message='Enter a valid absolute HTTPS URL without embedded credentials.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_task_id::text,0));
  select draft.* into existing
  from public.project_finalized_course_drafts draft
  where draft.organization_id=viewer.organization_id
    and draft.task_id=target_task_id
  for update;

  event_name:=case when existing.id is null or existing.url is null then 'created' else 'updated' end;

  insert into public.project_finalized_course_drafts(
    organization_id,task_id,url,assigned_id_wrike_user_id,
    created_by,updated_by,removed_at,removed_by
  )
  values(
    viewer.organization_id,target_task_id,target_url,viewer.wrike_user_id,
    viewer.id,viewer.id,null,null
  )
  on conflict(organization_id,task_id) do update set
    url=excluded.url,
    assigned_id_wrike_user_id=excluded.assigned_id_wrike_user_id,
    updated_at=now(),
    updated_by=excluded.updated_by,
    removed_at=null,
    removed_by=null
  returning * into saved;

  insert into public.project_finalized_course_draft_audit(
    organization_id,task_id,draft_id,event_type,actor_id,
    assigned_id_wrike_user_id,previous_available,new_available
  )
  values(
    viewer.organization_id,target_task_id,saved.id,event_name,viewer.id,
    viewer.wrike_user_id,existing.url is not null,true
  );

  return jsonb_build_object(
    'available',true,'url',saved.url,'updatedAt',saved.updated_at,
    'updatedBy',viewer.display_name
  );
end;
$$;

create or replace function public.remove_project_finalized_course_draft(
  target_task_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  viewer public.application_users%rowtype;
  existing public.project_finalized_course_drafts%rowtype;
begin
  select application_user.* into viewer
  from public.application_users application_user
  where application_user.id=auth.uid();

  if not found or viewer.role<>'id' or viewer.wrike_user_id is null
    or not exists(
      select 1
      from public.course_development_person_assignments(viewer.organization_id,'id') assignment
      where assignment.task_id=target_task_id
        and assignment.wrike_user_id=viewer.wrike_user_id
    )
  then
    raise exception using errcode='42501',message='Project action is unavailable.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_task_id::text,0));
  select draft.* into existing
  from public.project_finalized_course_drafts draft
  where draft.organization_id=viewer.organization_id
    and draft.task_id=target_task_id
    and draft.url is not null
  for update;

  if not found then
    raise exception using errcode='42501',message='Project action is unavailable.';
  end if;

  update public.project_finalized_course_drafts draft set
    url=null,
    updated_at=now(),
    updated_by=viewer.id,
    removed_at=now(),
    removed_by=viewer.id
  where draft.id=existing.id;

  insert into public.project_finalized_course_draft_audit(
    organization_id,task_id,draft_id,event_type,actor_id,
    assigned_id_wrike_user_id,previous_available,new_available
  )
  values(
    viewer.organization_id,target_task_id,existing.id,'removed',viewer.id,
    viewer.wrike_user_id,true,false
  );

  return jsonb_build_object('available',false);
end;
$$;

create or replace function public.project_finalized_draft_statuses(
  target_task_ids uuid[]
)
returns table(
  task_id uuid,
  available boolean,
  updated_at timestamptz,
  updated_by_name text,
  can_manage boolean
)
language plpgsql
stable
security definer
set search_path=public
as $$
declare viewer public.application_users%rowtype;
begin
  select application_user.* into viewer
  from public.application_users application_user
  where application_user.id=auth.uid();
  if not found then return; end if;

  return query
  select
    requested.id,
    draft.url is not null,
    draft.updated_at,
    updater.display_name,
    viewer.role='id'
      and viewer.wrike_user_id is not null
      and exists(
        select 1
        from public.course_development_person_assignments(viewer.organization_id,'id') assignment
        where assignment.task_id=requested.id
          and assignment.wrike_user_id=viewer.wrike_user_id
      )
  from unnest(coalesce(target_task_ids[1:200],'{}'::uuid[])) requested(id)
  join public.wrike_tasks task on task.id=requested.id
    and task.organization_id=viewer.organization_id
    and not task.is_deleted
  left join public.project_finalized_course_drafts draft
    on draft.organization_id=viewer.organization_id
    and draft.task_id=requested.id
  left join public.application_users updater on updater.id=draft.updated_by
  where viewer.role in ('super_admin','admin')
    or (
      viewer.role='id'
      and exists(
        select 1
        from public.course_development_person_assignments(viewer.organization_id,'id') assignment
        where assignment.task_id=requested.id
          and assignment.wrike_user_id=viewer.wrike_user_id
      )
    )
    or (
      viewer.role='sme'
      and exists(
        select 1
        from public.course_development_person_assignments(viewer.organization_id,'sme') assignment
        where assignment.task_id=requested.id
          and assignment.wrike_user_id=viewer.wrike_user_id
      )
    );
end;
$$;

create or replace function public.assigned_id_project_controls(target_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare viewer public.application_users%rowtype; result jsonb;
begin
  select application_user.* into viewer
  from public.application_users application_user
  where application_user.id=auth.uid();

  if not found or viewer.role<>'id' or viewer.wrike_user_id is null
    or not exists(
      select 1
      from public.course_development_person_assignments(viewer.organization_id,'id') assignment
      where assignment.task_id=target_task_id
        and assignment.wrike_user_id=viewer.wrike_user_id
    )
  then return null; end if;

  select jsonb_build_object(
    'assigned',true,
    'smes',coalesce((
      select jsonb_agg(jsonb_build_object(
        'wrikeUserId',identity.id,
        'applicationUserId',member.id,
        'name',identity.display_name,
        'email',identity.email,
        'mappingStatus',case when member.id is null then 'unmapped' else 'mapped' end,
        'review',case when survey.id is null then null else jsonb_build_object(
          'id',survey.id,'status',survey.status,'isLocked',survey.is_locked,
          'canEdit',public.can_edit_survey(survey.id),
          'revisionNumber',survey.revision_number
        ) end
      ) order by identity.display_name)
      from public.course_development_person_assignments(viewer.organization_id,'sme') assignment
      join public.wrike_users identity on identity.id=assignment.wrike_user_id
      left join public.application_users member
        on member.organization_id=viewer.organization_id
        and member.role='sme'
        and member.wrike_user_id=identity.id
      left join public.survey_submissions survey
        on survey.organization_id=viewer.organization_id
        and survey.task_id=target_task_id
        and survey.survey_type='id_sme_review'
        and survey.reviewed_wrike_user_id=identity.id
        and survey.created_by=viewer.id
      where assignment.task_id=target_task_id
    ),'[]'::jsonb),
    'finalizedDraft',coalesce((
      select jsonb_build_object(
        'available',draft.url is not null,
        'url',draft.url,
        'updatedAt',draft.updated_at,
        'updatedBy',updater.display_name
      )
      from public.project_finalized_course_drafts draft
      left join public.application_users updater on updater.id=draft.updated_by
      where draft.organization_id=viewer.organization_id
        and draft.task_id=target_task_id
    ),jsonb_build_object('available',false))
  ) into result;
  return result;
end;
$$;

create or replace function public.sme_project_detail(target_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  viewer public.application_users%rowtype;
  task public.wrike_tasks%rowtype;
  status_name text;
  reporting_year integer;
  vertical_value text;
  course_length text;
  legal_reviewer text;
  assigned_ids jsonb;
  debrief jsonb;
  finalized_draft jsonb;
begin
  select application_user.* into viewer
  from public.application_users application_user
  where application_user.id=auth.uid();

  if not found or viewer.role<>'sme' or viewer.wrike_user_id is null
    or not exists(
      select 1
      from public.course_development_person_assignments(viewer.organization_id,'sme') assignment
      where assignment.task_id=target_task_id
        and assignment.wrike_user_id=viewer.wrike_user_id
    )
  then return null; end if;

  select synchronized_task.* into task
  from public.wrike_tasks synchronized_task
  where synchronized_task.id=target_task_id
    and synchronized_task.organization_id=viewer.organization_id
    and not synchronized_task.is_deleted;
  if not found then return null; end if;

  select coalesce(status.title,task.status) into status_name
  from (select 1) seed
  left join public.wrike_workflow_statuses status
    on status.organization_id=viewer.organization_id
    and status.wrike_id=task.custom_status_id;

  select value.reporting_year into reporting_year
  from public.wrike_task_normalized_custom_field_values value
  join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
  where value.task_id=target_task_id
    and field.normalized_key in ('reporting','reporting year')
    and not value.has_conflict
  limit 1;

  select value.vertical_reporting_category into vertical_value
  from public.wrike_task_normalized_custom_field_values value
  join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
  where value.task_id=target_task_id
    and field.normalized_key='vertical'
    and not value.has_conflict
    and not value.has_unresolved_vertical
  limit 1;

  select array_to_string(value.display_values,', ') into course_length
  from public.wrike_task_normalized_custom_field_values value
  join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
  where value.task_id=target_task_id
    and field.normalized_key in ('course length','course duration','estimated course length')
    and not value.has_conflict
  limit 1;

  select array_to_string(value.display_values,', ') into legal_reviewer
  from public.wrike_task_normalized_custom_field_values value
  join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
  where value.task_id=target_task_id
    and field.normalized_key='legal reviewer'
    and not value.has_conflict
  limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'wrikeUserId',identity.id,'name',identity.display_name
  ) order by identity.display_name),'[]'::jsonb) into assigned_ids
  from public.course_development_person_assignments(viewer.organization_id,'id') assignment
  join public.wrike_users identity on identity.id=assignment.wrike_user_id
  where assignment.task_id=target_task_id;

  select jsonb_build_object(
    'id',survey.id,
    'status',survey.status,
    'isLocked',survey.is_locked,
    'canEdit',public.can_edit_survey(survey.id),
    'revisionNumber',survey.revision_number,
    'firstSubmittedAt',survey.first_submitted_at,
    'latestSubmittedAt',survey.latest_submitted_at,
    'response',jsonb_build_object(
      'internalEmployee',response.internal_employee,
      'billableHours',response.billable_hours,
      'amountBilled',response.amount_billed,
      'workStartedOn',response.work_started_on,
      'workFinishedOn',response.work_finished_on,
      'ratings',jsonb_build_array(
        response.rating_01,response.rating_02,response.rating_03,response.rating_04,response.rating_05,
        response.rating_06,response.rating_07,response.rating_08,response.rating_09,response.rating_10
      ),
      'comments',response.comments
    ),
    'attachments',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',attachment.id,
        'filename',attachment.original_filename,
        'sizeBytes',attachment.size_bytes,
        'uploadedAt',attachment.uploaded_at
      ) order by attachment.uploaded_at desc)
      from public.survey_attachments attachment
      where attachment.submission_id=survey.id
        and attachment.is_active
    ),'[]'::jsonb)
  ) into debrief
  from public.survey_submissions survey
  join public.course_development_debrief_responses response on response.submission_id=survey.id
  where survey.organization_id=viewer.organization_id
    and survey.task_id=target_task_id
    and survey.survey_type='course_development_debrief'
    and survey.subject_application_user_id=viewer.id;

  select jsonb_build_object(
    'available',draft.url is not null,
    'url',draft.url,
    'updatedAt',draft.updated_at
  ) into finalized_draft
  from public.project_finalized_course_drafts draft
  where draft.organization_id=viewer.organization_id
    and draft.task_id=target_task_id;

  return jsonb_build_object(
    'taskId',task.id,
    'title',task.title,
    'status',status_name,
    'reportingYear',reporting_year,
    'assignedIds',assigned_ids,
    'vertical',vertical_value,
    'courseLength',course_length,
    'legalReviewer',legal_reviewer,
    'debrief',debrief,
    'finalizedDraft',coalesce(finalized_draft,jsonb_build_object('available',false))
  );
end;
$$;

-- IDs may load/create an ID review only for a task assigned to their verified
-- mapped Wrike identity. Admin/SuperAdmin retain their separate management flow.
create or replace function public.survey_context_for_task(target_task_id uuid,requested_type text)
returns jsonb language plpgsql stable security definer set search_path=public,auth as $$
declare viewer public.application_users%rowtype; task public.wrike_tasks%rowtype; reporting_year integer;
  vertical_value text; publication_date date; assigned_smes jsonb; viewer_email text;
  target_project_id uuid; project_count integer;
begin
  select application_user.* into viewer
  from public.application_users application_user
  where application_user.id=auth.uid();
  if not found or requested_type not in ('course_development_debrief','id_sme_review') then
    raise exception using errcode='42501',message='Survey context is unavailable.';
  end if;
  select synchronized_task.* into task
  from public.wrike_tasks synchronized_task
  where synchronized_task.id=target_task_id
    and synchronized_task.organization_id=viewer.organization_id
    and not synchronized_task.is_deleted;
  if not found or not exists(
    select 1 from public.course_development_person_assignments(viewer.organization_id,'sme') assignment
    where assignment.task_id=task.id
  ) then raise exception using errcode='42501',message='Survey context is unavailable.'; end if;
  if requested_type='id_sme_review' and viewer.role not in ('super_admin','admin','id') then
    raise exception using errcode='42501',message='Survey context is unavailable.';
  end if;
  if requested_type='id_sme_review' and viewer.role='id' and (
    viewer.wrike_user_id is null or not exists(
      select 1 from public.course_development_person_assignments(viewer.organization_id,'id') assignment
      where assignment.task_id=task.id and assignment.wrike_user_id=viewer.wrike_user_id
    )
  ) then raise exception using errcode='42501',message='Survey context is unavailable.'; end if;
  if requested_type='course_development_debrief' and viewer.role not in ('super_admin','admin','sme') then
    raise exception using errcode='42501',message='Survey context is unavailable.';
  end if;
  if viewer.role='sme' and not exists(
    select 1 from public.course_development_person_assignments(viewer.organization_id,'sme') assignment
    where assignment.task_id=task.id and assignment.wrike_user_id=viewer.wrike_user_id
  ) then raise exception using errcode='42501',message='Survey context is unavailable.'; end if;
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
  join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
  where value.task_id=task.id and field.normalized_key in ('reporting','reporting year')
    and not value.has_conflict limit 1;
  select value.vertical_reporting_category into vertical_value
  from public.wrike_task_normalized_custom_field_values value
  join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
  where value.task_id=task.id and field.normalized_key='vertical'
    and not value.has_conflict limit 1;
  select observed.value::date into publication_date
  from public.wrike_task_normalized_custom_field_values value
  join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
  cross join lateral unnest(value.display_values) observed(value)
  where value.task_id=task.id
    and field.normalized_key in ('publication','publication date','publish date')
    and not value.has_conflict and observed.value ~ '^\d{4}-\d{2}-\d{2}$'
  limit 1;
  select coalesce(jsonb_agg(jsonb_build_object(
    'applicationUserId',member.id,'wrikeUserId',identity.id,
    'wrikeId',identity.wrike_id,'name',identity.display_name,'email',identity.email,
    'mappingStatus',case when member.id is null then 'unmapped' else 'mapped' end,
    'identityStatus','verified'
  ) order by identity.display_name),'[]'::jsonb) into assigned_smes
  from public.course_development_person_assignments(viewer.organization_id,'sme') assignment
  join public.wrike_users identity on identity.id=assignment.wrike_user_id
  left join public.application_users member
    on member.organization_id=viewer.organization_id
    and member.role='sme'
    and member.wrike_user_id=identity.id
  where assignment.task_id=task.id;
  select auth_user.email into viewer_email from auth.users auth_user where auth_user.id=viewer.id;
  return jsonb_build_object(
    'organizationId',viewer.organization_id,'taskId',task.id,'taskWrikeId',task.wrike_id,
    'taskTitle',task.title,'projectId',target_project_id,'projectTitle',
    (select project.title from public.wrike_projects project where project.id=target_project_id),
    'originalDueDate',task.original_due_date,
    'originalDueYear',extract(year from task.original_due_date)::integer,
    'reportingYear',reporting_year,'status',task.status,'vertical',vertical_value,
    'publicationDate',publication_date,
    'publicationYear',extract(year from publication_date)::integer,
    'assignedSmes',assigned_smes,
    'viewer',jsonb_build_object(
      'id',viewer.id,'name',viewer.display_name,'email',viewer_email,'role',viewer.role
    )
  );
end;
$$;

revoke all on function public.is_safe_finalized_course_draft_url(text) from public;
revoke all on function public.save_project_finalized_course_draft(uuid,text) from public;
revoke all on function public.remove_project_finalized_course_draft(uuid) from public;
revoke all on function public.project_finalized_draft_statuses(uuid[]) from public;
revoke all on function public.assigned_id_project_controls(uuid) from public;
revoke all on function public.sme_project_detail(uuid) from public;

grant execute on function public.is_safe_finalized_course_draft_url(text) to authenticated,service_role;
grant execute on function public.save_project_finalized_course_draft(uuid,text) to authenticated,service_role;
grant execute on function public.remove_project_finalized_course_draft(uuid) to authenticated,service_role;
grant execute on function public.project_finalized_draft_statuses(uuid[]) to authenticated,service_role;
grant execute on function public.assigned_id_project_controls(uuid) to authenticated,service_role;
grant execute on function public.sme_project_detail(uuid) to authenticated,service_role;

select pg_notify('pgrst','reload schema');
