-- Finalized pre-DevTrack survey CSV imports. Native survey submissions retain
-- their strict project and actor invariants; unmatched history lives here.

alter table public.survey_historical_import_batches
  add column if not exists external_survey_type text
    check (external_survey_type in ('SME_DEBRIEF','ID_SME_REVIEW')),
  add column if not exists survey_versions text[] not null default '{}',
  add column if not exists idempotency_key uuid,
  add column if not exists finalized_at timestamptz;

alter table public.survey_historical_import_rows
  add column if not exists external_survey_type text
    check (external_survey_type in ('SME_DEBRIEF','ID_SME_REVIEW')),
  add column if not exists survey_version text,
  add column if not exists source_response_id text,
  add column if not exists effective_source_response_id text,
  add column if not exists selected_for_import boolean not null default false,
  add column if not exists duplicate_action text not null default 'skip'
    check (duplicate_action in ('skip','separate','replace')),
  add column if not exists duplicate_target_response_id uuid,
  add column if not exists explicit_unmatched boolean not null default false,
  add column if not exists normalization_deltas jsonb not null default '[]'::jsonb,
  add column if not exists finalized_status text
    check (finalized_status in ('imported','skipped','blocked','replaced','failed')),
  add column if not exists historical_response_id uuid;

create table public.historical_survey_responses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  survey_type text not null check (survey_type in ('SME_DEBRIEF','ID_SME_REVIEW')),
  internal_survey_type text not null
    check (internal_survey_type in ('course_development_debrief','id_sme_review')),
  survey_version text not null check (length(btrim(survey_version)) between 1 and 100),
  submitted_at timestamptz not null,
  source_response_id text not null check (length(btrim(source_response_id)) between 1 and 500),
  original_source_response_id text not null check (length(btrim(original_source_response_id)) between 1 and 500),
  source_wrike_task_id text,
  historical_course_name text not null check (length(btrim(historical_course_name)) between 1 and 1000),
  matched_task_id uuid references public.wrike_tasks(id) on delete set null,
  matched_wrike_task_id text,
  match_method text check (match_method is null or match_method in (
    'wrike_task_id','exact_course_name','course_name_year',
    'case_insensitive_course_name','administrator'
  )),
  match_confidence numeric(5,4) check (match_confidence is null or match_confidence between 0 and 1),
  respondent_name text not null default '',
  respondent_email text,
  reviewed_sme_name text not null default '',
  reviewed_sme_email text,
  matched_respondent_principal_id uuid,
  matched_reviewed_wrike_user_id uuid references public.wrike_users(id) on delete set null,
  import_batch_id uuid not null references public.survey_historical_import_batches(id) on delete restrict,
  import_row_id uuid not null unique references public.survey_historical_import_rows(id) on delete restrict,
  import_source text not null default 'historical_csv' check (import_source='historical_csv'),
  imported_at timestamptz not null default now(),
  imported_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,survey_type,source_response_id),
  foreign key(matched_respondent_principal_id,organization_id)
    references public.application_user_principals(id,organization_id),
  foreign key(imported_by,organization_id)
    references public.application_user_principals(id,organization_id)
);
create index historical_survey_responses_match_idx
  on public.historical_survey_responses(organization_id,matched_task_id,internal_survey_type);
create index historical_survey_responses_unmatched_idx
  on public.historical_survey_responses(organization_id,submitted_at desc)
  where matched_task_id is null;

create table public.historical_sme_debrief_responses (
  response_id uuid primary key references public.historical_survey_responses(id) on delete cascade,
  sme_name text not null,
  sme_email text,
  billable_hours numeric(10,2) check (billable_hours is null or billable_hours>=0),
  amount_billed numeric(12,2) check (amount_billed is null or amount_billed>=0),
  work_started_on date,
  work_finished_on date,
  collaboration_ratings jsonb not null,
  comments text check (comments is null or length(comments)<=5000),
  check (work_finished_on is null or work_started_on is null or work_finished_on>=work_started_on)
);

