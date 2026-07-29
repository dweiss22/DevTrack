-- Field-derived SME dashboard identities.
--
-- The SME custom-field value is authoritative for dashboard discovery and
-- project association. Wrike and application users are optional links to the
-- durable identity; neither is required for an identity or dashboard to exist.

create table public.sme_dashboard_identities (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  normalized_name text not null,
  display_name text not null,
  observed_names text[] not null default '{}',
  resolution_status text not null default 'discovered'
    check (resolution_status in ('discovered','verified','ambiguous','resolved')),
  ambiguity_reason text,
  wrike_user_id uuid,
  application_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,normalized_name),
  foreign key (wrike_user_id,organization_id)
    references public.wrike_users(id,organization_id) on delete restrict,
  foreign key (application_user_id)
    references public.application_users(id) on delete set null
);

create unique index one_sme_identity_per_wrike_user_idx
  on public.sme_dashboard_identities(organization_id,wrike_user_id)
  where wrike_user_id is not null;
create unique index one_sme_identity_per_application_user_idx
  on public.sme_dashboard_identities(organization_id,application_user_id)
  where application_user_id is not null;
create index sme_dashboard_identities_name_idx
  on public.sme_dashboard_identities(organization_id,display_name);

create table public.sme_dashboard_task_assignments (
  task_id uuid not null references public.wrike_tasks(id) on delete cascade,
  sme_identity_id uuid not null references public.sme_dashboard_identities(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  observed_name text not null,
  normalized_name text not null,
  source_has_conflict boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (task_id,sme_identity_id)
);
create index sme_dashboard_task_assignments_identity_idx
  on public.sme_dashboard_task_assignments(organization_id,sme_identity_id,task_id);

create table public.sme_dashboard_identity_link_audit (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sme_identity_id uuid references public.sme_dashboard_identities(id) on delete set null,
  actor_user_id uuid not null,
  application_user_id uuid not null,
  event_type text not null check (event_type in ('linked','relinked','unlinked','ambiguity_resolved')),
  previous_sme_identity_id uuid,
  previous_application_user_id uuid,
  confirmed_replacement boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (actor_user_id,organization_id)
    references public.application_user_principals(id,organization_id),
  foreign key (application_user_id,organization_id)
    references public.application_user_principals(id,organization_id)
);

create or replace function public.stable_sme_dashboard_identity_id(
  target_organization_id uuid,normalized_sme_name text
)
returns uuid
language sql
immutable
parallel safe
set search_path=public
as $$
  select (
    substr(hash,1,8)||'-'||substr(hash,9,4)||'-5'||substr(hash,14,3)||'-a'||
    substr(hash,18,3)||'-'||substr(hash,21,12)
  )::uuid
  from (select md5(target_organization_id::text||':sme-field:'||normalized_sme_name) hash) value;
$$;

create or replace function public.refresh_sme_dashboard_identities(
  target_organization_id uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if auth.role()<>'service_role' and target_organization_id<>public.current_organization_id() then
    raise exception using errcode='42501',message='SME identity refresh is unavailable.';
  end if;

  with observed as (
    select task.id task_id,token.value display_name,
      public.normalize_project_assignment_name(token.value) normalized_name,
      field_value.has_conflict
    from public.wrike_tasks task
    join public.wrike_task_normalized_custom_field_values field_value
      on field_value.task_id=task.id
      and cardinality(field_value.source_wrike_field_ids)>0
    join public.wrike_normalized_custom_fields field
      on field.id=field_value.normalized_field_id
      and field.organization_id=target_organization_id
      and field.normalized_key='sme'
    cross join lateral public.course_development_person_tokens(field_value.display_values) token
    where task.organization_id=target_organization_id
      and not task.is_deleted
      and public.normalize_project_assignment_name(token.value)<>''
  ), grouped as (
    select normalized_name,min(display_name) display_name,
      array_agg(distinct display_name order by display_name) observed_names,
      bool_or(has_conflict) source_conflict
    from observed group by normalized_name
  ), candidates as (
    select grouped.*,
      count(distinct identity.id) wrike_match_count,
      (array_agg(identity.id order by identity.id)
        filter(where identity.id is not null))[1] wrike_user_id
    from grouped
    left join public.wrike_users identity
      on identity.organization_id=target_organization_id
      and identity.is_active and not identity.is_unresolved
      and identity.identity_verified
      and public.normalize_project_assignment_name(identity.display_name)=grouped.normalized_name
    group by grouped.normalized_name,grouped.display_name,grouped.observed_names,grouped.source_conflict
  )
  insert into public.sme_dashboard_identities(
    id,organization_id,normalized_name,display_name,observed_names,
    resolution_status,ambiguity_reason,wrike_user_id,updated_at
  )
  select public.stable_sme_dashboard_identity_id(target_organization_id,normalized_name),
    target_organization_id,normalized_name,display_name,observed_names,
    case when source_conflict or wrike_match_count>1 then 'ambiguous'
      when wrike_match_count=1 then 'verified' else 'discovered' end,
    case when source_conflict then 'conflicting_sme_custom_field_sources'
      when wrike_match_count>1 then 'multiple_verified_wrike_name_matches' end,
    case when wrike_match_count=1 then wrike_user_id end,now()
  from candidates
  on conflict (organization_id,normalized_name) do update set
    observed_names=excluded.observed_names,
    display_name=case
      when sme_dashboard_identities.display_name=any(excluded.observed_names)
        then sme_dashboard_identities.display_name
      else excluded.display_name end,
    resolution_status=case
      when excluded.resolution_status='ambiguous'
        and sme_dashboard_identities.resolution_status<>'resolved' then 'ambiguous'
      when sme_dashboard_identities.resolution_status='resolved' then 'resolved'
      else excluded.resolution_status end,
    ambiguity_reason=case
      when sme_dashboard_identities.resolution_status='resolved' then null
      else excluded.ambiguity_reason end,
    wrike_user_id=coalesce(excluded.wrike_user_id,sme_dashboard_identities.wrike_user_id),
    updated_at=now();

  delete from public.sme_dashboard_task_assignments assignment
  where assignment.organization_id=target_organization_id;

  insert into public.sme_dashboard_task_assignments(
    task_id,sme_identity_id,organization_id,observed_name,normalized_name,
    source_has_conflict,updated_at
  )
  select distinct task.id,identity.id,target_organization_id,token.value,
    public.normalize_project_assignment_name(token.value),field_value.has_conflict,now()
  from public.wrike_tasks task
  join public.wrike_task_normalized_custom_field_values field_value
    on field_value.task_id=task.id
    and cardinality(field_value.source_wrike_field_ids)>0
  join public.wrike_normalized_custom_fields field
    on field.id=field_value.normalized_field_id
    and field.organization_id=target_organization_id
    and field.normalized_key='sme'
  cross join lateral public.course_development_person_tokens(field_value.display_values) token
  join public.sme_dashboard_identities identity
    on identity.organization_id=target_organization_id
    and identity.normalized_name=public.normalize_project_assignment_name(token.value)
  where task.organization_id=target_organization_id
    and not task.is_deleted
    and public.normalize_project_assignment_name(token.value)<>''
  on conflict (task_id,sme_identity_id) do update set
    observed_name=excluded.observed_name,
    normalized_name=excluded.normalized_name,
    source_has_conflict=excluded.source_has_conflict,
    updated_at=now();

  -- Attach legacy verified mappings without creating a second dashboard.
  update public.sme_dashboard_identities identity set
    application_user_id=mapped.application_user_id,updated_at=now()
  from (
    select distinct on (ranked.wrike_user_id)
      ranked.wrike_user_id,ranked.application_user_id
    from (
      select candidate.*,
        row_number() over(
          partition by candidate.application_user_id
          order by candidate.preference,candidate.updated_at desc,
            candidate.wrike_user_id
        ) application_preference
      from (
        select persona.wrike_user_id,persona.application_user_id,
          persona.updated_at,1 preference
        from public.application_user_operational_personas persona
        where persona.organization_id=target_organization_id
          and persona.operational_role='sme' and persona.is_active
          and persona.wrike_user_id is not null
        union all
        select member.wrike_user_id,member.id,member.updated_at,2
        from public.application_users member
        where member.organization_id=target_organization_id
          and member.role='sme' and member.wrike_user_id is not null
      ) candidate
    ) ranked
    where ranked.application_preference=1
    order by ranked.wrike_user_id,ranked.preference,ranked.updated_at desc
  ) mapped
  where identity.organization_id=target_organization_id
    and identity.wrike_user_id=mapped.wrike_user_id
    and (identity.application_user_id is null
      or identity.application_user_id=mapped.application_user_id);
end;
$$;

do $$
declare organization_record record;
begin
  for organization_record in select id from public.organizations loop
    perform public.refresh_sme_dashboard_identities(organization_record.id);
  end loop;
end;
$$;

create or replace function public.course_development_sme_identity_assignments(
  target_organization_id uuid
)
returns table(
  task_id uuid,sme_identity_id uuid,assignment_source text,
  source_has_conflict boolean
)
language sql
stable
security definer
set search_path=public
as $$
  select assignment.task_id,assignment.sme_identity_id,
    'sme_custom_field_name'::text,assignment.source_has_conflict
  from public.sme_dashboard_task_assignments assignment
  join public.sme_dashboard_identities identity
    on identity.id=assignment.sme_identity_id
    and identity.organization_id=target_organization_id
  where assignment.organization_id=target_organization_id
    and (
      auth.role()='service_role'
      or target_organization_id=public.current_organization_id()
    );
$$;

create or replace function public.current_sme_dashboard_identity()
returns uuid
language sql
stable
security definer
set search_path=public
as $$
  select identity.id
  from public.sme_dashboard_identities identity
  where identity.organization_id=public.current_organization_id()
    and identity.application_user_id=public.current_effective_user_id()
  limit 1;
$$;

create or replace function public.is_sme_identity_assigned(
  target_task_id uuid,target_sme_identity_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select target_sme_identity_id is not null and exists(
    select 1
    from public.sme_dashboard_task_assignments assignment
    join public.sme_dashboard_identities identity
      on identity.id=assignment.sme_identity_id
    where assignment.task_id=target_task_id
      and assignment.sme_identity_id=target_sme_identity_id
      and assignment.organization_id=public.current_organization_id()
      and not assignment.source_has_conflict
      and identity.resolution_status<>'ambiguous'
  );
$$;

drop function if exists public.reporting_sme_dashboard_identities();
create function public.reporting_sme_dashboard_identities()
returns table(
  identity_key text,sme_identity_id uuid,wrike_user_id uuid,
  application_user_id uuid,display_name text,email text,
  mapping_status text,identity_status text,selectable boolean
)
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  viewer public.application_users%rowtype;
  own_identity uuid;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  if viewer.id is null or not public.current_has_capability('view_sme_dashboard') then
    raise exception using errcode='42501',message='Dashboard is unavailable.';
  end if;
  own_identity:=public.current_sme_dashboard_identity();
  return query
  select 'sme:'||identity.id::text,identity.id,identity.wrike_user_id,
    identity.application_user_id,identity.display_name,wrike.email,
    case when identity.application_user_id is null then 'unmapped' else 'mapped' end,
    identity.resolution_status,
    identity.resolution_status<>'ambiguous'
  from public.sme_dashboard_identities identity
  left join public.wrike_users wrike on wrike.id=identity.wrike_user_id
  where identity.organization_id=viewer.organization_id
    and exists(
      select 1 from public.sme_dashboard_task_assignments assignment
      where assignment.sme_identity_id=identity.id
    )
    and (
      public.current_has_capability('select_sme_dashboard_user')
      or identity.id=own_identity
    )
  order by identity.display_name,identity.id;
end;
$$;

alter table public.survey_submissions
  add column if not exists sme_identity_id uuid
  references public.sme_dashboard_identities(id) on delete restrict;

create or replace function public.reporting_sme_dashboard_rows_by_identity(
  target_sme_identity_id uuid
)
returns table(
  task_id uuid,title text,status_name text,status_color text,
  status_classification text,reporting_year integer,start_date date,
  original_due_date date,due_date date,completed_at timestamptz,
  actual_minutes bigint,is_overdue boolean,
  subject_application_user_id uuid,submission_id uuid,survey_status text,
  survey_is_locked boolean,survey_can_edit boolean,is_recent boolean,
  submitted_billable_hours numeric,submitted_amount_billed numeric,
  submitted_at timestamptz
)
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  viewer public.application_users%rowtype;
  selected_identity uuid;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  if viewer.id is null or not public.current_has_capability('view_sme_dashboard') then
    raise exception using errcode='42501',message='Dashboard is unavailable.';
  end if;
  selected_identity:=case
    when public.current_has_capability('select_sme_dashboard_user')
      then target_sme_identity_id
    else public.current_sme_dashboard_identity()
  end;
  if selected_identity is null or not exists(
    select 1 from public.sme_dashboard_identities identity
    where identity.id=selected_identity
      and identity.organization_id=viewer.organization_id
      and identity.resolution_status<>'ambiguous'
  ) then return; end if;

  return query
  select task.id,task.title,coalesce(status.title,task.status),status.color,
    coalesce(status.dashboard_classification,'unclassified'),
    reporting.reporting_year,task.start_date,task.original_due_date,
    task.due_date,task.completed_at,
    coalesce((select sum(entry.minutes) from public.wrike_time_entries entry
      where entry.task_id=task.id and not entry.is_deleted),0)::bigint,
    task.completed_at is null and task.due_date<current_date,
    identity.application_user_id,survey.id,survey.status,survey.is_locked,
    case when survey.id is null then false else public.can_edit_survey(survey.id) end,
    case when task.completed_at is not null
      then task.completed_at::date>=current_date-interval '12 months'
      else task.due_date is not null
        and task.due_date>=current_date-interval '12 months' end,
    case when survey.status='submitted'
      and (public.current_has_management_role('admin')
        or public.current_has_management_role('super_admin'))
      and response.internal_employee=false then response.billable_hours end,
    case when survey.status='submitted'
      and (public.current_has_management_role('admin')
        or public.current_has_management_role('super_admin'))
      and response.internal_employee=false then response.amount_billed end,
    case when survey.status='submitted' then survey.latest_submitted_at end
  from public.sme_dashboard_task_assignments assignment
  join public.sme_dashboard_identities identity
    on identity.id=assignment.sme_identity_id
  join public.wrike_tasks task
    on task.id=assignment.task_id and not task.is_deleted
  left join public.wrike_workflow_statuses status
    on status.organization_id=task.organization_id
    and status.wrike_id=task.custom_status_id
  left join lateral (
    select value.reporting_year
    from public.wrike_task_normalized_custom_field_values value
    join public.wrike_normalized_custom_fields field
      on field.id=value.normalized_field_id
    where value.task_id=task.id
      and field.normalized_key in ('reporting','reporting year')
      and not value.has_conflict
    limit 1
  ) reporting on true
  left join public.survey_submissions survey
    on survey.organization_id=viewer.organization_id
    and survey.task_id=task.id
    and survey.survey_type='course_development_debrief'
    and (
      survey.sme_identity_id=selected_identity
      or (
        survey.sme_identity_id is null
        and survey.reviewed_wrike_user_id=identity.wrike_user_id
      )
    )
  left join public.course_development_debrief_responses response
    on response.submission_id=survey.id
  where assignment.organization_id=viewer.organization_id
    and assignment.sme_identity_id=selected_identity
    and not assignment.source_has_conflict
  order by task.completed_at nulls first,task.due_date nulls last,task.title;
end;
$$;

-- Survey rows retain the durable SME identity in addition to the optional
-- legacy Wrike reference. Existing records are backfilled without changing
-- ownership, creators, subjects, or response data.
alter table public.survey_submissions
  add column if not exists sme_identity_id uuid
  references public.sme_dashboard_identities(id) on delete restrict;

update public.survey_submissions survey set sme_identity_id=matched.sme_identity_id
from (
  select distinct on (survey_row.id) survey_row.id,identity.id sme_identity_id
  from public.survey_submissions survey_row
  join public.sme_dashboard_task_assignments assignment
    on assignment.task_id=survey_row.task_id
  join public.sme_dashboard_identities identity
    on identity.id=assignment.sme_identity_id
    and identity.organization_id=survey_row.organization_id
    and identity.wrike_user_id=survey_row.reviewed_wrike_user_id
  order by survey_row.id,identity.id
) matched
where survey.id=matched.id and survey.sme_identity_id is null;

do $$
declare constraint_record record;
begin
  for constraint_record in
    select constraint_name
    from information_schema.check_constraints check_row
    join information_schema.table_constraints table_row
      using(constraint_schema,constraint_name)
    where table_row.table_schema='public'
      and table_row.table_name='survey_submissions'
      and check_row.check_clause ilike '%reviewed_wrike_user_id%'
      and check_row.check_clause ilike '%survey_type%'
  loop
    execute format('alter table public.survey_submissions drop constraint %I',
      constraint_record.constraint_name);
  end loop;
end;
$$;

alter table public.survey_submissions
  add constraint survey_submissions_sme_identity_check check (
    (
      survey_type='course_development_debrief'
      and subject_application_user_id is not null
      and (sme_identity_id is not null or reviewed_wrike_user_id is not null)
    ) or (
      survey_type='id_sme_review'
      and (sme_identity_id is not null or reviewed_wrike_user_id is not null)
    )
  );
create index survey_submissions_sme_identity_idx
  on public.survey_submissions(organization_id,sme_identity_id,updated_at desc);
create unique index survey_id_review_sme_identity_idx
  on public.survey_submissions(
    organization_id,task_id,sme_identity_id,created_by,survey_type
  )
  where survey_type='id_sme_review' and sme_identity_id is not null;

create or replace function public.can_view_survey(target_submission_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1
    from public.survey_submissions survey
    join public.application_users viewer
      on viewer.id=public.current_effective_user_id()
      and viewer.organization_id=survey.organization_id
      and viewer.account_state='active'
    where survey.id=target_submission_id
      and (
        public.current_has_management_role('admin')
        or public.current_has_management_role('super_admin')
        or (
          survey.survey_type='course_development_debrief'
          and survey.status='draft'
          and survey.subject_application_user_id=viewer.id
          and public.survey_sme_status_available(survey.task_id)
          and public.current_has_operational_role('sme')
          and public.is_sme_identity_assigned(
            survey.task_id,public.current_sme_dashboard_identity()
          )
        )
        or (
          survey.survey_type='id_sme_review'
          and survey.created_by=viewer.id
          and public.current_has_operational_role('id')
          and public.is_course_development_person_assigned(
            survey.task_id,'id',public.current_operational_identity('id')
          )
        )
      )
  );
$$;

create or replace function public.can_edit_survey(target_submission_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1
    from public.survey_submissions survey
    join public.application_users viewer
      on viewer.id=public.current_effective_user_id()
      and viewer.organization_id=survey.organization_id
      and viewer.account_state='active'
    where survey.id=target_submission_id
      and not survey.is_locked
      and (
        public.current_has_management_role('admin')
        or public.current_has_management_role('super_admin')
        or (
          survey.survey_type='course_development_debrief'
          and survey.status='draft'
          and survey.subject_application_user_id=viewer.id
          and public.survey_sme_status_available(survey.task_id)
          and public.current_has_operational_role('sme')
          and public.is_sme_identity_assigned(
            survey.task_id,public.current_sme_dashboard_identity()
          )
        )
        or (
          survey.survey_type='id_sme_review'
          and public.current_has_operational_role('id')
          and public.is_course_development_person_assigned(
            survey.task_id,'id',public.current_operational_identity('id')
          )
          and (
            (survey.status='draft' and survey.created_by=viewer.id)
            or (
              survey.status='submitted'
              and (survey.created_by=viewer.id
                or survey.revision_assignee_id=viewer.id)
            )
          )
        )
      )
  );
$$;

create or replace function public.survey_sme_submission_receipt(
  target_task_id uuid
)
returns timestamptz
language sql
stable
security definer
set search_path=public
as $$
  select survey.latest_submitted_at
  from public.survey_submissions survey
  join public.application_users viewer
    on viewer.id=public.current_effective_user_id()
    and viewer.organization_id=survey.organization_id
    and viewer.account_state='active'
  where survey.task_id=target_task_id
    and survey.survey_type='course_development_debrief'
    and survey.status='submitted'
    and survey.subject_application_user_id=viewer.id
    and survey.sme_identity_id=public.current_sme_dashboard_identity()
    and public.current_has_operational_role('sme')
    and public.is_sme_identity_assigned(
      survey.task_id,public.current_sme_dashboard_identity()
    )
  limit 1;
$$;

create or replace function public.survey_personal_create_or_resume_for_sme_identity(
  target_task_id uuid,target_sme_identity_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  viewer public.application_users%rowtype;
  identity public.sme_dashboard_identities%rowtype;
  existing_id uuid;
  context jsonb;
  version public.survey_template_versions%rowtype;
  created_id uuid;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  if viewer.id is null or not public.current_has_operational_role('id')
    or target_sme_identity_id is null
    or not public.is_course_development_person_assigned(
      target_task_id,'id',public.current_operational_identity('id')
    ) then
    raise exception using errcode='42501',message='Survey context is unavailable.';
  end if;
  select * into identity from public.sme_dashboard_identities
  where id=target_sme_identity_id
    and organization_id=viewer.organization_id
    and resolution_status<>'ambiguous';
  if identity.id is null or not public.is_sme_identity_assigned(
    target_task_id,identity.id
  ) then
    raise exception using errcode='42501',message='Survey context is unavailable.';
  end if;
  select survey.id into existing_id
  from public.survey_submissions survey
  where survey.organization_id=viewer.organization_id
    and survey.task_id=target_task_id
    and survey.survey_type='id_sme_review'
    and survey.sme_identity_id=identity.id
    and survey.created_by=viewer.id;
  if existing_id is not null then return existing_id; end if;
  select published.* into version
  from public.survey_template_versions published
  join public.survey_templates template on template.id=published.template_id
  where published.organization_id=viewer.organization_id
    and published.survey_type='id_sme_review'
    and template.archived_at is null
  order by published.version_number desc limit 1;
  if version.id is null then
    raise exception using errcode='42501',message='Survey context is unavailable.';
  end if;
  context:=public.survey_context_for_task(target_task_id,'id_sme_review')
    ||jsonb_build_object('reviewedSme',jsonb_build_object(
      'smeIdentityId',identity.id,'wrikeUserId',identity.wrike_user_id,
      'name',identity.display_name
    ));
  insert into public.survey_submissions(
    organization_id,survey_type,task_id,project_id,task_wrike_id,
    subject_application_user_id,reviewed_wrike_user_id,sme_identity_id,
    created_by,last_edited_by,context_snapshot,survey_version_id,
    definition_snapshot,answers
  ) values (
    viewer.organization_id,'id_sme_review',target_task_id,
    nullif(context->>'projectId','')::uuid,context->>'taskWrikeId',
    null,identity.wrike_user_id,identity.id,viewer.id,viewer.id,context,
    version.id,version.definition,'{}'::jsonb
  ) returning id into created_id;
  insert into public.id_sme_review_responses(submission_id) values(created_id);
  insert into public.survey_audit_log(
    submission_id,organization_id,event_type,actor_id,actor_role,new_values
  ) values (
    created_id,viewer.organization_id,'draft_created',viewer.id,viewer.role,
    jsonb_build_object('surveyVersion',version.version_number,
      'smeIdentityId',identity.id)
  );
  return created_id;
end;
$$;

create or replace function public.survey_personal_create_or_resume_sme_debrief(
  target_task_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  viewer public.application_users%rowtype;
  identity public.sme_dashboard_identities%rowtype;
  submission_id_value uuid;
  context jsonb;
  version public.survey_template_versions%rowtype;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  select * into identity from public.sme_dashboard_identities
  where organization_id=viewer.organization_id
    and application_user_id=viewer.id
    and resolution_status<>'ambiguous';
  if viewer.id is null or not public.current_has_operational_role('sme')
    or identity.id is null
    or not public.is_sme_identity_assigned(target_task_id,identity.id)
    or not public.survey_sme_status_available(target_task_id) then
    raise exception using errcode='42501',message='Survey context is unavailable.';
  end if;
  select survey.id into submission_id_value
  from public.survey_submissions survey
  where survey.organization_id=viewer.organization_id
    and survey.task_id=target_task_id
    and survey.survey_type='course_development_debrief'
    and survey.subject_application_user_id=viewer.id;
  if submission_id_value is not null and exists(
    select 1 from public.survey_submissions survey
    where survey.id=submission_id_value and survey.status='submitted'
  ) then
    raise exception using errcode='42501',message='Survey context is unavailable.';
  end if;
  if submission_id_value is null then
    select published.* into version
    from public.survey_template_versions published
    join public.survey_templates template on template.id=published.template_id
    where published.organization_id=viewer.organization_id
      and published.survey_type='course_development_debrief'
      and template.archived_at is null
    order by published.version_number desc limit 1;
    if version.id is null then
      raise exception using errcode='42501',message='Survey context is unavailable.';
    end if;
    context:=public.survey_context_for_task(
      target_task_id,'course_development_debrief'
    )||jsonb_build_object('subject',jsonb_build_object(
      'applicationUserId',viewer.id,'smeIdentityId',identity.id,
      'wrikeUserId',identity.wrike_user_id,'name',identity.display_name
    ));
    insert into public.survey_submissions(
      organization_id,survey_type,task_id,project_id,task_wrike_id,
      subject_application_user_id,reviewed_wrike_user_id,sme_identity_id,
      created_by,last_edited_by,context_snapshot,survey_version_id,
      definition_snapshot,answers
    ) values (
      viewer.organization_id,'course_development_debrief',target_task_id,
      nullif(context->>'projectId','')::uuid,context->>'taskWrikeId',
      viewer.id,identity.wrike_user_id,identity.id,viewer.id,viewer.id,context,
      version.id,version.definition,'{}'::jsonb
    ) returning id into submission_id_value;
    insert into public.course_development_debrief_responses(submission_id)
      values(submission_id_value);
    insert into public.survey_audit_log(
      submission_id,organization_id,event_type,actor_id,actor_role,new_values
    ) values (
      submission_id_value,viewer.organization_id,'draft_created',viewer.id,viewer.role,
      jsonb_build_object('surveyVersion',version.version_number,
        'smeIdentityId',identity.id)
    );
  end if;
  perform public.refresh_sme_debrief_draft_context(submission_id_value);
  return submission_id_value;
end;
$$;

create or replace function public.sme_debrief_configuration(
  target_task_id uuid,target_application_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  viewer public.application_users%rowtype;
  subject public.application_users%rowtype;
  identity public.sme_dashboard_identities%rowtype;
  task_record public.wrike_tasks%rowtype;
  classification_value text;
  reporting_year_count integer;
  reporting_year_value integer;
  status_name text;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  select * into subject from public.application_users
  where id=target_application_user_id
    and organization_id=viewer.organization_id and account_state='active';
  if viewer.id is null or subject.id is null or (
    viewer.id<>subject.id and not (
      public.current_has_management_role('admin')
      or public.current_has_management_role('super_admin')
      or public.current_has_management_role('sme_coordinator')
    )
  ) then
    return jsonb_build_object('ok',false,'code','unavailable',
      'message','Survey context is unavailable.');
  end if;
  select * into identity from public.sme_dashboard_identities
  where organization_id=subject.organization_id
    and application_user_id=subject.id;
  if identity.id is null then
    return jsonb_build_object('ok',false,'code','sme_identity_link_missing',
      'message','An administrator must link this account to its project-field SME identity.');
  end if;
  if identity.resolution_status='ambiguous' then
    return jsonb_build_object('ok',false,'code','sme_identity_ambiguous',
      'message','An administrator must confirm the ambiguous SME identity match.');
  end if;
  select * into task_record from public.wrike_tasks
  where id=target_task_id and organization_id=subject.organization_id
    and not is_deleted;
  if task_record.id is null
    or not public.is_sme_identity_assigned(target_task_id,identity.id) then
    return jsonb_build_object('ok',false,'code','assignment_missing',
      'message','The imported SME field does not assign this account to the project.');
  end if;
  select profile.classification into classification_value
  from public.application_user_sme_profiles profile
  where profile.application_user_id=subject.id
    and profile.organization_id=subject.organization_id;
  select count(distinct value.reporting_year),min(value.reporting_year)
  into reporting_year_count,reporting_year_value
  from public.wrike_task_normalized_custom_field_values value
  join public.wrike_normalized_custom_fields field
    on field.id=value.normalized_field_id
    and field.organization_id=subject.organization_id
  where value.task_id=target_task_id
    and field.normalized_key in ('reporting','reporting year')
    and cardinality(value.source_wrike_field_ids)>0
    and not value.has_conflict and value.reporting_year is not null;
  select coalesce(status.title,task_record.status) into status_name
  from (select 1) seed
  left join public.wrike_workflow_statuses status
    on status.organization_id=subject.organization_id
    and status.wrike_id=task_record.custom_status_id;
  if classification_value is null then
    return jsonb_build_object(
      'ok',false,'code','classification_missing',
      'message','SME type is not configured. Ask an administrator to select Internal SME or External SME.',
      'context',jsonb_build_object(
        'taskTitle',task_record.title,'status',status_name,
        'subject',jsonb_build_object(
          'applicationUserId',subject.id,'smeIdentityId',identity.id,
          'name',identity.display_name
        ),
        'reportingYear',case when reporting_year_count=1
          then reporting_year_value end
      )
    );
  end if;
  if reporting_year_count<>1 then
    return jsonb_build_object(
      'ok',false,'code','reporting_year_missing',
      'message','The project must have one unambiguous Wrike Reporting Year before this survey can be submitted.',
      'context',jsonb_build_object(
        'taskTitle',task_record.title,'status',status_name,
        'smeClassification',classification_value,
        'subject',jsonb_build_object(
          'applicationUserId',subject.id,'smeIdentityId',identity.id,
          'name',identity.display_name
        )
      )
    );
  end if;
  return jsonb_build_object(
    'ok',true,'code','ready','message',null,
    'context',jsonb_build_object(
      'taskTitle',task_record.title,'status',status_name,
      'reportingYear',reporting_year_value,
      'smeClassification',classification_value,
      'internalEmployee',classification_value='internal',
      'subject',jsonb_build_object(
        'applicationUserId',subject.id,'smeIdentityId',identity.id,
        'wrikeUserId',null,'name',identity.display_name
      )
    )
  );
end;
$$;

create or replace function public.sme_project_detail_by_identity(
  target_task_id uuid,target_sme_identity_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  viewer public.application_users%rowtype;
  selected_identity public.sme_dashboard_identities%rowtype;
  task_record public.wrike_tasks%rowtype;
  result jsonb;
  debrief jsonb;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  if viewer.id is null or not public.current_has_capability('view_sme_dashboard') then
    return jsonb_build_object('state','unavailable');
  end if;
  if public.current_has_capability('select_sme_dashboard_user') then
    select * into selected_identity from public.sme_dashboard_identities
    where id=target_sme_identity_id
      and organization_id=viewer.organization_id;
    if selected_identity.id is null then
      return jsonb_build_object('state','selection_required');
    end if;
  else
    select * into selected_identity from public.sme_dashboard_identities
    where id=public.current_sme_dashboard_identity()
      and organization_id=viewer.organization_id;
    if selected_identity.id is null then
      return jsonb_build_object('state','mapping_missing');
    end if;
  end if;
  if selected_identity.resolution_status='ambiguous' then
    return jsonb_build_object('state','identity_unavailable');
  end if;
  if not public.is_sme_identity_assigned(target_task_id,selected_identity.id) then
    return jsonb_build_object('state','not_assigned');
  end if;
  select * into task_record from public.wrike_tasks
  where id=target_task_id and organization_id=viewer.organization_id
    and not is_deleted;
  if task_record.id is null then
    return jsonb_build_object('state','not_found');
  end if;
  select case when survey.status='submitted'
    and not public.current_has_capability('view_sme_survey_details')
    then jsonb_build_object(
      'status','submitted','latestSubmittedAt',survey.latest_submitted_at
    ) else jsonb_build_object(
      'id',survey.id,'status',survey.status,'isLocked',survey.is_locked,
      'canEdit',public.can_edit_survey(survey.id),
      'revisionNumber',survey.revision_number,
      'firstSubmittedAt',survey.original_submitted_at,
      'latestSubmittedAt',survey.latest_submitted_at,
      'response',jsonb_build_object(
        'internalEmployee',survey.answers->'internalEmployee',
        'billableHours',case when survey.status='submitted'
          then survey.answers->'billableHours' end,
        'amountBilled',case when survey.status='submitted'
          then survey.answers->'amountBilled' end,
        'workStartedOn',survey.answers->'workStartedOn',
        'workFinishedOn',survey.answers->'workFinishedOn',
        'ratings',jsonb_build_array(
          survey.answers#>'{collaborationRatings,rating01}',
          survey.answers#>'{collaborationRatings,rating02}',
          survey.answers#>'{collaborationRatings,rating03}',
          survey.answers#>'{collaborationRatings,rating04}',
          survey.answers#>'{collaborationRatings,rating05}',
          survey.answers#>'{collaborationRatings,rating06}',
          survey.answers#>'{collaborationRatings,rating07}',
          survey.answers#>'{collaborationRatings,rating08}',
          survey.answers#>'{collaborationRatings,rating09}',
          survey.answers#>'{collaborationRatings,rating10}'
        ),
        'comments',survey.answers->'comments'
      ),
      'attachments',case
        when public.current_has_capability('view_sme_survey_details')
        then coalesce((
          select jsonb_agg(jsonb_build_object(
            'id',attachment.id,'filename',attachment.original_filename,
            'sizeBytes',attachment.size_bytes,
            'uploadedAt',attachment.uploaded_at
          ) order by attachment.uploaded_at desc)
          from public.survey_attachments attachment
          where attachment.submission_id=survey.id and attachment.is_active
        ),'[]'::jsonb) else '[]'::jsonb end
    ) end into debrief
  from public.survey_submissions survey
  where survey.organization_id=viewer.organization_id
    and survey.task_id=target_task_id
    and survey.survey_type='course_development_debrief'
    and survey.sme_identity_id=selected_identity.id;

  select jsonb_build_object(
    'state','allowed',
    'taskId',task_record.id,
    'title',task_record.title,
    'status',coalesce(status.title,task_record.status),
    'statusColor',status.color,
    'reportingYear',reporting.reporting_year,
    'assignedIds',coalesce(ids.items,'[]'::jsonb),
    'vertical',course.vertical_value,
    'courseLength',course.course_length,
    'legalReviewer',course.legal_reviewer,
    'debrief',debrief,
    'finalizedDraft',coalesce(draft.value,jsonb_build_object('available',false)),
    'timeline',jsonb_build_object(
      'startDate',task_record.start_date,
      'originalDueDate',task_record.original_due_date,
      'dueDate',task_record.due_date,
      'completedAt',task_record.completed_at
    ),
    'categoryTime',coalesce(time_data.items,'[]'::jsonb),
    'subjectApplicationUserId',selected_identity.application_user_id,
    'isRecent',case when task_record.completed_at is not null
      then task_record.completed_at::date>=current_date-interval '12 months'
      else task_record.due_date is not null
        and task_record.due_date>=current_date-interval '12 months' end,
    'selectedSmeIdentityId',selected_identity.id,
    'selectedSmeWrikeUserId',null
  ) into result
  from (select 1) seed
  left join public.wrike_workflow_statuses status
    on status.organization_id=viewer.organization_id
    and status.wrike_id=task_record.custom_status_id
  left join lateral (
    select value.reporting_year
    from public.wrike_task_normalized_custom_field_values value
    join public.wrike_normalized_custom_fields field
      on field.id=value.normalized_field_id
    where value.task_id=task_record.id
      and field.normalized_key in ('reporting','reporting year')
      and not value.has_conflict limit 1
  ) reporting on true
  left join lateral (
    select
      max(value.vertical_reporting_category)
        filter(where field.normalized_key='vertical'
          and not value.has_conflict and not value.has_unresolved_vertical)
        vertical_value,
      max(array_to_string(value.display_values,', '))
        filter(where field.normalized_key in (
          'course length','course duration','estimated course length'
        ) and not value.has_conflict) course_length,
      max(array_to_string(value.display_values,', '))
        filter(where field.normalized_key='legal reviewer'
          and not value.has_conflict) legal_reviewer
    from public.wrike_task_normalized_custom_field_values value
    join public.wrike_normalized_custom_fields field
      on field.id=value.normalized_field_id
    where value.task_id=task_record.id
  ) course on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'wrikeUserId',identity.id,'name',identity.display_name
    ) order by identity.display_name) items
    from public.course_development_person_assignments(
      viewer.organization_id,'id'
    ) assignment
    join public.wrike_users identity on identity.id=assignment.wrike_user_id
    where assignment.task_id=task_record.id
  ) ids on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'category',grouped.category_name,'minutes',grouped.minutes
    ) order by grouped.minutes desc,grouped.category_name) items
    from (
      select coalesce(category.title,'Uncategorized') category_name,
        sum(entry.minutes)::bigint minutes
      from public.wrike_time_entries entry
      left join public.wrike_timelog_categories category
        on category.organization_id=viewer.organization_id
        and category.wrike_id=entry.category
      where entry.task_id=task_record.id and not entry.is_deleted
      group by coalesce(category.title,'Uncategorized')
    ) grouped
  ) time_data on true
  left join lateral (
    select jsonb_build_object(
      'available',stored.url is not null,
      'url',stored.url,'updatedAt',stored.updated_at
    ) value
    from public.project_finalized_course_drafts stored
    where stored.organization_id=viewer.organization_id
      and stored.task_id=task_record.id
  ) draft on true;
  return result;
end;
$$;

create or replace function public.link_application_user_sme_identity(
  target_organization_id uuid,target_application_user_id uuid,
  target_sme_identity_id uuid,acting_user_id uuid,
  confirm_replacement boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  actor public.application_users%rowtype;
  target public.application_users%rowtype;
  identity public.sme_dashboard_identities%rowtype;
  previous_identity_id uuid;
  previous_application_user_id uuid;
  event_name text;
begin
  select * into actor from public.application_users
  where id=acting_user_id
    and organization_id=target_organization_id and account_state='active';
  if actor.id is null or not (
    actor.role in ('admin','super_admin')
    or exists(
      select 1 from public.application_user_management_roles role_grant
      where role_grant.application_user_id=actor.id
        and role_grant.organization_id=actor.organization_id
        and role_grant.management_role in ('admin','super_admin')
        and role_grant.is_active
    )
  ) then
    raise exception using errcode='42501',
      message='SME identity linking is unavailable.';
  end if;
  select * into target from public.application_users
  where id=target_application_user_id
    and organization_id=target_organization_id and account_state='active';
  if target.id is null or not (
    target.role='sme' or exists(
      select 1 from public.application_user_operational_personas persona
      where persona.application_user_id=target.id
        and persona.organization_id=target.organization_id
        and persona.operational_role='sme' and persona.is_active
    )
  ) then
    raise exception using errcode='23514',
      message='Select an active application user with SME access.';
  end if;
  select * into identity from public.sme_dashboard_identities
  where id=target_sme_identity_id
    and organization_id=target_organization_id for update;
  if identity.id is null then
    raise exception using errcode='23514',
      message='Select a discovered SME field identity.';
  end if;
  select existing.id into previous_identity_id
  from public.sme_dashboard_identities existing
  where existing.organization_id=target_organization_id
    and existing.application_user_id=target.id
    and existing.id<>identity.id
  for update;
  previous_application_user_id:=identity.application_user_id;
  if (
    previous_identity_id is not null
    or (
      previous_application_user_id is not null
      and previous_application_user_id<>target.id
    )
    or identity.resolution_status='ambiguous'
  ) and not confirm_replacement then
    raise exception using errcode='P0001',
      message='Confirmation is required to replace or resolve this SME identity linkage.',
      detail=jsonb_build_object(
        'confirmationRequired',true,
        'previousSmeIdentityId',previous_identity_id,
        'previousApplicationUserId',previous_application_user_id,
        'ambiguous',identity.resolution_status='ambiguous'
      )::text;
  end if;
  if previous_identity_id is not null then
    update public.sme_dashboard_identities set
      application_user_id=null,updated_at=now()
    where id=previous_identity_id;
  end if;
  if previous_application_user_id is not null
    and previous_application_user_id<>target.id then
    update public.sme_dashboard_identities set
      application_user_id=null,updated_at=now()
    where id=identity.id;
    update public.application_user_operational_personas set
      wrike_user_id=null,updated_by=actor.id,updated_at=now()
    where organization_id=target_organization_id
      and application_user_id=previous_application_user_id
      and operational_role='sme' and is_active;
    update public.application_users set wrike_user_id=null,updated_at=now()
    where id=previous_application_user_id
      and organization_id=target_organization_id and role='sme';
  end if;
  update public.sme_dashboard_identities set
    application_user_id=target.id,
    resolution_status=case when resolution_status='ambiguous'
      then 'resolved' else resolution_status end,
    ambiguity_reason=case when resolution_status='ambiguous'
      then null else ambiguity_reason end,
    updated_at=now()
  where id=identity.id;
  if not exists(
    select 1 from public.application_user_operational_personas persona
    where persona.organization_id=target_organization_id
      and persona.application_user_id=target.id
      and persona.operational_role='sme' and persona.is_active
  ) then
    insert into public.application_user_operational_personas(
      organization_id,application_user_id,operational_role,wrike_user_id,
      created_by,updated_by
    ) values (
      target_organization_id,target.id,'sme',identity.wrike_user_id,
      actor.id,actor.id
    );
  else
    update public.application_user_operational_personas set
      wrike_user_id=identity.wrike_user_id,updated_by=actor.id,updated_at=now()
    where organization_id=target_organization_id
      and application_user_id=target.id
      and operational_role='sme' and is_active;
  end if;
  update public.application_users set
    wrike_user_id=identity.wrike_user_id,updated_at=now()
  where id=target.id and organization_id=target_organization_id
    and role='sme';
  event_name:=case
    when identity.resolution_status='ambiguous' then 'ambiguity_resolved'
    when previous_identity_id is not null
      or (previous_application_user_id is not null
        and previous_application_user_id<>target.id)
      then 'relinked'
    else 'linked' end;
  insert into public.sme_dashboard_identity_link_audit(
    organization_id,sme_identity_id,actor_user_id,application_user_id,
    event_type,previous_sme_identity_id,previous_application_user_id,
    confirmed_replacement
  ) values (
    target_organization_id,identity.id,actor.id,target.id,event_name,
    previous_identity_id,previous_application_user_id,confirm_replacement
  );
  return jsonb_build_object(
    'ok',true,'smeIdentityId',identity.id,
    'applicationUserId',target.id,'status','linked',
    'preservedProjectHistory',true,'preservedSurveyHistory',true
  );
end;
$$;

alter table public.sme_dashboard_identities enable row level security;
alter table public.sme_dashboard_task_assignments enable row level security;
alter table public.sme_dashboard_identity_link_audit enable row level security;

create policy "administrators read sme dashboard identities"
on public.sme_dashboard_identities for select
using (
  organization_id=public.current_organization_id()
  and (
    public.current_has_management_role('admin')
    or public.current_has_management_role('super_admin')
  )
);
create policy "administrators read sme identity link audit"
on public.sme_dashboard_identity_link_audit for select
using (
  organization_id=public.current_organization_id()
  and (
    public.current_has_management_role('admin')
    or public.current_has_management_role('super_admin')
  )
);

revoke all on public.sme_dashboard_identities,
  public.sme_dashboard_task_assignments,
  public.sme_dashboard_identity_link_audit from anon,authenticated;
grant all on public.sme_dashboard_identities,
  public.sme_dashboard_task_assignments,
  public.sme_dashboard_identity_link_audit to service_role;

revoke all on function public.stable_sme_dashboard_identity_id(uuid,text),
  public.refresh_sme_dashboard_identities(uuid),
  public.course_development_sme_identity_assignments(uuid),
  public.current_sme_dashboard_identity(),
  public.is_sme_identity_assigned(uuid,uuid),
  public.reporting_sme_dashboard_identities(),
  public.reporting_sme_dashboard_rows_by_identity(uuid),
  public.survey_personal_create_or_resume_for_sme_identity(uuid,uuid),
  public.survey_personal_create_or_resume_sme_debrief(uuid),
  public.sme_debrief_configuration(uuid,uuid),
  public.sme_project_detail_by_identity(uuid,uuid),
  public.link_application_user_sme_identity(uuid,uuid,uuid,uuid,boolean)
from public;

grant execute on function
  public.course_development_sme_identity_assignments(uuid),
  public.current_sme_dashboard_identity(),
  public.is_sme_identity_assigned(uuid,uuid),
  public.reporting_sme_dashboard_identities(),
  public.reporting_sme_dashboard_rows_by_identity(uuid),
  public.survey_personal_create_or_resume_for_sme_identity(uuid,uuid),
  public.survey_personal_create_or_resume_sme_debrief(uuid),
  public.sme_debrief_configuration(uuid,uuid),
  public.sme_project_detail_by_identity(uuid,uuid)
to authenticated,service_role;
grant execute on function
  public.stable_sme_dashboard_identity_id(uuid,text),
  public.refresh_sme_dashboard_identities(uuid),
  public.link_application_user_sme_identity(uuid,uuid,uuid,uuid,boolean)
to service_role;

comment on table public.sme_dashboard_identities is
  'Durable SME dashboards discovered from imported SME custom-field names. Wrike and application users are optional links.';
comment on function public.refresh_sme_dashboard_identities(uuid) is
  'Discovers every non-empty SME custom-field token, groups only equal normalized names, preserves display spellings, and flags source conflicts or multiple verified Wrike matches.';
comment on function public.link_application_user_sme_identity(uuid,uuid,uuid,uuid,boolean) is
  'Links an application SME to durable field-derived history. Replacement and ambiguity resolution require explicit confirmation and are audited.';

select pg_notify('pgrst','reload schema');
