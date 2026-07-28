-- Staged, auditable historical survey imports into the canonical survey model.

alter table public.application_user_principals
  drop constraint if exists application_user_principals_state_check,
  drop constraint if exists application_user_principals_check;
alter table public.application_user_principals
  add column if not exists historical_wrike_user_id uuid references public.wrike_users(id) on delete restrict,
  add column if not exists historical_source text,
  add constraint application_user_principals_state_check
    check (state in ('active','deleted','historical')),
  add constraint application_user_principals_state_shape_check check (
    (state='active' and auth_user_id=id and deleted_at is null)
    or (state='deleted' and auth_user_id is null and display_name is null and deleted_at is not null)
    or (state='historical' and auth_user_id is null and display_name is not null and deleted_at is null)
  );
create unique index if not exists application_user_principals_historical_wrike_idx
  on public.application_user_principals(organization_id,historical_wrike_user_id)
  where state='historical' and historical_wrike_user_id is not null;

alter table public.survey_templates
  add column if not exists is_import_only boolean not null default false;
alter table public.survey_template_versions
  add column if not exists version_origin text not null default 'published'
    check (version_origin in ('published','historical_import')),
  add column if not exists schema_checksum text;
create unique index if not exists survey_historical_version_schema_idx
  on public.survey_template_versions(organization_id,survey_type,schema_checksum)
  where version_origin='historical_import';

create table public.survey_historical_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_filename text not null check (length(source_filename) between 1 and 255),
  file_checksum text not null check (file_checksum ~ '^[0-9a-f]{64}$'),
  schema_checksum text check (schema_checksum is null or schema_checksum ~ '^[0-9a-f]{64}$'),
  survey_type text check (survey_type in ('course_development_debrief','id_sme_review')),
  source_timezone text not null default 'America/Chicago',
  headers jsonb not null default '[]'::jsonb,
  status text not null default 'staged'
    check (status in ('staged','ready','partially_integrated','completed','rolled_back','invalid')),
  summary jsonb not null default '{}'::jsonb,
  imported_by uuid not null,
  created_at timestamptz not null default now(),
  validated_at timestamptz,
  integrated_at timestamptz,
  rolled_back_at timestamptz,
  unique(organization_id,file_checksum),
  foreign key(imported_by,organization_id)
    references public.application_user_principals(id,organization_id)
);

create table public.survey_historical_import_upload_attempts (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  batch_id uuid not null references public.survey_historical_import_batches(id) on delete cascade,
  source_filename text not null,
  file_checksum text not null check (file_checksum ~ '^[0-9a-f]{64}$'),
  duplicate_upload boolean not null default false,
  uploaded_by uuid not null,
  uploaded_at timestamptz not null default now(),
  foreign key(uploaded_by,organization_id)
    references public.application_user_principals(id,organization_id)
);

create table public.survey_historical_import_column_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  batch_id uuid not null references public.survey_historical_import_batches(id) on delete cascade,
  column_ordinal integer not null check (column_ordinal>=0),
  original_heading text not null,
  canonical_question_id text,
  mapping_target text not null check (mapping_target in ('answer','context','identity','timestamp','ignored','unmapped')),
  normalized_conversion text,
  mapping_source text not null default 'automatic'
    check (mapping_source in ('automatic','administrator_confirmed')),
  confirmed_by uuid,
  confirmed_at timestamptz,
  unique(batch_id,column_ordinal),
  foreign key(confirmed_by,organization_id)
    references public.application_user_principals(id,organization_id)
);

create table public.survey_historical_import_rows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  batch_id uuid not null references public.survey_historical_import_batches(id) on delete cascade,
  row_number integer not null check (row_number>=2),
  row_checksum text not null check (row_checksum ~ '^[0-9a-f]{64}$'),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  canonical_identity_key text,
  survey_type text not null check (survey_type in ('course_development_debrief','id_sme_review')),
  raw_row jsonb not null,
  normalized_answers jsonb not null default '{}'::jsonb,
  context_snapshot jsonb not null default '{}'::jsonb,
  match_diagnostics jsonb not null default '{}'::jsonb,
  source_submitted_at timestamptz,
  matched_task_id uuid references public.wrike_tasks(id) on delete restrict,
  respondent_principal_id uuid,
  reviewed_wrike_user_id uuid references public.wrike_users(id) on delete restrict,
  survey_version_id uuid references public.survey_template_versions(id) on delete restrict,
  repeat_resolution text check (repeat_resolution in ('retain','revision')),
  revision_order integer check (revision_order is null or revision_order>0),
  row_status text not null default 'issues'
    check (row_status in ('issues','ready','integrated','ignored','duplicate','failed','rolled_back')),
  ignored_reason text check (ignored_reason is null or length(btrim(ignored_reason)) between 3 and 2000),
  integrated_at timestamptz,
  last_validated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(batch_id,row_number),
  foreign key(respondent_principal_id,organization_id)
    references public.application_user_principals(id,organization_id)
);
create index survey_historical_import_rows_batch_status_idx
  on public.survey_historical_import_rows(batch_id,row_status,row_number);