create table public.historical_id_sme_review_responses (
  response_id uuid primary key references public.historical_survey_responses(id) on delete cascade,
  reviewer_name text not null,
  reviewer_email text,
  reviewed_sme_name text not null,
  reviewed_sme_email text,
  publication_year integer check (publication_year is null or publication_year between 1000 and 9999),
  vertical text check (vertical is null or vertical in (
    'P1A','C1A','D1A','FR1A','EMS1','LGU','Lexipol','Wellness',
    'Cross Vertical','Unresolved Vertical'
  )),
  original_vertical text,
  collaboration_ratings jsonb not null,
  provided_real_world_examples boolean,
  real_world_examples_effectiveness smallint
    check (real_world_examples_effectiveness is null or real_world_examples_effectiveness between 1 and 5),
  recommendation_score smallint
    check (recommendation_score is null or recommendation_score between 0 and 10),
  comments text check (comments is null or length(comments)<=5000)
);

create table public.historical_survey_response_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  response_id uuid not null references public.historical_survey_responses(id) on delete restrict,
  revision_number integer not null check (revision_number>0),
  response_snapshot jsonb not null,
  detail_snapshot jsonb not null,
  replaced_by uuid not null,
  replaced_at timestamptz not null default now(),
  import_batch_id uuid not null references public.survey_historical_import_batches(id) on delete restrict,
  unique(response_id,revision_number),
  foreign key(replaced_by,organization_id)
    references public.application_user_principals(id,organization_id)
);

create table public.historical_survey_response_audit (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  response_id uuid not null references public.historical_survey_responses(id) on delete restrict,
  import_batch_id uuid references public.survey_historical_import_batches(id) on delete restrict,
  action text not null check (action in ('imported','replaced','project_matched','project_unmatched')),
  previous_values jsonb not null default '{}'::jsonb,
  new_values jsonb not null default '{}'::jsonb,
  actor_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key(actor_id,organization_id)
    references public.application_user_principals(id,organization_id)
);

alter table public.survey_historical_import_rows
  add constraint survey_historical_import_rows_duplicate_target_fk
  foreign key(duplicate_target_response_id)
  references public.historical_survey_responses(id) on delete set null;
alter table public.survey_historical_import_rows
  add constraint survey_historical_import_rows_historical_response_fk
  foreign key(historical_response_id)
  references public.historical_survey_responses(id) on delete set null;

alter table public.survey_historical_import_integrations
  add column if not exists historical_response_id uuid
    references public.historical_survey_responses(id) on delete set null;

create or replace function public.finalized_historical_ratings_valid(
  ratings jsonb,
  expected_count integer
)
returns boolean language sql immutable set search_path=public as $$
  select jsonb_typeof(ratings)='object'
    and jsonb_object_length(ratings)=expected_count
    and not exists(
      select 1 from generate_series(1,expected_count) item(index)
      where coalesce(ratings->>format('rating%s',lpad(item.index::text,2,'0')),'')
        !~ '^[1-5]$'
    );
$$;

