-- App-managed course-development surveys, immutable revisions, audit history,
-- and private invoice storage.

alter table public.wrike_tasks add column if not exists original_due_date date;
update public.wrike_tasks set original_due_date=due_date where original_due_date is null and due_date is not null;

create or replace function public.preserve_wrike_task_original_due_date()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='INSERT' then new.original_due_date:=coalesce(new.original_due_date,new.due_date);
  else new.original_due_date:=old.original_due_date; end if;
  return new;
end;
$$;
drop trigger if exists preserve_wrike_task_original_due_date on public.wrike_tasks;
create trigger preserve_wrike_task_original_due_date
before insert or update on public.wrike_tasks
for each row execute function public.preserve_wrike_task_original_due_date();

create table public.survey_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  survey_type text not null check (survey_type in ('course_development_debrief','id_sme_review')),
  task_id uuid not null references public.wrike_tasks(id) on delete restrict,
  project_id uuid references public.wrike_projects(id) on delete set null,
  task_wrike_id text not null,
  subject_application_user_id uuid references public.application_users(id) on delete restrict,
  reviewed_wrike_user_id uuid references public.wrike_users(id) on delete restrict,
  created_by uuid not null references public.application_users(id) on delete restrict,
  revision_assignee_id uuid references public.application_users(id) on delete set null,
  context_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','submitted')),
  is_locked boolean not null default false,
  revision_number integer not null default 1 check (revision_number >= 1),
  original_submitted_at timestamptz,
  latest_submitted_at timestamptz,
  locked_at timestamptz,
  locked_by uuid references public.application_users(id) on delete set null,
  unlocked_at timestamptz,
  unlocked_by uuid references public.application_users(id) on delete set null,
  unlock_reason text check (unlock_reason is null or length(btrim(unlock_reason)) between 1 and 2000),
  last_edited_by uuid not null references public.application_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (survey_type='course_development_debrief' and subject_application_user_id is not null and reviewed_wrike_user_id is not null)
    or (survey_type='id_sme_review' and reviewed_wrike_user_id is not null)
  ),
  check ((status='draft' and original_submitted_at is null and not is_locked) or
         (status='submitted' and original_submitted_at is not null and latest_submitted_at is not null)),
  check (not is_locked or status='submitted')
);

create unique index survey_debrief_identity_idx
  on public.survey_submissions(organization_id,task_id,subject_application_user_id,survey_type)
  where survey_type='course_development_debrief';
create unique index survey_id_review_identity_idx
  on public.survey_submissions(organization_id,task_id,reviewed_wrike_user_id,created_by,survey_type)
  where survey_type='id_sme_review';
create index survey_submissions_org_type_status_idx
  on public.survey_submissions(organization_id,survey_type,status,updated_at desc);
create index survey_submissions_subject_idx
  on public.survey_submissions(subject_application_user_id,updated_at desc);

create table public.course_development_debrief_responses (
  submission_id uuid primary key references public.survey_submissions(id) on delete cascade,
  original_due_year integer check (original_due_year between 1000 and 9999),
  internal_employee boolean,
  billable_hours numeric(10,2) check (billable_hours >= 0),
  amount_billed numeric(12,2) check (amount_billed >= 0),
  work_started_on date,
  work_finished_on date,
  rating_01 smallint check (rating_01 between 1 and 5),
  rating_02 smallint check (rating_02 between 1 and 5),
  rating_03 smallint check (rating_03 between 1 and 5),
  rating_04 smallint check (rating_04 between 1 and 5),
  rating_05 smallint check (rating_05 between 1 and 5),
  rating_06 smallint check (rating_06 between 1 and 5),
  rating_07 smallint check (rating_07 between 1 and 5),
  rating_08 smallint check (rating_08 between 1 and 5),
  rating_09 smallint check (rating_09 between 1 and 5),
  rating_10 smallint check (rating_10 between 1 and 5),
  comments text check (comments is null or length(comments) <= 5000),
  updated_at timestamptz not null default now(),
  check (work_finished_on is null or work_started_on is null or work_finished_on >= work_started_on),
  check (internal_employee is distinct from true or (billable_hours is null and amount_billed is null))
);

create table public.id_sme_review_responses (
  submission_id uuid primary key references public.survey_submissions(id) on delete cascade,
  publication_year integer check (publication_year between 1000 and 9999),
  vertical text check (vertical is null or vertical in ('P1A','FR1A','EMS1','C1A','LGU','D1A','Lexipol','Wellness','Cross Vertical','Other')),
  rating_01 smallint check (rating_01 between 1 and 5),
  rating_02 smallint check (rating_02 between 1 and 5),
  rating_03 smallint check (rating_03 between 1 and 5),
  rating_04 smallint check (rating_04 between 1 and 5),
  rating_05 smallint check (rating_05 between 1 and 5),
  rating_06 smallint check (rating_06 between 1 and 5),
  rating_07 smallint check (rating_07 between 1 and 5),
  rating_08 smallint check (rating_08 between 1 and 5),
  rating_09 smallint check (rating_09 between 1 and 5),
  provided_real_world_examples boolean,
  real_world_examples_effectiveness smallint check (real_world_examples_effectiveness between 1 and 5),
  recommendation_score smallint check (recommendation_score between 0 and 10),
  comments text check (comments is null or length(comments) <= 5000),
  updated_at timestamptz not null default now(),
  check (provided_real_world_examples is distinct from false or real_world_examples_effectiveness is null)
);