create index survey_historical_import_rows_identity_idx
  on public.survey_historical_import_rows(organization_id,canonical_identity_key)
  where canonical_identity_key is not null;

create table public.survey_historical_import_issues (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  batch_id uuid not null references public.survey_historical_import_batches(id) on delete cascade,
  row_id uuid references public.survey_historical_import_rows(id) on delete cascade,
  issue_code text not null check (issue_code in (
    'survey_type_conflict','missing_project','ambiguous_project','missing_respondent',
    'ambiguous_respondent','missing_reviewed_sme','ambiguous_reviewed_sme',
    'missing_assignment','question_mapping_problem','invalid_answer','duplicate_response',
    'repeat_identity','canonical_collision','missing_timestamp','integration_failed'
  )),
  severity text not null default 'blocking' check (severity in ('blocking','warning')),
  source_field text,
  message text not null,
  raw_value jsonb,
  candidates jsonb not null default '[]'::jsonb,
  resolution_status text not null default 'open'
    check (resolution_status in ('open','resolved','ignored')),
  resolution jsonb not null default '{}'::jsonb,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key(resolved_by,organization_id)
    references public.application_user_principals(id,organization_id)
);
create index survey_historical_import_issues_filter_idx
  on public.survey_historical_import_issues(organization_id,batch_id,issue_code,resolution_status);

create table public.survey_historical_import_resolution_audit (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  batch_id uuid not null references public.survey_historical_import_batches(id) on delete cascade,
  row_id uuid references public.survey_historical_import_rows(id) on delete set null,
  column_mapping_id uuid references public.survey_historical_import_column_mappings(id) on delete set null,
  action text not null,
  previous_values jsonb not null default '{}'::jsonb,
  new_values jsonb not null default '{}'::jsonb,
  actor_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key(actor_id,organization_id)
    references public.application_user_principals(id,organization_id)
);

create table public.survey_historical_import_integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  batch_id uuid not null references public.survey_historical_import_batches(id) on delete cascade,
  row_id uuid not null unique references public.survey_historical_import_rows(id) on delete cascade,
  submission_id uuid references public.survey_submissions(id) on delete set null,
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  revision_number integer not null check (revision_number>0),
  submission_updated_at timestamptz not null,
  integrated_by uuid not null,
  integrated_at timestamptz not null default now(),
  rolled_back_at timestamptz,
  unique(organization_id,fingerprint),
  foreign key(integrated_by,organization_id)
    references public.application_user_principals(id,organization_id)
);

alter table public.survey_audit_log drop constraint if exists survey_audit_log_event_type_check;
alter table public.survey_audit_log add constraint survey_audit_log_event_type_check check (event_type in (
  'draft_created','draft_updated','submitted','unlocked','edited_after_unlock','resubmitted',
  'relocked','revision_access_reassigned','context_corrected','invoice_uploaded',
  'invoice_removed','invoice_replaced','historical_imported','historical_revision_imported',
  'historical_import_rolled_back'
));

create or replace function public.pin_current_survey_version()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.survey_version_id is null then
    select version.id,version.version_number,version.definition
      into new.survey_version_id,new.survey_version_number,new.definition_snapshot
    from public.survey_template_versions version
    join public.survey_templates template on template.id=version.template_id
    where version.organization_id=new.organization_id
      and version.survey_type=new.survey_type
      and version.version_origin='published'
      and not template.is_import_only and template.archived_at is null
    order by version.version_number desc limit 1;
  end if;
  if new.survey_version_number is null then
    select version_number into new.survey_version_number
    from public.survey_template_versions where id=new.survey_version_id;
  end if;
  new.answers:=coalesce(new.answers,'{}'::jsonb);
  if new.survey_version_id is null or new.definition_snapshot is null then
    raise exception using errcode='42501',message='Survey context is unavailable.';
  end if;
  return new;
end;
$$;

create or replace function public.survey_admin_templates()
returns table(
  id uuid,survey_type text,template_key text,archived_at timestamptz,
  definition jsonb,lock_version integer,updated_at timestamptz,
  latest_version integer,latest_published_at timestamptz,is_active boolean
) language plpgsql stable security definer set search_path=public as $$
declare viewer public.application_users%rowtype;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  if not found or not public.current_has_capability('manage_surveys') then
    raise exception using errcode='42501',message='Surveys are unavailable.';
  end if;
  return query
  select template.id,template.survey_type,template.template_key,template.archived_at,
    draft.definition,draft.lock_version,draft.updated_at,
    version.version_number,version.published_at,
    template.archived_at is null and version.version_number=(
      select max(candidate.version_number)
      from public.survey_template_versions candidate
      join public.survey_templates eligible on eligible.id=candidate.template_id
      where candidate.organization_id=viewer.organization_id
        and candidate.survey_type=template.survey_type
        and candidate.version_origin='published'
        and not eligible.is_import_only and eligible.archived_at is null
    )
  from public.survey_templates template
  join public.survey_template_drafts draft on draft.template_id=template.id
  left join lateral (
    select published.version_number,published.published_at
    from public.survey_template_versions published
    where published.template_id=template.id and published.version_origin='published'
    order by published.version_number desc limit 1
  ) version on true
  where template.organization_id=viewer.organization_id and not template.is_import_only
  order by template.survey_type,template.archived_at nulls first,draft.updated_at desc;