create or replace function public.finalized_historical_import_summary(target_batch_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare viewer public.application_users%rowtype; result jsonb;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  if not found or not public.current_has_capability('manage_data')
    or not exists(select 1 from public.survey_historical_import_batches batch
      where batch.id=target_batch_id and batch.organization_id=viewer.organization_id)
  then raise exception using errcode='42501',message='Historical import summary is unavailable.'; end if;
  select jsonb_build_object(
    'totalRows',count(*),
    'selectedRows',count(*) filter(where selected_for_import),
    'readyRows',count(*) filter(where row_status='ready' and finalized_status is null),
    'blockedRows',count(*) filter(where row_status='issues' or finalized_status='blocked'),
    'duplicateRows',count(*) filter(where row_status='duplicate'),
    'importedRows',count(*) filter(where finalized_status='imported'),
    'replacedRows',count(*) filter(where finalized_status='replaced'),
    'skippedRows',count(*) filter(where finalized_status='skipped'),
    'failedRows',count(*) filter(where finalized_status='failed'),
    'unmatchedRows',count(*) filter(
      where finalized_status in ('imported','replaced') and matched_task_id is null
    ),
    'warningIssues',(select count(*) from public.survey_historical_import_issues issue
      where issue.batch_id=target_batch_id and issue.severity='warning'),
    'blockingIssues',(select count(*) from public.survey_historical_import_issues issue
      where issue.batch_id=target_batch_id and issue.severity='blocking'
        and issue.resolution_status='open')
  ) into result
  from public.survey_historical_import_rows where batch_id=target_batch_id;
  return result;
end;
$$;

create or replace function public.execute_finalized_historical_survey_import(
  target_batch_id uuid,
  requested_idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  viewer public.application_users%rowtype;
  batch public.survey_historical_import_batches%rowtype;
  import_row public.survey_historical_import_rows%rowtype;
  existing_response public.historical_survey_responses%rowtype;
  saved_response_id uuid;
  response_snapshot jsonb;
  detail_snapshot jsonb;
  revision_number integer;
  result jsonb;
  failure_message text;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  if not found or not public.current_has_capability('manage_data') then
    raise exception using errcode='42501',message='Historical survey import is unavailable.';
  end if;
  if requested_idempotency_key is null then
    raise exception using errcode='22023',message='An idempotency key is required.';
  end if;

  select * into batch from public.survey_historical_import_batches
  where id=target_batch_id and organization_id=viewer.organization_id for update;
  if not found or batch.external_survey_type is null or batch.status in ('invalid','rolled_back') then
    raise exception using errcode='22023',message='This finalized historical batch cannot be imported.';
  end if;
  if batch.finalized_at is not null then
    if batch.idempotency_key=requested_idempotency_key then
      return public.finalized_historical_import_summary(batch.id);
    end if;
    raise exception using errcode='23505',message='This batch has already been finalized.';
  end if;
  update public.survey_historical_import_batches
    set idempotency_key=requested_idempotency_key
  where id=batch.id;

  for import_row in
    select * from public.survey_historical_import_rows
    where batch_id=batch.id and selected_for_import and finalized_status is null
    order by row_number for update
  loop
    begin
      if import_row.external_survey_type is null
        or import_row.survey_version is null or btrim(import_row.survey_version)=''
        or import_row.source_response_id is null or btrim(import_row.source_response_id)=''
        or import_row.effective_source_response_id is null
        or import_row.source_submitted_at is null
        or coalesce(import_row.normalized_answers->>'surveyType','')<>import_row.external_survey_type
        or btrim(coalesce(import_row.normalized_answers->>'courseName',''))=''
        or (
          import_row.external_survey_type='SME_DEBRIEF' and (
            btrim(coalesce(import_row.normalized_answers#>>'{sme,name}',''))=''
            or not public.finalized_historical_ratings_valid(
              import_row.normalized_answers->'collaborationRatings',10
            )
          )
        )
        or (
          import_row.external_survey_type='ID_SME_REVIEW' and (
            btrim(coalesce(import_row.normalized_answers#>>'{reviewer,name}',''))=''
            or btrim(coalesce(import_row.normalized_answers#>>'{reviewedSme,name}',''))=''
            or not public.finalized_historical_ratings_valid(
              import_row.normalized_answers->'collaborationRatings',9
            )
          )
        )
      then
        raise exception using errcode='22023',
          message='The selected row no longer satisfies the finalized historical survey schema.';
      end if;
      if import_row.row_status='issues' then
        update public.survey_historical_import_rows set
          finalized_status='blocked',selected_for_import=false,updated_at=now()
        where id=import_row.id;
        continue;
      end if;

      select * into existing_response from public.historical_survey_responses response
      where response.organization_id=viewer.organization_id
        and response.survey_type=import_row.external_survey_type
        and (
          response.source_response_id=import_row.source_response_id
          or response.original_source_response_id=import_row.source_response_id
        )
      order by (response.source_response_id=import_row.source_response_id) desc,
        response.imported_at
      limit 1 for update;

      if import_row.duplicate_action='skip'
        and (import_row.row_status='duplicate' or existing_response.id is not null)
      then
        update public.survey_historical_import_rows set
          finalized_status='skipped',selected_for_import=false,updated_at=now()
        where id=import_row.id;
        continue;
      end if;

      if import_row.duplicate_action='replace' then
        if not public.current_has_capability('manage_surveys') then
          raise exception using errcode='42501',
            message='Replacing historical responses requires survey-management access.';
        end if;
        select * into existing_response from public.historical_survey_responses response
        where response.id=import_row.duplicate_target_response_id
          and response.organization_id=viewer.organization_id for update;
        if not found then
          raise exception using errcode='22023',message='The replacement target is unavailable.';
        end if;
        select to_jsonb(existing_response) into response_snapshot;
        if existing_response.survey_type='SME_DEBRIEF' then
          select to_jsonb(detail) into detail_snapshot
          from public.historical_sme_debrief_responses detail
          where detail.response_id=existing_response.id;
        else
          select to_jsonb(detail) into detail_snapshot
          from public.historical_id_sme_review_responses detail
          where detail.response_id=existing_response.id;
        end if;
        select coalesce(max(revision.revision_number),0)+1 into revision_number
        from public.historical_survey_response_revisions revision
        where revision.response_id=existing_response.id;
        insert into public.historical_survey_response_revisions(
          organization_id,response_id,revision_number,response_snapshot,detail_snapshot,
          replaced_by,import_batch_id
        ) values (
          viewer.organization_id,existing_response.id,revision_number,response_snapshot,
          coalesce(detail_snapshot,'{}'::jsonb),viewer.id,batch.id
        );
        saved_response_id:=existing_response.id;
        update public.historical_survey_responses set
          survey_version=import_row.survey_version,
          submitted_at=import_row.source_submitted_at,
          source_wrike_task_id=nullif(import_row.normalized_answers->>'wrikeTaskId',''),
          historical_course_name=import_row.normalized_answers->>'courseName',
          matched_task_id=import_row.matched_task_id,
          matched_wrike_task_id=nullif(import_row.context_snapshot->>'matchedWrikeTaskId',''),
          match_method=nullif(import_row.context_snapshot->>'matchMethod',''),
          match_confidence=nullif(import_row.context_snapshot->>'matchConfidence','')::numeric,
          respondent_name=coalesce(
            import_row.normalized_answers#>>'{reviewer,name}',
            import_row.normalized_answers#>>'{sme,name}',''
          ),
          respondent_email=coalesce(
            import_row.normalized_answers#>>'{reviewer,email}',
            import_row.normalized_answers#>>'{sme,email}'
          ),
          reviewed_sme_name=coalesce(
            import_row.normalized_answers#>>'{reviewedSme,name}',
            import_row.normalized_answers#>>'{sme,name}',''
          ),
          reviewed_sme_email=coalesce(
            import_row.normalized_answers#>>'{reviewedSme,email}',
            import_row.normalized_answers#>>'{sme,email}'
          ),
          matched_respondent_principal_id=import_row.respondent_principal_id,
          matched_reviewed_wrike_user_id=import_row.reviewed_wrike_user_id,
          import_batch_id=batch.id,import_row_id=import_row.id,
          imported_at=now(),imported_by=viewer.id,updated_at=now()
        where id=saved_response_id;
      else
        insert into public.historical_survey_responses(
          organization_id,survey_type,internal_survey_type,survey_version,submitted_at,
          source_response_id,original_source_response_id,source_wrike_task_id,
          historical_course_name,matched_task_id,matched_wrike_task_id,match_method,
          match_confidence,respondent_name,respondent_email,reviewed_sme_name,
          reviewed_sme_email,matched_respondent_principal_id,matched_reviewed_wrike_user_id,
          import_batch_id,import_row_id,imported_by
        ) values (
          viewer.organization_id,import_row.external_survey_type,import_row.survey_type,
          import_row.survey_version,import_row.source_submitted_at,
          import_row.effective_source_response_id,import_row.source_response_id,
          nullif(import_row.normalized_answers->>'wrikeTaskId',''),
          import_row.normalized_answers->>'courseName',import_row.matched_task_id,
          nullif(import_row.context_snapshot->>'matchedWrikeTaskId',''),
          nullif(import_row.context_snapshot->>'matchMethod',''),
          nullif(import_row.context_snapshot->>'matchConfidence','')::numeric,
          coalesce(import_row.normalized_answers#>>'{reviewer,name}',
            import_row.normalized_answers#>>'{sme,name}',''),
          coalesce(import_row.normalized_answers#>>'{reviewer,email}',
            import_row.normalized_answers#>>'{sme,email}'),
          coalesce(import_row.normalized_answers#>>'{reviewedSme,name}',
            import_row.normalized_answers#>>'{sme,name}',''),
          coalesce(import_row.normalized_answers#>>'{reviewedSme,email}',
            import_row.normalized_answers#>>'{sme,email}'),
          import_row.respondent_principal_id,import_row.reviewed_wrike_user_id,
          batch.id,import_row.id,viewer.id
        ) returning id into saved_response_id;
      end if;

      if import_row.external_survey_type='SME_DEBRIEF' then
        delete from public.historical_id_sme_review_responses where response_id=saved_response_id;
        insert into public.historical_sme_debrief_responses(
          response_id,sme_name,sme_email,billable_hours,amount_billed,work_started_on,
          work_finished_on,collaboration_ratings,comments
        ) values (
          saved_response_id,import_row.normalized_answers#>>'{sme,name}',
          import_row.normalized_answers#>>'{sme,email}',
          nullif(import_row.normalized_answers->>'billableHours','')::numeric,
          nullif(import_row.normalized_answers->>'amountBilled','')::numeric,
          nullif(import_row.normalized_answers->>'workStartedOn','')::date,
          nullif(import_row.normalized_answers->>'workFinishedOn','')::date,
          coalesce(import_row.normalized_answers->'collaborationRatings','{}'::jsonb),
          nullif(import_row.normalized_answers->>'comments','')
        ) on conflict(response_id) do update set
          sme_name=excluded.sme_name,sme_email=excluded.sme_email,
          billable_hours=excluded.billable_hours,amount_billed=excluded.amount_billed,
          work_started_on=excluded.work_started_on,work_finished_on=excluded.work_finished_on,
          collaboration_ratings=excluded.collaboration_ratings,comments=excluded.comments;
      else
        delete from public.historical_sme_debrief_responses where response_id=saved_response_id;
        insert into public.historical_id_sme_review_responses(
          response_id,reviewer_name,reviewer_email,reviewed_sme_name,reviewed_sme_email,
          publication_year,vertical,original_vertical,collaboration_ratings,
          provided_real_world_examples,real_world_examples_effectiveness,
          recommendation_score,comments
        ) values (
          saved_response_id,import_row.normalized_answers#>>'{reviewer,name}',
          import_row.normalized_answers#>>'{reviewer,email}',
          import_row.normalized_answers#>>'{reviewedSme,name}',
          import_row.normalized_answers#>>'{reviewedSme,email}',
          nullif(import_row.normalized_answers->>'publicationYear','')::integer,
          nullif(import_row.normalized_answers->>'vertical',''),
          nullif(import_row.normalized_answers->>'originalVertical',''),
          coalesce(import_row.normalized_answers->'collaborationRatings','{}'::jsonb),
          nullif(import_row.normalized_answers->>'providedRealWorldExamples','')::boolean,
          nullif(import_row.normalized_answers->>'realWorldExamplesEffectiveness','')::smallint,
          nullif(import_row.normalized_answers->>'recommendationScore','')::smallint,
          nullif(import_row.normalized_answers->>'comments','')
        ) on conflict(response_id) do update set
          reviewer_name=excluded.reviewer_name,reviewer_email=excluded.reviewer_email,
          reviewed_sme_name=excluded.reviewed_sme_name,
          reviewed_sme_email=excluded.reviewed_sme_email,
          publication_year=excluded.publication_year,vertical=excluded.vertical,
          original_vertical=excluded.original_vertical,
          collaboration_ratings=excluded.collaboration_ratings,
          provided_real_world_examples=excluded.provided_real_world_examples,
          real_world_examples_effectiveness=excluded.real_world_examples_effectiveness,
          recommendation_score=excluded.recommendation_score,comments=excluded.comments;
      end if;

      insert into public.historical_survey_response_audit(
        organization_id,response_id,import_batch_id,action,previous_values,new_values,actor_id
      ) values (
        viewer.organization_id,saved_response_id,batch.id,
        case when import_row.duplicate_action='replace' then 'replaced' else 'imported' end,
        case when import_row.duplicate_action='replace' then response_snapshot else '{}'::jsonb end,
        import_row.normalized_answers,viewer.id
      );
      update public.survey_historical_import_rows set
        historical_response_id=saved_response_id,
        finalized_status=case when duplicate_action='replace' then 'replaced' else 'imported' end,
        row_status='integrated',integrated_at=now(),
        raw_row=jsonb_build_object(
          'surveyType',raw_row->'surveyType','surveyVersion',raw_row->'surveyVersion',
          'sourceResponseId',raw_row->'sourceResponseId','courseName',raw_row->'courseName',
          'wrikeTaskId',raw_row->'wrikeTaskId',
          'respondentName',coalesce(raw_row->'reviewerName',raw_row->'smeName'),
          'respondentEmail',coalesce(raw_row->'reviewerEmail',raw_row->'smeEmail'),
          'reviewedSmeName',coalesce(raw_row->'reviewedSmeName',raw_row->'smeName'),
          'reviewedSmeEmail',coalesce(raw_row->'reviewedSmeEmail',raw_row->'smeEmail'),
          'vertical',raw_row->'vertical'
        ),
        updated_at=now()
      where id=import_row.id;
    exception when others then
      get stacked diagnostics failure_message=message_text;
      update public.survey_historical_import_rows set
        finalized_status='failed',row_status='failed',updated_at=now()
      where id=import_row.id;
      insert into public.survey_historical_import_issues(
        organization_id,batch_id,row_id,issue_code,severity,message
      ) values (
        viewer.organization_id,batch.id,import_row.id,'integration_failed','blocking',
        failure_message
      );
    end;
  end loop;

  update public.survey_historical_import_rows set
    finalized_status=case when row_status='issues' then 'blocked' else 'skipped' end,
    selected_for_import=false,updated_at=now()
  where batch_id=batch.id and finalized_status is null;
  update public.survey_historical_import_rows set
    raw_row=jsonb_build_object(
      'surveyType',raw_row->'surveyType','surveyVersion',raw_row->'surveyVersion',
      'sourceResponseId',raw_row->'sourceResponseId','courseName',raw_row->'courseName',
      'wrikeTaskId',raw_row->'wrikeTaskId',
      'respondentName',coalesce(raw_row->'reviewerName',raw_row->'smeName'),
      'respondentEmail',coalesce(raw_row->'reviewerEmail',raw_row->'smeEmail'),
      'reviewedSmeName',coalesce(raw_row->'reviewedSmeName',raw_row->'smeName'),
      'reviewedSmeEmail',coalesce(raw_row->'reviewedSmeEmail',raw_row->'smeEmail'),
      'vertical',raw_row->'vertical'
    ),updated_at=now()
  where batch_id=batch.id;
  result:=public.finalized_historical_import_summary(batch.id);
  update public.survey_historical_import_batches set
    status=case when coalesce((result->>'failedRows')::integer,0)>0
      then 'partially_integrated' else 'completed' end,
    summary=result,integrated_at=now(),finalized_at=now()
  where id=batch.id;
  return result;
end;
$$;

create or replace function public.match_historical_survey_response_project(
  target_response_id uuid,
  target_task_id uuid
)
returns void language plpgsql security definer set search_path=public as $$
declare viewer public.application_users%rowtype; previous jsonb; next_values jsonb; wrike_task_id text;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  if not found or not public.current_has_capability('manage_data') then
    raise exception using errcode='42501',message='Historical survey matching is unavailable.';
  end if;
  if target_task_id is not null then
    select task.wrike_id into wrike_task_id from public.wrike_tasks task
    where task.id=target_task_id and task.organization_id=viewer.organization_id and not task.is_deleted;
    if not found then raise exception using errcode='22023',message='Select an eligible project.'; end if;
  end if;
  select to_jsonb(response) into previous from public.historical_survey_responses response
  where response.id=target_response_id and response.organization_id=viewer.organization_id for update;
  if not found then raise exception using errcode='22023',message='Historical response not found.'; end if;
  update public.historical_survey_responses response set
    matched_task_id=target_task_id,matched_wrike_task_id=wrike_task_id,
    match_method=case when target_task_id is null then null else 'administrator' end,
    match_confidence=case when target_task_id is null then null else 1 end,updated_at=now()
  where response.id=target_response_id returning to_jsonb(response) into next_values;
  insert into public.historical_survey_response_audit(
    organization_id,response_id,action,previous_values,new_values,actor_id
  ) values (
    viewer.organization_id,target_response_id,
    case when target_task_id is null then 'project_unmatched' else 'project_matched' end,
    previous,next_values,viewer.id
  );
end;
$$;

create or replace view public.survey_reporting_responses
with (security_invoker=true) as
select survey.id,survey.organization_id,'native'::text record_source,
  survey.survey_type,survey.task_id,survey.task_wrike_id,
  coalesce(survey.context_snapshot->>'projectTitle',survey.context_snapshot->>'taskTitle') historical_course_name,
  survey.latest_submitted_at submitted_at,survey.created_at,survey.updated_at,
  null::text survey_version,null::text source_response_id
from public.survey_submissions survey
where survey.status='submitted'
union all
select response.id,response.organization_id,'historical_csv'::text,
  response.internal_survey_type,response.matched_task_id,response.matched_wrike_task_id,
  response.historical_course_name,response.submitted_at,response.created_at,response.updated_at,
  response.survey_version,response.original_source_response_id
from public.historical_survey_responses response;

create or replace function public.survey_browse_unified(
  filters jsonb default '{}'::jsonb,
  page_number integer default 1,
  page_size integer default 50
)
returns table(
  total_count bigint,id uuid,survey_type text,status text,is_locked boolean,
  revision_number integer,updated_at timestamptz,task_id uuid,project_title text,
  sme_name text,creator_id uuid,creator_name text,vertical text,
  reporting_year integer,publication_year integer,record_source text,
  historical_course_name text,match_state text,survey_version text,source_response_id text
)
language plpgsql stable security definer set search_path=public as $$
declare viewer public.application_users%rowtype;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  if not found or not public.current_has_capability('manage_surveys') then
    raise exception using errcode='42501',message='Survey administration is unavailable.';
  end if;
  return query
  with combined as (
    select survey.id,survey.survey_type,survey.status,survey.is_locked,
      survey.revision_number,survey.updated_at,survey.task_id,
      coalesce(survey.context_snapshot->>'projectTitle',
        survey.context_snapshot->>'taskTitle','Unavailable') project_title,
      coalesce(survey.context_snapshot#>>'{subject,name}',reviewed.display_name,'Unavailable') sme_name,
      survey.created_by creator_id,coalesce(creator.display_name,'Historical respondent') creator_name,
      coalesce(review.vertical,survey.context_snapshot->>'vertical') vertical,
      coalesce(debrief.reporting_year,
        case when survey.context_snapshot->>'reportingYear' ~ '^\d{4}$'
          then (survey.context_snapshot->>'reportingYear')::integer end) reporting_year,
      coalesce(review.publication_year,
        case when survey.context_snapshot->>'publicationYear' ~ '^\d{4}$'
          then (survey.context_snapshot->>'publicationYear')::integer end) publication_year,
      'native'::text record_source,
      coalesce(survey.context_snapshot->>'projectTitle',
        survey.context_snapshot->>'taskTitle') historical_course_name,
      'matched'::text match_state,null::text survey_version,null::text source_response_id
    from public.survey_submissions survey
    left join public.application_user_principals creator on creator.id=survey.created_by
    left join public.wrike_users reviewed on reviewed.id=survey.reviewed_wrike_user_id
    left join public.course_development_debrief_responses debrief on debrief.submission_id=survey.id
    left join public.id_sme_review_responses review on review.submission_id=survey.id
    where survey.organization_id=viewer.organization_id
    union all
    select response.id,response.internal_survey_type,'submitted',true,1,
      response.updated_at,response.matched_task_id,response.historical_course_name,
      response.reviewed_sme_name,response.matched_respondent_principal_id,
      coalesce(response.respondent_name,'Historical respondent'),
      id_detail.vertical,null::integer,id_detail.publication_year,
      'historical_csv',response.historical_course_name,
      case when response.matched_task_id is null then 'unmatched' else 'matched' end,
      response.survey_version,response.original_source_response_id
    from public.historical_survey_responses response
    left join public.historical_id_sme_review_responses id_detail
      on id_detail.response_id=response.id
    where response.organization_id=viewer.organization_id
  ), filtered as (
    select * from combined
    where (coalesce(filters->>'surveyType','')='' or combined.survey_type=filters->>'surveyType')
      and (coalesce(filters->>'status','')='' or combined.status=filters->>'status')
      and (coalesce(filters->>'lockState','')='' or (
        filters->>'lockState' in ('true','false')
        and combined.is_locked=(filters->>'lockState')::boolean))
      and (coalesce(filters->>'project','')='' or combined.task_id::text=filters->>'project')
      and (coalesce(filters->>'creator','')='' or combined.creator_id::text=filters->>'creator')
      and (coalesce(filters->>'vertical','')='' or combined.vertical=filters->>'vertical')
      and (coalesce(filters->>'reportingYear','')='' or (
        filters->>'reportingYear' ~ '^\d{4}$'
        and combined.reporting_year=(filters->>'reportingYear')::integer))
      and (coalesce(filters->>'publicationYear','')='' or (
        filters->>'publicationYear' ~ '^\d{4}$'
        and combined.publication_year=(filters->>'publicationYear')::integer))
  )
  select count(*) over(),filtered.id,filtered.survey_type,filtered.status,
    filtered.is_locked,filtered.revision_number,filtered.updated_at,filtered.task_id,
    filtered.project_title,filtered.sme_name,filtered.creator_id,filtered.creator_name,
    filtered.vertical,filtered.reporting_year,filtered.publication_year,
    filtered.record_source,filtered.historical_course_name,filtered.match_state,
    filtered.survey_version,filtered.source_response_id
  from filtered order by filtered.updated_at desc
  limit least(greatest(page_size,1),100)
  offset (greatest(page_number,1)-1)*least(greatest(page_size,1),100);
end;
$$;

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
    union
    select response.matched_reviewed_wrike_user_id
    from public.historical_survey_responses response
      where response.organization_id=viewer.organization_id
        and response.survey_type='SME_DEBRIEF'
        and response.matched_reviewed_wrike_user_id is not null
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
  ), survey_facts as (
    select survey.id,survey.reviewed_wrike_user_id,
      case when survey.status='submitted' and response.internal_employee=false
        then response.billable_hours end billable_hours,
      case when survey.status='submitted' and response.internal_employee=false
        then response.amount_billed end amount_billed
    from public.survey_submissions survey
    left join public.course_development_debrief_responses response on response.submission_id=survey.id
    where survey.organization_id=viewer.organization_id
      and survey.survey_type='course_development_debrief' and survey.status='submitted'
    union all
    select historical.id,historical.matched_reviewed_wrike_user_id,
      detail.billable_hours,detail.amount_billed
    from public.historical_survey_responses historical
    join public.historical_sme_debrief_responses detail on detail.response_id=historical.id
    where historical.organization_id=viewer.organization_id
      and historical.survey_type='SME_DEBRIEF'
      and historical.matched_reviewed_wrike_user_id is not null
  ), survey_totals as (
    select fact.reviewed_wrike_user_id,count(distinct fact.id) submitted_surveys,
      coalesce(sum(fact.billable_hours),0) billable_hours,
      coalesce(sum(fact.amount_billed),0) invoiced_amount
    from survey_facts fact group by fact.reviewed_wrike_user_id
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
    'historical_survey_responses','historical_sme_debrief_responses',
    'historical_id_sme_review_responses','historical_survey_response_revisions',
    'historical_survey_response_audit'
  ] loop
    execute format('alter table public.%I enable row level security',relation_name);
    execute format(
      'create policy "authorized administrators read %1$s" on public.%1$I for select using (public.current_has_capability(''manage_data'') or public.current_has_capability(''manage_surveys''))',
      relation_name
    );
    execute format('revoke all on public.%I from anon,authenticated',relation_name);
    execute format('grant select on public.%I to authenticated',relation_name);
    execute format('grant all on public.%I to service_role',relation_name);
  end loop;
end $$;

revoke all on function public.finalized_historical_import_summary(uuid) from public;
revoke all on function public.finalized_historical_ratings_valid(jsonb,integer) from public;
revoke all on function public.execute_finalized_historical_survey_import(uuid,uuid) from public;
revoke all on function public.match_historical_survey_response_project(uuid,uuid) from public;
revoke all on function public.survey_browse_unified(jsonb,integer,integer) from public;
grant execute on function public.finalized_historical_import_summary(uuid) to authenticated,service_role;
grant execute on function public.execute_finalized_historical_survey_import(uuid,uuid) to authenticated,service_role;
grant execute on function public.match_historical_survey_response_project(uuid,uuid) to authenticated,service_role;
grant execute on function public.survey_browse_unified(jsonb,integer,integer) to authenticated,service_role;
grant select on public.survey_reporting_responses to authenticated,service_role;
select pg_notify('pgrst','reload schema');