create table public.survey_attachments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.survey_submissions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  revision_number integer not null check (revision_number >= 1),
  kind text not null default 'invoice' check (kind='invoice'),
  original_filename text not null check (length(original_filename) between 1 and 255),
  object_key text not null unique,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  uploaded_by uuid not null references public.application_users(id) on delete restrict,
  uploaded_at timestamptz not null default now(),
  is_active boolean not null default true,
  removed_by uuid references public.application_users(id) on delete set null,
  removed_at timestamptz,
  check ((is_active and removed_at is null and removed_by is null) or not is_active)
);
create unique index survey_one_active_invoice_per_revision_idx
  on public.survey_attachments(submission_id,revision_number,kind) where is_active;

create table public.survey_revisions (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.survey_submissions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  revision_number integer not null check (revision_number >= 1),
  context_snapshot jsonb not null,
  response_snapshot jsonb not null,
  attachment_snapshot jsonb not null default '[]'::jsonb,
  changed_fields jsonb not null default '{}'::jsonb,
  submitted_by uuid not null references public.application_users(id) on delete restrict,
  submitted_at timestamptz not null default now(),
  unique (submission_id,revision_number)
);

create table public.survey_audit_log (
  id bigint generated always as identity primary key,
  submission_id uuid not null references public.survey_submissions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_type text not null check (event_type in (
    'draft_created','draft_updated','submitted','unlocked','edited_after_unlock','resubmitted',
    'relocked','revision_access_reassigned','context_corrected','invoice_uploaded',
    'invoice_removed','invoice_replaced'
  )),
  actor_id uuid not null references public.application_users(id) on delete restrict,
  actor_role text not null check (actor_role in ('super_admin','admin','id','sme')),
  reason text,
  previous_values jsonb not null default '{}'::jsonb,
  new_values jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index survey_audit_submission_idx on public.survey_audit_log(submission_id,created_at desc);
create index survey_revision_submission_idx on public.survey_revisions(submission_id,revision_number desc);

create or replace function public.can_view_survey(target_submission_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1
    from public.survey_submissions survey
    join public.application_users viewer on viewer.id=auth.uid() and viewer.organization_id=survey.organization_id
    where survey.id=target_submission_id
      and (
        viewer.role in ('super_admin','admin')
        or (viewer.role='id' and survey.survey_type='id_sme_review')
        or (viewer.role='sme' and survey.survey_type='course_development_debrief'
            and survey.subject_application_user_id=viewer.id)
      )
  );
$$;

create or replace function public.can_edit_survey(target_submission_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1
    from public.survey_submissions survey
    join public.application_users viewer on viewer.id=auth.uid() and viewer.organization_id=survey.organization_id
    where survey.id=target_submission_id and not survey.is_locked
      and (
        viewer.role in ('super_admin','admin')
        or (
          survey.survey_type='course_development_debrief' and viewer.role='sme'
          and survey.subject_application_user_id=viewer.id
          and survey.status in ('draft','submitted')
        )
        or (
          survey.survey_type='id_sme_review' and viewer.role='id'
          and (
            (survey.status='draft' and survey.created_by=viewer.id)
            or (survey.status='submitted' and (survey.created_by=viewer.id or survey.revision_assignee_id=viewer.id))
          )
        )
      )
  );
$$;

create or replace function public.survey_context_for_task(
  target_task_id uuid,
  requested_type text
)
returns jsonb language plpgsql stable security definer set search_path=public,auth as $$
declare
  viewer public.application_users%rowtype;
  task public.wrike_tasks%rowtype;
  project_record public.wrike_projects%rowtype;
  project_count integer;
  target_project_id uuid;
  reporting_year integer;
  vertical_value text;
  publication_date date;
  assigned_smes jsonb;
  viewer_email text;
begin
  select * into viewer from public.application_users where id=auth.uid();
  if not found then raise exception using errcode='42501',message='Survey context is unavailable.'; end if;
  if requested_type not in ('course_development_debrief','id_sme_review') then
    raise exception using errcode='22023',message='Survey context is unavailable.';
  end if;
  select * into task from public.wrike_tasks
    where id=target_task_id and organization_id=viewer.organization_id and not is_deleted;
  if not found or not (
    task.workflow_id='IEACHQK7K4BHMLHM' or exists(
      select 1 from public.wrike_workflow_statuses status
      where status.organization_id=task.organization_id
        and status.wrike_id=task.custom_status_id and status.workflow_id='IEACHQK7K4BHMLHM'
    )
  ) then raise exception using errcode='42501',message='Survey context is unavailable.'; end if;
  if requested_type='id_sme_review' and viewer.role not in ('super_admin','admin','id') then
    raise exception using errcode='42501',message='Survey context is unavailable.';
  end if;
  if requested_type='course_development_debrief' and viewer.role not in ('super_admin','admin','sme') then
    raise exception using errcode='42501',message='Survey context is unavailable.';
  end if;

  select count(*),min(project.id) into project_count,target_project_id
  from public.wrike_task_locations location
  join public.wrike_projects project on project.id=location.project_id and project.organization_id=viewer.organization_id
  where location.task_id=task.id and project.deleted_at is null;
  if project_count=1 then select * into project_record from public.wrike_projects where id=target_project_id; else project_record:=null; end if;
  select email into viewer_email from auth.users where id=viewer.id;

  select value.reporting_year into reporting_year
  from public.wrike_task_normalized_custom_field_values value
  join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
  where value.task_id=task.id and field.normalized_key='reporting' and not value.has_conflict;

  select case
      when value.vertical_reporting_category in ('P1A','FR1A','EMS1','C1A','LGU','D1A','Lexipol','Wellness','Cross Vertical')
      then value.vertical_reporting_category else null end
    into vertical_value
  from public.wrike_task_normalized_custom_field_values value
  join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
  where value.task_id=task.id and field.normalized_key='vertical' and not value.has_conflict;

  select observed.value::date into publication_date
  from public.wrike_task_normalized_custom_field_values value
  join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
  cross join lateral unnest(value.display_values) observed(value)
  where value.task_id=task.id and field.normalized_key ~ '^(publication|publication date|publish date)$'
    and not value.has_conflict and observed.value ~ '^\d{4}-\d{2}-\d{2}$'
  limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'applicationUserId',member.id,'wrikeUserId',identity.id,'wrikeId',identity.wrike_id,
    'name',coalesce(member.display_name,identity.display_name),'email',auth_user.email
  ) order by coalesce(member.display_name,identity.display_name)),'[]'::jsonb)
  into assigned_smes
  from public.wrike_task_assignees assignment
  join public.wrike_users identity on identity.id=assignment.user_id and identity.organization_id=viewer.organization_id
    and identity.is_active and not identity.is_unresolved and identity.identity_verified
  join public.application_users member on member.organization_id=viewer.organization_id
    and member.role='sme' and member.wrike_user_id=identity.id
  left join auth.users auth_user on auth_user.id=member.id
  where assignment.task_id=task.id;

  return jsonb_build_object(
    'organizationId',viewer.organization_id,'taskId',task.id,'taskWrikeId',task.wrike_id,
    'taskTitle',task.title,'projectId',project_record.id,'projectTitle',project_record.title,
    'originalDueDate',task.original_due_date,'originalDueYear',extract(year from task.original_due_date)::integer,
    'reportingYear',reporting_year,'status',task.status,'vertical',vertical_value,
    'publicationDate',publication_date,'publicationYear',extract(year from publication_date)::integer,
    'assignedSmes',assigned_smes,
    'viewer',jsonb_build_object('id',viewer.id,'name',viewer.display_name,'email',viewer_email,'role',viewer.role)
  );