end;
$$;

create or replace function public.ensure_historical_survey_version(
  requested_type text,requested_schema_checksum text,requested_definition jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  viewer public.application_users%rowtype;
  template_id uuid;
  version_id uuid;
  next_version integer;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  if not found or not public.current_has_capability('manage_data') then
    raise exception using errcode='42501',message='Historical survey imports are unavailable.';
  end if;
  if requested_type not in ('course_development_debrief','id_sme_review')
    or requested_schema_checksum !~ '^[0-9a-f]{64}$'
    or not public.survey_definition_is_valid(requested_definition,requested_type)
  then raise exception using errcode='22023',message='Historical survey definition is invalid.'; end if;
  perform pg_advisory_xact_lock(hashtext(viewer.organization_id::text||':'||requested_type));
  select id into version_id from public.survey_template_versions
  where organization_id=viewer.organization_id and survey_type=requested_type
    and version_origin='historical_import' and schema_checksum=requested_schema_checksum;
  if version_id is not null then return version_id; end if;
  insert into public.survey_templates(
    organization_id,survey_type,template_key,archived_at,archived_by,created_by,is_import_only
  ) values (
    viewer.organization_id,requested_type,'historical-import',now(),viewer.id,viewer.id,true
  ) on conflict(organization_id,survey_type,template_key) do update
    set is_import_only=true,archived_at=coalesce(public.survey_templates.archived_at,now())
  returning id into template_id;
  insert into public.survey_template_drafts(template_id,organization_id,definition,updated_by)
  values(template_id,viewer.organization_id,requested_definition,viewer.id)
  on conflict(template_id) do nothing;
  select coalesce(max(version_number),0)+1 into next_version
  from public.survey_template_versions
  where organization_id=viewer.organization_id and survey_type=requested_type;
  insert into public.survey_template_versions(
    template_id,organization_id,survey_type,version_number,definition,published_by,
    version_origin,schema_checksum
  ) values (
    template_id,viewer.organization_id,requested_type,next_version,requested_definition,
    viewer.id,'historical_import',requested_schema_checksum
  ) returning id into version_id;
  return version_id;
end;
$$;

create or replace function public.create_historical_survey_principal(
  target_wrike_user_id uuid,target_role text
) returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare viewer public.application_users%rowtype; identity public.wrike_users%rowtype; principal_id uuid;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  if not found or not public.current_has_capability('manage_data') then
    raise exception using errcode='42501',message='Historical principals are unavailable.';
  end if;
  if target_role not in ('id','sme') then
    raise exception using errcode='22023',message='Select ID or SME history.'; end if;
  select * into identity from public.wrike_users
  where id=target_wrike_user_id and organization_id=viewer.organization_id
    and identity_verified and not is_unresolved;
  if not found then raise exception using errcode='22023',message='Select a verified Wrike identity.'; end if;
  select persona.application_user_id into principal_id
  from public.application_user_operational_personas persona
  join public.application_users member on member.id=persona.application_user_id
  where persona.organization_id=viewer.organization_id
    and persona.wrike_user_id=identity.id and persona.is_active
    and persona.operational_role=target_role
    and member.account_state='active' limit 1;
  if principal_id is not null then return principal_id; end if;
  select id into principal_id from public.application_user_principals
  where organization_id=viewer.organization_id and state='historical'
    and historical_wrike_user_id=identity.id;
  if principal_id is not null then return principal_id; end if;
  insert into public.application_user_principals(
    id,organization_id,auth_user_id,state,display_name,primary_role_snapshot,
    normalized_email_hash,historical_wrike_user_id,historical_source
  ) values (
    gen_random_uuid(),viewer.organization_id,null,'historical',identity.display_name,target_role,
    case when nullif(btrim(coalesce(identity.email,'')),'') is null then null
      else encode(extensions.digest(lower(btrim(identity.email)),'sha256'),'hex') end,
    identity.id,'survey_import'
  ) returning id into principal_id;
  return principal_id;
end;
$$;

create or replace function public.refresh_historical_survey_import_summary(target_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  viewer public.application_users%rowtype;
  batch_organization_id uuid;
  result jsonb;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  select organization_id into batch_organization_id
  from public.survey_historical_import_batches where id=target_batch_id;
  if not found or viewer.id is null
    or viewer.organization_id<>batch_organization_id
    or not public.current_has_capability('manage_data') then
    raise exception using errcode='42501',message='Historical survey import summaries are unavailable.';
  end if;
  select jsonb_build_object(
    'totalRows',count(*),
    'readyRows',count(*) filter(where row_status='ready'),
    'integratedRows',count(*) filter(where row_status='integrated'),
    'issueRows',count(*) filter(where row_status='issues'),
    'ignoredRows',count(*) filter(where row_status='ignored'),
    'duplicateRows',count(*) filter(where row_status='duplicate'),
    'failedRows',count(*) filter(where row_status='failed'),
    'rolledBackRows',count(*) filter(where row_status='rolled_back'),
    'openIssues',(select count(*) from public.survey_historical_import_issues issue
      where issue.batch_id=target_batch_id and issue.resolution_status='open'),
    'blockingIssues',(select count(*) from public.survey_historical_import_issues issue
      where issue.batch_id=target_batch_id and issue.resolution_status='open'
        and issue.severity='blocking'),
    'warningIssues',(select count(*) from public.survey_historical_import_issues issue
      where issue.batch_id=target_batch_id and issue.resolution_status='open'
        and issue.severity='warning')
  ) into result
  from public.survey_historical_import_rows where batch_id=target_batch_id;
  update public.survey_historical_import_batches set summary=result,validated_at=now()
  where id=target_batch_id;
  return result;
end;
$$;

create or replace function public.integrate_historical_survey_import_row(target_row_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  viewer public.application_users%rowtype;
  import_row public.survey_historical_import_rows%rowtype;
  task_record public.wrike_tasks%rowtype;
  respondent public.application_user_principals%rowtype;
  version_record public.survey_template_versions%rowtype;
  submission public.survey_submissions%rowtype;
  submission_id uuid;
  target_project_id uuid;
  next_revision integer;
  source_time timestamptz;
  ratings jsonb;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  if not found or not public.current_has_capability('manage_data') then
    raise exception using errcode='42501',message='Historical survey integration is unavailable.';
  end if;
  select * into import_row from public.survey_historical_import_rows
  where id=target_row_id and organization_id=viewer.organization_id for update;
  if not found or import_row.row_status<>'ready' then
    raise exception using errcode='22023',message='The historical row is not ready for integration.'; end if;
  if exists(select 1 from public.survey_historical_import_issues issue
    where issue.row_id=import_row.id and issue.resolution_status='open' and issue.severity='blocking')
  then raise exception using errcode='22023',message='Resolve every blocking issue before integration.'; end if;
  select * into task_record from public.wrike_tasks
  where id=import_row.matched_task_id and organization_id=viewer.organization_id and not is_deleted;
  select * into respondent from public.application_user_principals
  where id=import_row.respondent_principal_id and organization_id=viewer.organization_id;
  select * into version_record from public.survey_template_versions
  where id=import_row.survey_version_id and organization_id=viewer.organization_id
    and version_origin='historical_import';
  if task_record.id is null or respondent.id is null or version_record.id is null
    or import_row.reviewed_wrike_user_id is null or import_row.source_submitted_at is null
  then raise exception using errcode='22023',message='The historical row is missing required matched context.'; end if;
  if exists(select 1 from public.survey_historical_import_integrations integration
    where integration.organization_id=viewer.organization_id and integration.fingerprint=import_row.fingerprint
      and integration.rolled_back_at is null)
  then
    update public.survey_historical_import_rows set row_status='duplicate',updated_at=now()
    where id=import_row.id;
    perform public.refresh_historical_survey_import_summary(import_row.batch_id);
    return null;
  end if;
  source_time:=import_row.source_submitted_at;
  ratings:=coalesce(import_row.normalized_answers->'collaborationRatings','{}'::jsonb);
  select case when count(distinct location.project_id)=1
      then (array_agg(distinct location.project_id))[1] end
    into target_project_id
  from public.wrike_task_locations location
  where location.task_id=task_record.id and location.project_id is not null;
  select survey.* into submission
  from public.survey_submissions survey
  where survey.organization_id=viewer.organization_id
    and survey.task_id=task_record.id and survey.survey_type=import_row.survey_type
    and (
      (import_row.survey_type='course_development_debrief'
        and survey.subject_application_user_id=respondent.id)
      or (import_row.survey_type='id_sme_review'
        and survey.created_by=respondent.id
        and survey.reviewed_wrike_user_id=import_row.reviewed_wrike_user_id)
    ) for update;
  if submission.id is not null then
    if import_row.repeat_resolution<>'revision'
      or not exists(select 1 from public.survey_historical_import_integrations integration
        where integration.submission_id=submission.id and integration.batch_id=import_row.batch_id
          and integration.rolled_back_at is null)
    then raise exception using errcode='23505',message='A canonical survey already exists for this identity.'; end if;
    next_revision:=submission.revision_number+1;
    update public.survey_submissions set
      context_snapshot=import_row.context_snapshot,answers=import_row.normalized_answers,
      survey_version_id=version_record.id,survey_version_number=version_record.version_number,
      definition_snapshot=version_record.definition,revision_number=next_revision,
      latest_submitted_at=source_time,locked_at=source_time,locked_by=respondent.id,
      last_edited_by=respondent.id,updated_at=now()
    where id=submission.id returning * into submission;
    submission_id:=submission.id;
  else
    next_revision:=1;
    insert into public.survey_submissions(
      organization_id,survey_type,task_id,project_id,task_wrike_id,
      subject_application_user_id,reviewed_wrike_user_id,created_by,last_edited_by,
      context_snapshot,status,is_locked,revision_number,original_submitted_at,
      latest_submitted_at,locked_at,locked_by,created_at,updated_at,
      survey_version_id,survey_version_number,definition_snapshot,answers
    ) values (
      viewer.organization_id,import_row.survey_type,task_record.id,target_project_id,
      task_record.wrike_id,
      case when import_row.survey_type='course_development_debrief' then respondent.id end,
      import_row.reviewed_wrike_user_id,respondent.id,respondent.id,
      import_row.context_snapshot,'submitted',true,1,source_time,source_time,
      source_time,respondent.id,source_time,now(),version_record.id,
      version_record.version_number,version_record.definition,import_row.normalized_answers
    ) returning * into submission;
    submission_id:=submission.id;
  end if;
  if import_row.survey_type='course_development_debrief' then
    insert into public.course_development_debrief_responses(
      submission_id,original_due_year,internal_employee,billable_hours,amount_billed,
      work_started_on,work_finished_on,rating_01,rating_02,rating_03,rating_04,rating_05,
      rating_06,rating_07,rating_08,rating_09,rating_10,comments,reporting_year,
      sme_classification,updated_at
    ) values (
      submission_id,nullif(import_row.normalized_answers->>'legacyOriginalDueYear','')::integer,
      nullif(import_row.normalized_answers->>'legacyInternalEmployee','')::boolean,
      case when coalesce((import_row.normalized_answers->>'legacyInternalEmployee')::boolean,false)
        then null else nullif(import_row.normalized_answers->>'billableHours','')::numeric end,
      case when coalesce((import_row.normalized_answers->>'legacyInternalEmployee')::boolean,false)
        then null else nullif(import_row.normalized_answers->>'amountBilled','')::numeric end,
      nullif(import_row.normalized_answers->>'workStartedOn','')::date,
      nullif(import_row.normalized_answers->>'workFinishedOn','')::date,
      nullif(ratings->>'rating01','')::smallint,nullif(ratings->>'rating02','')::smallint,
      nullif(ratings->>'rating03','')::smallint,nullif(ratings->>'rating04','')::smallint,
      nullif(ratings->>'rating05','')::smallint,nullif(ratings->>'rating06','')::smallint,
      nullif(ratings->>'rating07','')::smallint,nullif(ratings->>'rating08','')::smallint,
      nullif(ratings->>'rating09','')::smallint,nullif(ratings->>'rating10','')::smallint,
      nullif(import_row.normalized_answers->>'comments',''),
      nullif(import_row.context_snapshot->>'reportingYear','')::integer,
      case when (import_row.normalized_answers->>'legacyInternalEmployee')::boolean
        then 'internal' else 'external' end,now()
    ) on conflict(submission_id) do update set
      original_due_year=excluded.original_due_year,internal_employee=excluded.internal_employee,
      billable_hours=excluded.billable_hours,amount_billed=excluded.amount_billed,
      work_started_on=excluded.work_started_on,work_finished_on=excluded.work_finished_on,
      rating_01=excluded.rating_01,rating_02=excluded.rating_02,rating_03=excluded.rating_03,
      rating_04=excluded.rating_04,rating_05=excluded.rating_05,rating_06=excluded.rating_06,
      rating_07=excluded.rating_07,rating_08=excluded.rating_08,rating_09=excluded.rating_09,
      rating_10=excluded.rating_10,comments=excluded.comments,reporting_year=excluded.reporting_year,
      sme_classification=excluded.sme_classification,updated_at=now();
  else
    insert into public.id_sme_review_responses(
      submission_id,publication_year,vertical,rating_01,rating_02,rating_03,rating_04,
      rating_05,rating_06,rating_07,rating_08,rating_09,provided_real_world_examples,
      real_world_examples_effectiveness,recommendation_score,comments,updated_at
    ) values (
      submission_id,nullif(import_row.normalized_answers->>'publicationYear','')::integer,
      nullif(import_row.normalized_answers->>'vertical',''),
      nullif(ratings->>'rating01','')::smallint,nullif(ratings->>'rating02','')::smallint,
      nullif(ratings->>'rating03','')::smallint,nullif(ratings->>'rating04','')::smallint,
      nullif(ratings->>'rating05','')::smallint,nullif(ratings->>'rating06','')::smallint,
      nullif(ratings->>'rating07','')::smallint,nullif(ratings->>'rating08','')::smallint,
      nullif(ratings->>'rating09','')::smallint,
      nullif(import_row.normalized_answers->>'providedRealWorldExamples','')::boolean,
      null,nullif(import_row.normalized_answers->>'recommendationScore','')::smallint,
      nullif(import_row.normalized_answers->>'comments',''),now()
    ) on conflict(submission_id) do update set
      publication_year=excluded.publication_year,vertical=excluded.vertical,
      rating_01=excluded.rating_01,rating_02=excluded.rating_02,rating_03=excluded.rating_03,
      rating_04=excluded.rating_04,rating_05=excluded.rating_05,rating_06=excluded.rating_06,
      rating_07=excluded.rating_07,rating_08=excluded.rating_08,rating_09=excluded.rating_09,
      provided_real_world_examples=excluded.provided_real_world_examples,
      real_world_examples_effectiveness=null,recommendation_score=excluded.recommendation_score,
      comments=excluded.comments,updated_at=now();
  end if;
  insert into public.survey_revisions(
    submission_id,organization_id,revision_number,context_snapshot,response_snapshot,
    attachment_snapshot,changed_fields,submitted_by,submitted_at,definition_snapshot,
    answers_snapshot
  ) values (
    submission_id,viewer.organization_id,next_revision,import_row.context_snapshot,
    import_row.normalized_answers,'[]'::jsonb,jsonb_build_object('historicalImport',true),
    respondent.id,source_time,version_record.definition,import_row.normalized_answers
  );
  insert into public.survey_audit_log(
    submission_id,organization_id,event_type,actor_id,actor_role,new_values,created_at
  ) values (
    submission_id,viewer.organization_id,
    case when next_revision=1 then 'submitted' else 'resubmitted' end,
    respondent.id,respondent.primary_role_snapshot,import_row.normalized_answers,source_time
  );
  insert into public.survey_audit_log(
    submission_id,organization_id,event_type,actor_id,actor_role,new_values
  ) values (
    submission_id,viewer.organization_id,
    case when next_revision=1 then 'historical_imported' else 'historical_revision_imported' end,
    viewer.id,viewer.role,jsonb_build_object('batchId',import_row.batch_id,'rowId',import_row.id)
  );
  if not exists(
    select 1
    from public.survey_submissions saved
    join public.survey_revisions revision
      on revision.submission_id=saved.id and revision.revision_number=next_revision
    where saved.id=submission_id and saved.organization_id=viewer.organization_id
      and saved.status='submitted' and saved.is_locked
      and saved.revision_number=next_revision
      and saved.survey_version_id=version_record.id
      and saved.answers=import_row.normalized_answers
      and revision.answers_snapshot=import_row.normalized_answers
      and revision.submitted_at=source_time
  ) then
    raise exception using errcode='40001',
      message='Historical survey persistence could not be verified.';
  end if;
  insert into public.survey_historical_import_integrations(
    organization_id,batch_id,row_id,submission_id,fingerprint,revision_number,
    submission_updated_at,integrated_by
  ) values (
    viewer.organization_id,import_row.batch_id,import_row.id,submission_id,
    import_row.fingerprint,next_revision,(select updated_at from public.survey_submissions where id=submission_id),viewer.id
  );
  update public.survey_historical_import_rows set
    row_status='integrated',integrated_at=now(),updated_at=now()
  where id=import_row.id;
  perform public.refresh_historical_survey_import_summary(import_row.batch_id);
  return submission_id;
end;
$$;

create or replace function public.integrate_historical_survey_import_batch(target_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  viewer public.application_users%rowtype;
  candidate record;
  integrated_submission_id uuid;
  integrated_count integer:=0;
  duplicate_count integer:=0;
  failed_count integer:=0;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  if not found or not public.current_has_capability('manage_data')
    or not exists(select 1 from public.survey_historical_import_batches
      where id=target_batch_id and organization_id=viewer.organization_id and status<>'rolled_back')
  then raise exception using errcode='42501',message='Historical survey integration is unavailable.'; end if;
  for candidate in
    select id from public.survey_historical_import_rows
    where batch_id=target_batch_id and row_status='ready'
    order by canonical_identity_key nulls last,coalesce(revision_order,2147483647),source_submitted_at,row_number
  loop
    begin
      integrated_submission_id:=public.integrate_historical_survey_import_row(candidate.id);
      if integrated_submission_id is null then
        duplicate_count:=duplicate_count+1;
      else
        integrated_count:=integrated_count+1;
      end if;
    exception when others then
      failed_count:=failed_count+1;
      update public.survey_historical_import_rows set row_status='failed',updated_at=now()
      where id=candidate.id;
      insert into public.survey_historical_import_issues(
        organization_id,batch_id,row_id,issue_code,severity,message
      ) values (
        viewer.organization_id,target_batch_id,candidate.id,'integration_failed','blocking',sqlerrm
      );
    end;
  end loop;
  update public.survey_historical_import_batches batch set
    status=case when exists(select 1 from public.survey_historical_import_rows row
      where row.batch_id=batch.id and row.row_status in ('issues','ready','failed'))
      then 'partially_integrated' else 'completed' end,
    integrated_at=case when integrated_count>0 then now() else integrated_at end
  where batch.id=target_batch_id;
  return jsonb_build_object(
    'integrated',integrated_count,'duplicates',duplicate_count,'failed',failed_count,
    'summary',public.refresh_historical_survey_import_summary(target_batch_id)
  );
end;
$$;

create or replace function public.rollback_historical_survey_import_batch(target_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare viewer public.application_users%rowtype; linked record; removed integer:=0;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  if not found or not public.current_has_capability('manage_data') then
    raise exception using errcode='42501',message='Historical survey rollback is unavailable.'; end if;
  perform 1 from public.survey_historical_import_batches
  where id=target_batch_id and organization_id=viewer.organization_id
    and status in ('partially_integrated','completed') for update;
  if not found then raise exception using errcode='22023',message='This batch cannot be rolled back.'; end if;
  for linked in
    select distinct integration.submission_id
    from public.survey_historical_import_integrations integration
    where integration.batch_id=target_batch_id and integration.rolled_back_at is null
      and integration.submission_id is not null
  loop
    if exists(select 1 from public.survey_historical_import_integrations other_link
      where other_link.submission_id=linked.submission_id
        and other_link.batch_id<>target_batch_id and other_link.rolled_back_at is null)
      or exists(select 1 from public.survey_attachments where submission_id=linked.submission_id)
      or exists(select 1 from public.sme_debrief_notification_events where submission_id=linked.submission_id)
      or exists(select 1 from public.survey_audit_log audit
        where audit.submission_id=linked.submission_id
          and audit.event_type not in ('submitted','resubmitted','historical_imported','historical_revision_imported'))
      or (select updated_at from public.survey_submissions where id=linked.submission_id)>
        (select max(integrated_at)+interval '1 second'
          from public.survey_historical_import_integrations where submission_id=linked.submission_id)
    then raise exception using errcode='55000',
      message='Rollback is blocked because an imported submission was modified.'; end if;
  end loop;
  update public.survey_historical_import_integrations set
    rolled_back_at=now(),submission_id=null
  where batch_id=target_batch_id and rolled_back_at is null;
  for linked in
    select distinct survey.id submission_id from public.survey_submissions survey
    join public.survey_historical_import_rows row
      on row.organization_id=survey.organization_id
      and row.batch_id=target_batch_id and row.row_status='integrated'
      and row.matched_task_id=survey.task_id
      and row.survey_type=survey.survey_type
      and (
        (row.survey_type='course_development_debrief'
          and survey.subject_application_user_id=row.respondent_principal_id)
        or (row.survey_type='id_sme_review'
          and survey.created_by=row.respondent_principal_id
          and survey.reviewed_wrike_user_id=row.reviewed_wrike_user_id)
      )
  loop
    delete from public.survey_submissions where id=linked.submission_id;
    removed:=removed+1;
  end loop;
  update public.survey_historical_import_rows set row_status='rolled_back',updated_at=now()
  where batch_id=target_batch_id and row_status='integrated';
  update public.survey_historical_import_batches set
    status='rolled_back',rolled_back_at=now()
  where id=target_batch_id;
  return jsonb_build_object('rolledBackSubmissions',removed,
    'summary',public.refresh_historical_survey_import_summary(target_batch_id));
end;
$$;

-- Canonical imports participate in SME oversight even when the historical
-- assignment is no longer present in Wrike. Assignment counts remain strictly
-- derived from current authoritative assignment fields.
create or replace function public.sme_management_rows()
returns table(wrike_user_id uuid,application_user_id uuid,display_name text,email text,mapping_status text,
  coordinator boolean,assigned_projects bigint,active_projects bigint,completed_projects bigint,
  stalled_projects bigint,submitted_surveys bigint,billable_hours numeric,invoiced_amount numeric)
language plpgsql stable security definer set search_path=public as $$
declare viewer public.application_users%rowtype;
begin
  select * into viewer from public.application_users where id=public.current_effective_user_id();
  if not found or not public.current_has_capability('manage_smes') then
    raise exception using errcode='42501',message='SME Management is unavailable.';
  end if;
  return query
  with assignments as (
    select assignment.task_id,assignment.wrike_user_id
    from public.course_development_person_assignments(viewer.organization_id,'sme') assignment
  ), identities as (
    select distinct assignment.wrike_user_id from assignments assignment
    union
    select persona.wrike_user_id from public.application_user_operational_personas persona
      where persona.organization_id=viewer.organization_id and persona.operational_role='sme'
        and persona.is_active and persona.wrike_user_id is not null
    union
    select survey.reviewed_wrike_user_id from public.survey_submissions survey
      where survey.organization_id=viewer.organization_id
        and survey.survey_type='course_development_debrief'
        and survey.reviewed_wrike_user_id is not null
  ), mapped as (
    select persona.application_user_id,persona.wrike_user_id
    from public.application_user_operational_personas persona
    where persona.organization_id=viewer.organization_id and persona.operational_role='sme' and persona.is_active
    union
    select member.id,member.wrike_user_id from public.application_users member
    where member.organization_id=viewer.organization_id and member.role='sme' and member.wrike_user_id is not null
  ), assignment_totals as (
    select assignment.wrike_user_id,
      count(distinct assignment.task_id) assigned_projects,
      count(distinct assignment.task_id) filter(where status.dashboard_classification='active') active_projects,
      count(distinct assignment.task_id) filter(where status.dashboard_classification='completed') completed_projects,
      count(distinct assignment.task_id) filter(where status.dashboard_classification='stalled_or_canceled') stalled_projects
    from assignments assignment
    left join public.wrike_tasks task on task.id=assignment.task_id
    left join public.wrike_workflow_statuses status on status.organization_id=viewer.organization_id
      and status.wrike_id=task.custom_status_id
    group by assignment.wrike_user_id
  ), survey_totals as (
    select survey.reviewed_wrike_user_id,
      count(distinct survey.id) filter(where survey.status='submitted') submitted_surveys,
      coalesce(sum(response.billable_hours) filter(
        where survey.status='submitted' and response.internal_employee=false),0) billable_hours,
      coalesce(sum(response.amount_billed) filter(
        where survey.status='submitted' and response.internal_employee=false),0) invoiced_amount
    from public.survey_submissions survey
    left join public.course_development_debrief_responses response on response.submission_id=survey.id
    where survey.organization_id=viewer.organization_id
      and survey.survey_type='course_development_debrief'
    group by survey.reviewed_wrike_user_id
  )
  select identity.id,mapped.application_user_id,identity.display_name,identity.email,
    case when mapped.application_user_id is null then 'unmapped' else 'mapped' end,
    exists(select 1 from public.application_user_management_roles grant_row
      where grant_row.application_user_id=mapped.application_user_id
        and grant_row.management_role='sme_coordinator' and grant_row.is_active),
    coalesce(assignment_totals.assigned_projects,0),
    coalesce(assignment_totals.active_projects,0),
    coalesce(assignment_totals.completed_projects,0),
    coalesce(assignment_totals.stalled_projects,0),
    coalesce(survey_totals.submitted_surveys,0),
    coalesce(survey_totals.billable_hours,0),
    coalesce(survey_totals.invoiced_amount,0)
  from identities source
  join public.wrike_users identity on identity.id=source.wrike_user_id
    and identity.organization_id=viewer.organization_id
  left join mapped on mapped.wrike_user_id=identity.id
  left join assignment_totals on assignment_totals.wrike_user_id=identity.id
  left join survey_totals on survey_totals.reviewed_wrike_user_id=identity.id;
end;
$$;

do $$
declare relation_name text;
begin
  foreach relation_name in array array[
    'survey_historical_import_batches','survey_historical_import_upload_attempts',
    'survey_historical_import_column_mappings','survey_historical_import_rows',
    'survey_historical_import_issues','survey_historical_import_resolution_audit',
    'survey_historical_import_integrations'
  ] loop
    execute format('alter table public.%I enable row level security',relation_name);
    execute format('create policy "data administrators read %1$s" on public.%1$I for select using (public.current_has_capability(''manage_data''))',relation_name);
    execute format('revoke all on public.%I from anon,authenticated',relation_name);
    execute format('grant select on public.%I to authenticated',relation_name);
    execute format('grant all on public.%I to service_role',relation_name);
  end loop;
end $$;

revoke all on function public.ensure_historical_survey_version(text,text,jsonb) from public;
revoke all on function public.create_historical_survey_principal(uuid,text) from public;
revoke all on function public.refresh_historical_survey_import_summary(uuid) from public;
revoke all on function public.integrate_historical_survey_import_row(uuid) from public;
revoke all on function public.integrate_historical_survey_import_batch(uuid) from public;
revoke all on function public.rollback_historical_survey_import_batch(uuid) from public;
grant execute on function public.ensure_historical_survey_version(text,text,jsonb) to authenticated,service_role;
grant execute on function public.create_historical_survey_principal(uuid,text) to authenticated,service_role;
grant execute on function public.refresh_historical_survey_import_summary(uuid) to authenticated,service_role;
grant execute on function public.integrate_historical_survey_import_row(uuid) to authenticated,service_role;
grant execute on function public.integrate_historical_survey_import_batch(uuid) to authenticated,service_role;
grant execute on function public.rollback_historical_survey_import_batch(uuid) to authenticated,service_role;