end;
$$;

create or replace function public.survey_create_or_resume(
  target_task_id uuid,
  requested_type text,
  target_sme_application_user_id uuid default null
)
returns uuid language plpgsql security definer set search_path=public,auth as $$
declare
  viewer public.application_users%rowtype;
  subject public.application_users%rowtype;
  context jsonb;
  target_wrike_user_id uuid;
  existing_id uuid;
  created_id uuid;
  subject_email text;
begin
  select * into viewer from public.application_users where id=auth.uid();
  if not found then raise exception using errcode='42501',message='Survey context is unavailable.'; end if;
  context:=public.survey_context_for_task(target_task_id,requested_type);
  if requested_type='course_development_debrief' then
    target_sme_application_user_id:=case when viewer.role='sme' then viewer.id else target_sme_application_user_id end;
    select * into subject from public.application_users
      where id=target_sme_application_user_id and organization_id=viewer.organization_id and role='sme';
    if not found or subject.wrike_user_id is null or not exists(
      select 1 from public.wrike_task_assignees
      where task_id=target_task_id and user_id=subject.wrike_user_id
    ) or not exists(
      select 1 from public.wrike_users where id=subject.wrike_user_id
        and organization_id=viewer.organization_id and is_active and not is_unresolved and identity_verified
    ) then raise exception using errcode='42501',message='Survey context is unavailable.'; end if;
    target_wrike_user_id:=subject.wrike_user_id;
    select email into subject_email from auth.users where id=subject.id;
    select id into existing_id from public.survey_submissions
      where organization_id=viewer.organization_id and task_id=target_task_id
        and subject_application_user_id=subject.id and survey_type=requested_type;
  else
    if viewer.role not in ('super_admin','admin','id') then
      raise exception using errcode='42501',message='Survey context is unavailable.';
    end if;
    select * into subject from public.application_users
      where id=target_sme_application_user_id and organization_id=viewer.organization_id and role='sme';
    if not found or subject.wrike_user_id is null or not exists(
      select 1 from public.wrike_task_assignees
      where task_id=target_task_id and user_id=subject.wrike_user_id
    ) or not exists(
      select 1 from public.wrike_users where id=subject.wrike_user_id
        and organization_id=viewer.organization_id and is_active and not is_unresolved and identity_verified
    ) then raise exception using errcode='42501',message='Survey context is unavailable.'; end if;
    target_wrike_user_id:=subject.wrike_user_id;
    select email into subject_email from auth.users where id=subject.id;
    select id into existing_id from public.survey_submissions
      where organization_id=viewer.organization_id and task_id=target_task_id
        and reviewed_wrike_user_id=target_wrike_user_id and created_by=viewer.id and survey_type=requested_type;
  end if;
  if existing_id is not null then return existing_id; end if;

  insert into public.survey_submissions(
    organization_id,survey_type,task_id,project_id,task_wrike_id,subject_application_user_id,
    reviewed_wrike_user_id,created_by,last_edited_by,context_snapshot
  ) values (
    viewer.organization_id,requested_type,target_task_id,(context->>'projectId')::uuid,context->>'taskWrikeId',
    subject.id,target_wrike_user_id,viewer.id,viewer.id,
    context || jsonb_build_object('subject',jsonb_build_object(
      'applicationUserId',subject.id,'wrikeUserId',target_wrike_user_id,
      'name',coalesce(subject.display_name,context#>>'{assignedSmes,0,name}'),
      'email',subject_email,
      'createdOnBehalf',viewer.id<>subject.id
    ))
  ) returning id into created_id;
  if requested_type='course_development_debrief' then
    insert into public.course_development_debrief_responses(submission_id,original_due_year)
      values(created_id,(context->>'originalDueYear')::integer);
  else
    insert into public.id_sme_review_responses(submission_id,publication_year,vertical)
      values(created_id,(context->>'publicationYear')::integer,context->>'vertical');
  end if;
  insert into public.survey_audit_log(submission_id,organization_id,event_type,actor_id,actor_role,new_values)
    values(created_id,viewer.organization_id,'draft_created',viewer.id,viewer.role,jsonb_build_object('createdOnBehalf',viewer.id<>subject.id));
  return created_id;
exception when unique_violation then
  if requested_type='course_development_debrief' then
    select id into existing_id from public.survey_submissions where organization_id=viewer.organization_id
      and task_id=target_task_id and subject_application_user_id=subject.id and survey_type=requested_type;
  else
    select id into existing_id from public.survey_submissions where organization_id=viewer.organization_id
      and task_id=target_task_id and reviewed_wrike_user_id=target_wrike_user_id
      and created_by=viewer.id and survey_type=requested_type;
  end if;
  return existing_id;
end;
$$;

create or replace function public.survey_save(
  target_submission_id uuid,
  answers jsonb,
  submit_now boolean default false
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  viewer public.application_users%rowtype;
  survey public.survey_submissions%rowtype;
  old_response jsonb;
  new_response jsonb;
  is_resubmission boolean;
  next_revision integer;
  event_name text;
  active_invoice jsonb;
begin
  select * into viewer from public.application_users where id=auth.uid();
  select * into survey from public.survey_submissions where id=target_submission_id for update;
  if not found or survey.organization_id<>viewer.organization_id or not public.can_edit_survey(survey.id) then
    raise exception using errcode='42501',message='Survey is unavailable.';
  end if;
  if survey.survey_type='course_development_debrief' then
    select to_jsonb(response) - 'submission_id' - 'updated_at' into old_response
      from public.course_development_debrief_responses response where submission_id=survey.id;
    update public.course_development_debrief_responses set
      original_due_year=coalesce((survey.context_snapshot->>'originalDueYear')::integer,nullif(answers->>'originalDueYear','')::integer),
      internal_employee=nullif(answers->>'internalEmployee','')::boolean,
      billable_hours=case when (answers->>'internalEmployee')::boolean then null else nullif(answers->>'billableHours','')::numeric end,
      amount_billed=case when (answers->>'internalEmployee')::boolean then null else nullif(answers->>'amountBilled','')::numeric end,
      work_started_on=nullif(answers->>'workStartedOn','')::date,
      work_finished_on=nullif(answers->>'workFinishedOn','')::date,
      rating_01=nullif(answers->>'rating01','')::smallint,rating_02=nullif(answers->>'rating02','')::smallint,
      rating_03=nullif(answers->>'rating03','')::smallint,rating_04=nullif(answers->>'rating04','')::smallint,
      rating_05=nullif(answers->>'rating05','')::smallint,rating_06=nullif(answers->>'rating06','')::smallint,
      rating_07=nullif(answers->>'rating07','')::smallint,rating_08=nullif(answers->>'rating08','')::smallint,
      rating_09=nullif(answers->>'rating09','')::smallint,rating_10=nullif(answers->>'rating10','')::smallint,
      comments=nullif(answers->>'comments',''),updated_at=now()
      where submission_id=survey.id;
    if (answers->>'internalEmployee')::boolean then
      if exists(select 1 from public.survey_attachments where submission_id=survey.id and revision_number=survey.revision_number and is_active) then
        insert into public.survey_audit_log(submission_id,organization_id,event_type,actor_id,actor_role,previous_values)
          select survey.id,survey.organization_id,'invoice_removed',viewer.id,viewer.role,
            jsonb_build_object('filenames',jsonb_agg(original_filename))
          from public.survey_attachments
          where submission_id=survey.id and revision_number=survey.revision_number and is_active;
      end if;
      delete from storage.objects where bucket_id='survey-invoices' and name in (
        select object_key from public.survey_attachments where submission_id=survey.id
          and revision_number=survey.revision_number and is_active
      );
      update public.survey_attachments set is_active=false,removed_by=viewer.id,removed_at=now()
        where submission_id=survey.id and revision_number=survey.revision_number and is_active;
    end if;
    select to_jsonb(response) - 'submission_id' - 'updated_at' into new_response
      from public.course_development_debrief_responses response where submission_id=survey.id;
  else
    select to_jsonb(response) - 'submission_id' - 'updated_at' into old_response
      from public.id_sme_review_responses response where submission_id=survey.id;
    update public.id_sme_review_responses set
      publication_year=coalesce((survey.context_snapshot->>'publicationYear')::integer,nullif(answers->>'publicationYear','')::integer),
      vertical=nullif(survey.context_snapshot->>'vertical',''),
      rating_01=nullif(answers->>'rating01','')::smallint,rating_02=nullif(answers->>'rating02','')::smallint,
      rating_03=nullif(answers->>'rating03','')::smallint,rating_04=nullif(answers->>'rating04','')::smallint,
      rating_05=nullif(answers->>'rating05','')::smallint,rating_06=nullif(answers->>'rating06','')::smallint,
      rating_07=nullif(answers->>'rating07','')::smallint,rating_08=nullif(answers->>'rating08','')::smallint,
      rating_09=nullif(answers->>'rating09','')::smallint,
      provided_real_world_examples=nullif(answers->>'providedRealWorldExamples','')::boolean,
      real_world_examples_effectiveness=case when (answers->>'providedRealWorldExamples')::boolean
        then nullif(answers->>'realWorldExamplesEffectiveness','')::smallint else null end,
      recommendation_score=nullif(answers->>'recommendationScore','')::smallint,
      comments=nullif(answers->>'comments',''),updated_at=now()
      where submission_id=survey.id;
    select to_jsonb(response) - 'submission_id' - 'updated_at' into new_response
      from public.id_sme_review_responses response where submission_id=survey.id;
  end if;

  update public.survey_submissions set last_edited_by=viewer.id,updated_at=now() where id=survey.id;
  if not submit_now then
    event_name:=case when survey.status='submitted' then 'edited_after_unlock' else 'draft_updated' end;
    insert into public.survey_audit_log(submission_id,organization_id,event_type,actor_id,actor_role,previous_values,new_values)
      values(survey.id,survey.organization_id,event_name,viewer.id,viewer.role,coalesce(old_response,'{}'),coalesce(new_response,'{}'));
    return jsonb_build_object('id',survey.id,'status',survey.status,'locked',false,'revision',survey.revision_number);
  end if;

  if survey.survey_type='course_development_debrief' then
    if (new_response->>'original_due_year') is null or (new_response->>'internal_employee') is null
      or (new_response->>'work_started_on') is null or (new_response->>'work_finished_on') is null
      or (new_response->>'work_started_on')::date>current_date
      or exists(select 1 from generate_series(1,10) number where new_response->>format('rating_%s',lpad(number::text,2,'0')) is null)
    then raise exception using errcode='23514',message='Complete every required debrief field before submitting.'; end if;
    if not (new_response->>'internal_employee')::boolean then
      if (new_response->>'billable_hours') is null or (new_response->>'amount_billed') is null then
        raise exception using errcode='23514',message='Billable hours and amount billed are required.';
      end if;
      select jsonb_build_object('id',id,'filename',original_filename,'mimeType',mime_type,'size',size_bytes)
        into active_invoice from public.survey_attachments
        where submission_id=survey.id and revision_number=survey.revision_number and is_active;
      if active_invoice is null then raise exception using errcode='23514',message='An invoice is required for an external SME.'; end if;
    end if;
  else
    if (new_response->>'publication_year') is null or (new_response->>'vertical') is null
      or (new_response->>'provided_real_world_examples') is null
      or (new_response->>'recommendation_score') is null
      or exists(select 1 from generate_series(1,9) number where new_response->>format('rating_%s',lpad(number::text,2,'0')) is null)
      or ((new_response->>'provided_real_world_examples')::boolean and (new_response->>'real_world_examples_effectiveness') is null)
    then raise exception using errcode='23514',message='Complete every required SME review field before submitting.'; end if;
  end if;

  is_resubmission:=survey.status='submitted';
  next_revision:=case when is_resubmission then survey.revision_number+1 else survey.revision_number end;
  if is_resubmission then
    update public.survey_attachments set revision_number=next_revision
      where submission_id=survey.id and revision_number=survey.revision_number and is_active;
  end if;
  insert into public.survey_revisions(
    submission_id,organization_id,revision_number,context_snapshot,response_snapshot,attachment_snapshot,
    changed_fields,submitted_by
  ) values (
    survey.id,survey.organization_id,next_revision,survey.context_snapshot,new_response,
    coalesce((select jsonb_agg(jsonb_build_object('id',id,'filename',original_filename,'mimeType',mime_type,'size',size_bytes))
      from public.survey_attachments where submission_id=survey.id and revision_number=next_revision and is_active),'[]'::jsonb),
    jsonb_build_object('before',coalesce(old_response,'{}'),'after',new_response),viewer.id
  );
  update public.survey_submissions set status='submitted',is_locked=true,revision_number=next_revision,
    original_submitted_at=coalesce(original_submitted_at,now()),latest_submitted_at=now(),
    locked_at=now(),locked_by=viewer.id,revision_assignee_id=null,updated_at=now()
    where id=survey.id;
  insert into public.survey_audit_log(submission_id,organization_id,event_type,actor_id,actor_role,previous_values,new_values)
    values(survey.id,survey.organization_id,case when is_resubmission then 'resubmitted' else 'submitted' end,
      viewer.id,viewer.role,coalesce(old_response,'{}'),new_response);
  return jsonb_build_object('id',survey.id,'status','submitted','locked',true,'revision',next_revision);
end;
$$;

create or replace function public.survey_unlock(
  target_submission_id uuid,
  unlock_reason_text text,
  assigned_reviser_id uuid default null
)
returns void language plpgsql security definer set search_path=public as $$
declare viewer public.application_users%rowtype; survey public.survey_submissions%rowtype;
begin
  select * into viewer from public.application_users where id=auth.uid();
  select * into survey from public.survey_submissions where id=target_submission_id for update;
  if not found or viewer.organization_id<>survey.organization_id or viewer.role not in ('super_admin','admin')
    or survey.status<>'submitted' or not survey.is_locked or length(btrim(coalesce(unlock_reason_text,'')))=0
  then raise exception using errcode='42501',message='Survey cannot be unlocked.'; end if;
  if assigned_reviser_id is not null and not exists(
    select 1 from public.application_users where id=assigned_reviser_id
      and organization_id=viewer.organization_id
      and (role='id' and survey.survey_type='id_sme_review')
  ) then raise exception using errcode='22023',message='The revision assignee is not eligible.'; end if;
  update public.survey_submissions set is_locked=false,unlocked_at=now(),unlocked_by=viewer.id,
    unlock_reason=btrim(unlock_reason_text),revision_assignee_id=assigned_reviser_id,updated_at=now()
    where id=survey.id;
  insert into public.survey_audit_log(submission_id,organization_id,event_type,actor_id,actor_role,reason,new_values)
    values(survey.id,survey.organization_id,'unlocked',viewer.id,viewer.role,btrim(unlock_reason_text),
      jsonb_build_object('revisionAssigneeId',assigned_reviser_id));
end;
$$;

create or replace function public.survey_relock(target_submission_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare viewer public.application_users%rowtype; survey public.survey_submissions%rowtype; snapshot jsonb;
begin
  select * into viewer from public.application_users where id=auth.uid();
  select * into survey from public.survey_submissions where id=target_submission_id for update;
  if not found or viewer.organization_id<>survey.organization_id or viewer.role not in ('super_admin','admin')
    or survey.is_locked
  then raise exception using errcode='42501',message='Survey cannot be relocked.'; end if;
  select response_snapshot into snapshot from public.survey_revisions
    where submission_id=survey.id and revision_number=survey.revision_number;
  if survey.survey_type='course_development_debrief' then
    update public.course_development_debrief_responses set
      original_due_year=(snapshot->>'original_due_year')::integer,internal_employee=(snapshot->>'internal_employee')::boolean,
      billable_hours=(snapshot->>'billable_hours')::numeric,amount_billed=(snapshot->>'amount_billed')::numeric,
      work_started_on=(snapshot->>'work_started_on')::date,work_finished_on=(snapshot->>'work_finished_on')::date,
      rating_01=(snapshot->>'rating_01')::smallint,rating_02=(snapshot->>'rating_02')::smallint,
      rating_03=(snapshot->>'rating_03')::smallint,rating_04=(snapshot->>'rating_04')::smallint,
      rating_05=(snapshot->>'rating_05')::smallint,rating_06=(snapshot->>'rating_06')::smallint,
      rating_07=(snapshot->>'rating_07')::smallint,rating_08=(snapshot->>'rating_08')::smallint,
      rating_09=(snapshot->>'rating_09')::smallint,rating_10=(snapshot->>'rating_10')::smallint,
      comments=snapshot->>'comments',updated_at=now() where submission_id=survey.id;
  else
    update public.id_sme_review_responses set
      publication_year=(snapshot->>'publication_year')::integer,vertical=snapshot->>'vertical',
      rating_01=(snapshot->>'rating_01')::smallint,rating_02=(snapshot->>'rating_02')::smallint,
      rating_03=(snapshot->>'rating_03')::smallint,rating_04=(snapshot->>'rating_04')::smallint,
      rating_05=(snapshot->>'rating_05')::smallint,rating_06=(snapshot->>'rating_06')::smallint,
      rating_07=(snapshot->>'rating_07')::smallint,rating_08=(snapshot->>'rating_08')::smallint,
      rating_09=(snapshot->>'rating_09')::smallint,
      provided_real_world_examples=(snapshot->>'provided_real_world_examples')::boolean,
      real_world_examples_effectiveness=(snapshot->>'real_world_examples_effectiveness')::smallint,
      recommendation_score=(snapshot->>'recommendation_score')::smallint,comments=snapshot->>'comments',
      updated_at=now() where submission_id=survey.id;
  end if;
  update public.survey_submissions set is_locked=true,locked_at=now(),locked_by=viewer.id,
    revision_assignee_id=null,updated_at=now() where id=survey.id;
  insert into public.survey_audit_log(submission_id,organization_id,event_type,actor_id,actor_role)
    values(survey.id,survey.organization_id,'relocked',viewer.id,viewer.role);
end;
$$;

create or replace function public.survey_assign_reviser(target_submission_id uuid, assigned_reviser_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare viewer public.application_users%rowtype; survey public.survey_submissions%rowtype; previous_id uuid;
begin
  select * into viewer from public.application_users where id=auth.uid();
  select * into survey from public.survey_submissions where id=target_submission_id for update;
  previous_id:=survey.revision_assignee_id;
  if not found or viewer.organization_id<>survey.organization_id or viewer.role not in ('super_admin','admin')
    or survey.survey_type<>'id_sme_review' or survey.status<>'submitted' or survey.is_locked
    or not exists(select 1 from public.application_users where id=assigned_reviser_id
      and organization_id=viewer.organization_id and role='id')
  then raise exception using errcode='42501',message='Revision access cannot be reassigned.'; end if;
  update public.survey_submissions set revision_assignee_id=assigned_reviser_id,updated_at=now() where id=survey.id;
  insert into public.survey_audit_log(submission_id,organization_id,event_type,actor_id,actor_role,previous_values,new_values)
    values(survey.id,survey.organization_id,'revision_access_reassigned',viewer.id,viewer.role,
      jsonb_build_object('revisionAssigneeId',previous_id),jsonb_build_object('revisionAssigneeId',assigned_reviser_id));
end;
$$;

create or replace function public.survey_correct_context(target_submission_id uuid, corrections jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare viewer public.application_users%rowtype; survey public.survey_submissions%rowtype; previous_context jsonb; next_context jsonb;
declare corrected_year integer; corrected_vertical text;
begin
  select * into viewer from public.application_users where id=auth.uid();
  select * into survey from public.survey_submissions where id=target_submission_id for update;
  if not found or viewer.organization_id<>survey.organization_id or viewer.role not in ('super_admin','admin')
    or survey.status<>'submitted' or survey.is_locked
  then raise exception using errcode='42501',message='Survey context cannot be corrected.'; end if;
  previous_context:=survey.context_snapshot;
  next_context:=previous_context;
  if survey.survey_type='course_development_debrief' then
    corrected_year:=nullif(corrections->>'originalDueYear','')::integer;
    if corrected_year not between 1000 and 9999 then raise exception using errcode='22023',message='Enter a valid four-digit original due year.'; end if;
    next_context:=jsonb_set(next_context,'{originalDueYear}',to_jsonb(corrected_year),true);
    update public.course_development_debrief_responses set original_due_year=corrected_year,updated_at=now() where submission_id=survey.id;
  else
    corrected_year:=nullif(corrections->>'publicationYear','')::integer;
    corrected_vertical:=nullif(corrections->>'vertical','');
    if corrected_year not between 1000 and 9999 then raise exception using errcode='22023',message='Enter a valid four-digit publication year.'; end if;
    if corrected_vertical not in ('P1A','FR1A','EMS1','C1A','LGU','D1A','Lexipol','Wellness','Cross Vertical','Other') then
      raise exception using errcode='22023',message='Select an approved survey Vertical.';
    end if;
    next_context:=jsonb_set(jsonb_set(next_context,'{publicationYear}',to_jsonb(corrected_year),true),'{vertical}',to_jsonb(corrected_vertical),true);
    update public.id_sme_review_responses set publication_year=corrected_year,vertical=corrected_vertical,updated_at=now() where submission_id=survey.id;
  end if;
  update public.survey_submissions set context_snapshot=next_context,last_edited_by=viewer.id,updated_at=now() where id=survey.id;
  insert into public.survey_audit_log(submission_id,organization_id,event_type,actor_id,actor_role,previous_values,new_values)
    values(survey.id,survey.organization_id,'context_corrected',viewer.id,viewer.role,previous_context,next_context);
end;
$$;

alter table public.survey_submissions enable row level security;
alter table public.course_development_debrief_responses enable row level security;
alter table public.id_sme_review_responses enable row level security;
alter table public.survey_attachments enable row level security;
alter table public.survey_revisions enable row level security;
alter table public.survey_audit_log enable row level security;

create policy "authorized survey read" on public.survey_submissions for select using (public.can_view_survey(id));
create policy "authorized debrief response read" on public.course_development_debrief_responses for select using (public.can_view_survey(submission_id));
create policy "authorized id review response read" on public.id_sme_review_responses for select using (public.can_view_survey(submission_id));
create policy "authorized survey attachment metadata read" on public.survey_attachments for select using (public.can_view_survey(submission_id));
create policy "authorized survey revision read" on public.survey_revisions for select using (public.can_view_survey(submission_id));
create policy "administrator survey audit read" on public.survey_audit_log for select using (
  public.can_view_survey(submission_id) and public.current_application_role() in ('super_admin','admin')
);

grant select on public.survey_submissions,public.course_development_debrief_responses,
  public.id_sme_review_responses,public.survey_revisions,public.survey_audit_log to authenticated;
grant select(id,submission_id,organization_id,revision_number,kind,original_filename,mime_type,size_bytes,
  uploaded_by,uploaded_at,is_active,removed_by,removed_at) on public.survey_attachments to authenticated;
grant all on public.survey_submissions,public.course_development_debrief_responses,
  public.id_sme_review_responses,public.survey_attachments,public.survey_revisions,public.survey_audit_log to service_role;

revoke all on function public.can_view_survey(uuid) from public;
revoke all on function public.can_edit_survey(uuid) from public;
revoke all on function public.survey_context_for_task(uuid,text) from public;
revoke all on function public.survey_create_or_resume(uuid,text,uuid) from public;
revoke all on function public.survey_save(uuid,jsonb,boolean) from public;
revoke all on function public.survey_unlock(uuid,text,uuid) from public;
revoke all on function public.survey_relock(uuid) from public;
revoke all on function public.survey_assign_reviser(uuid,uuid) from public;
revoke all on function public.survey_correct_context(uuid,jsonb) from public;
grant execute on function public.can_view_survey(uuid),public.can_edit_survey(uuid),
  public.survey_context_for_task(uuid,text),public.survey_create_or_resume(uuid,text,uuid),
  public.survey_save(uuid,jsonb,boolean),public.survey_unlock(uuid,text,uuid),
  public.survey_relock(uuid),public.survey_assign_reviser(uuid,uuid),
  public.survey_correct_context(uuid,jsonb) to authenticated,service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values (
  'survey-invoices','survey-invoices',false,10485760,
  array[
    'application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/png','image/jpeg'
  ]
)
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.can_access_survey_invoice(target_object_key text)
returns boolean language sql stable security definer set search_path=public,storage as $$
  select exists(
    select 1 from public.survey_attachments attachment
    where attachment.object_key=target_object_key and public.can_view_survey(attachment.submission_id)
  );
$$;
revoke all on function public.can_access_survey_invoice(text) from public;
grant execute on function public.can_access_survey_invoice(text) to authenticated,service_role;

drop policy if exists "authorized survey invoice read" on storage.objects;
create policy "authorized survey invoice read" on storage.objects for select to authenticated
  using (bucket_id='survey-invoices' and public.can_access_survey_invoice(name));

select pg_notify('pgrst','reload schema');
