-- Audited SME account classification, trusted debrief context, durable
-- Coordinator notifications, and one assignment-safe SME project resolver.

create table public.application_user_sme_profiles (
  application_user_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  classification text check (classification in ('internal','external')),
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(application_user_id,organization_id)
    references public.application_users(id,organization_id) on delete cascade,
  foreign key(updated_by,organization_id)
    references public.application_user_principals(id,organization_id)
);

create table public.application_user_sme_profile_audit (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  application_user_id uuid not null,
  actor_user_id uuid not null,
  previous_classification text check (previous_classification in ('internal','external')),
  classification text not null check (classification in ('internal','external')),
  created_at timestamptz not null default now(),
  foreign key(application_user_id,organization_id)
    references public.application_user_principals(id,organization_id),
  foreign key(actor_user_id,organization_id)
    references public.application_user_principals(id,organization_id)
);

create table public.private_object_deletion_queue (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  bucket text not null,
  object_key text not null,
  reason text not null,
  status text not null default 'pending'
    check (status in ('pending','processing','completed','failed')),
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(bucket,object_key)
);

create table public.sme_debrief_notification_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  submission_id uuid not null references public.survey_submissions(id) on delete cascade,
  revision_number integer not null,
  event_type text not null default 'sme_debrief_submitted'
    check (event_type='sme_debrief_submitted'),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique(submission_id,revision_number,event_type)
);

create table public.sme_debrief_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.sme_debrief_notification_events(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recipient_application_user_id uuid not null,
  status text not null default 'pending'
    check (status in ('pending','processing','delivered','failed','configuration_error','exhausted')),
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  provider_message_id text,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(recipient_application_user_id,organization_id)
    references public.application_users(id,organization_id) on delete cascade,
  unique(event_id,recipient_application_user_id)
);
create index sme_debrief_notification_due_idx
  on public.sme_debrief_notification_deliveries(status,next_attempt_at)
  where status in ('pending','failed','configuration_error');

alter table public.course_development_debrief_responses
  add column reporting_year integer check (reporting_year between 1000 and 9999),
  add column sme_classification text check (sme_classification in ('internal','external'));

insert into public.application_user_sme_profiles(
  application_user_id,organization_id,classification,updated_by
)
select distinct member.id,member.organization_id,null::text,null::uuid
from public.application_users member
where member.role='sme'
  or exists(
    select 1 from public.application_user_operational_personas persona
    where persona.application_user_id=member.id
      and persona.organization_id=member.organization_id
      and persona.operational_role='sme' and persona.is_active
  )
on conflict(application_user_id) do nothing;

create or replace function public.trusted_sme_debrief_definition(definition jsonb)
returns jsonb
language sql
immutable
parallel safe
set search_path=public
as $$
  select jsonb_set(
    definition,'{sections}',
    coalesce((
      select jsonb_agg(
        section_value || jsonb_build_object(
          'questions',
          coalesce((
            select jsonb_agg(question_value order by question_order)
            from jsonb_array_elements(section_value->'questions')
              with ordinality questions(question_value,question_order)
            where question_value->>'id' not in ('internalEmployee','originalDueYear')
          ),'[]'::jsonb)
        )
        order by section_order
      )
      from jsonb_array_elements(definition->'sections')
        with ordinality sections(section_value,section_order)
    ),'[]'::jsonb),
    true
  );
$$;

-- Remove the legacy editable trusted-context questions from every active
-- authored draft, create a sanitized immutable published version, and refresh
-- existing unsubmitted snapshots without changing historical submissions.
update public.survey_template_drafts draft
set definition=public.trusted_sme_debrief_definition(draft.definition),
    updated_at=now()
from public.survey_templates template
where template.id=draft.template_id
  and template.survey_type='course_development_debrief'
  and template.archived_at is null;

with latest as (
  select distinct on (template.id)
    template.id template_id,template.organization_id,template.survey_type,
    version.definition
  from public.survey_templates template
  join public.survey_template_versions version on version.template_id=template.id
  where template.survey_type='course_development_debrief'
    and template.archived_at is null
  order by template.id,version.version_number desc
), maximums as (
  select organization_id,survey_type,max(version_number) maximum_version
  from public.survey_template_versions
  group by organization_id,survey_type
), numbered as (
  select latest.*,
    maximums.maximum_version+row_number() over (
      partition by latest.organization_id,latest.survey_type
      order by latest.template_id
    ) version_number
  from latest
  join maximums using(organization_id,survey_type)
)
insert into public.survey_template_versions(
  template_id,organization_id,survey_type,version_number,definition
)
select template_id,organization_id,survey_type,version_number,
  public.trusted_sme_debrief_definition(definition)
from numbered;

update public.survey_submissions survey
set definition_snapshot=public.trusted_sme_debrief_definition(survey.definition_snapshot),
    answers=survey.answers-'internalEmployee'-'originalDueYear'
      -'reportingYear'-'smeClassification',
    context_snapshot=survey.context_snapshot-'internalEmployee'-'originalDueYear'
      -'reportingYear'-'smeClassification',
    updated_at=now()
where survey.survey_type='course_development_debrief'
  and survey.status='draft';

create or replace function public.prevent_editable_sme_trusted_context()
returns trigger
language plpgsql
set search_path=public
as $$
declare template_type text;
begin
  select template.survey_type into template_type
  from public.survey_templates template where template.id=new.template_id;
  if template_type='course_development_debrief' and exists(
    select 1
    from jsonb_array_elements(new.definition->'sections') section_value
    cross join lateral jsonb_array_elements(section_value->'questions') question_value
    where question_value->>'id' in (
      'internalEmployee','originalDueYear','reportingYear','smeClassification'
    )
  ) then
    raise exception using errcode='23514',
      message='SME type and Course Reporting Year are trusted context and cannot be editable survey questions.';
  end if;
  return new;
end;
$$;
create trigger reserve_sme_context_in_template_drafts
before insert or update of definition on public.survey_template_drafts
for each row execute function public.prevent_editable_sme_trusted_context();
create trigger reserve_sme_context_in_template_versions
before insert on public.survey_template_versions
for each row execute function public.prevent_editable_sme_trusted_context();

create or replace function public.seed_default_survey_templates(target_organization_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare requested_type text; template_id uuid; seeded_definition jsonb;
begin
  foreach requested_type in array array['course_development_debrief','id_sme_review'] loop
    seeded_definition:=public.default_survey_definition(requested_type);
    if requested_type='course_development_debrief' then
      seeded_definition:=public.trusted_sme_debrief_definition(seeded_definition);
    end if;
    insert into public.survey_templates(organization_id,survey_type,template_key)
    values(target_organization_id,requested_type,'primary')
    on conflict (organization_id,survey_type,template_key)
    do update set updated_at=public.survey_templates.updated_at
    returning id into template_id;
    insert into public.survey_template_drafts(template_id,organization_id,definition)
    values(template_id,target_organization_id,seeded_definition)
    on conflict (template_id) do nothing;
    insert into public.survey_template_versions(
      template_id,organization_id,survey_type,version_number,definition
    ) values (
      template_id,target_organization_id,requested_type,1,seeded_definition
    ) on conflict (organization_id,survey_type,version_number) do nothing;
  end loop;
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
  identity_id uuid;
  identity_name text;
  classification_value text;
  task_record public.wrike_tasks%rowtype;
  year_count integer;
  reporting_year_value integer;
  vertical_value text;
  course_length text;
  legal_reviewer text;
  assigned_ids jsonb;
  status_name text;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  select * into subject from public.application_users
  where id=target_application_user_id
    and organization_id=viewer.organization_id and account_state='active';
  if viewer.id is null or subject.id is null or (
    viewer.id<>subject.id
    and not (
      public.current_has_management_role('admin')
      or public.current_has_management_role('super_admin')
      or public.current_has_management_role('sme_coordinator')
    )
  ) then
    return jsonb_build_object('ok',false,'code','unavailable',
      'message','Survey context is unavailable.');
  end if;
  if not (
    subject.role='sme' or exists(
      select 1 from public.application_user_operational_personas persona
      where persona.application_user_id=subject.id
        and persona.organization_id=subject.organization_id
        and persona.operational_role='sme' and persona.is_active
    )
  ) then
    return jsonb_build_object('ok',false,'code','sme_role_missing',
      'message','This account does not have active SME access.');
  end if;
  select coalesce(
    (select persona.wrike_user_id
      from public.application_user_operational_personas persona
      where persona.application_user_id=subject.id
        and persona.organization_id=subject.organization_id
        and persona.operational_role='sme' and persona.is_active
      limit 1),
    subject.wrike_user_id
  ) into identity_id;
  if identity_id is null then
    return jsonb_build_object('ok',false,'code','wrike_mapping_missing',
      'message','A verified Wrike identity must be configured before this survey can be submitted.');
  end if;
  select identity.display_name into identity_name
  from public.wrike_users identity
  where identity.id=identity_id and identity.organization_id=subject.organization_id
    and identity.is_active and not identity.is_unresolved
    and identity.identity_verified;
  if identity_name is null then
    return jsonb_build_object('ok',false,'code','wrike_mapping_unverified',
      'message','The SME Wrike identity is missing or unverified.');
  end if;
  select * into task_record from public.wrike_tasks
  where id=target_task_id and organization_id=subject.organization_id and not is_deleted;
  if task_record.id is null or not public.is_course_development_person_assigned(
    target_task_id,'sme',identity_id
  ) then
    return jsonb_build_object('ok',false,'code','assignment_missing',
      'message','The Wrike SME field does not explicitly assign this account to the project.');
  end if;
  select profile.classification into classification_value
  from public.application_user_sme_profiles profile
  where profile.application_user_id=subject.id
    and profile.organization_id=subject.organization_id;
  select count(distinct value.reporting_year),
    min(value.reporting_year)
  into year_count,reporting_year_value
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
        'subject',jsonb_build_object('applicationUserId',subject.id,
          'wrikeUserId',identity_id,'name',identity_name),
        'reportingYear',case when year_count=1 then reporting_year_value end
      )
    );
  end if;
  if year_count<>1 then
    return jsonb_build_object(
      'ok',false,'code','reporting_year_missing',
      'message','The project must have one unambiguous Wrike Reporting Year before this survey can be submitted.',
      'context',jsonb_build_object(
        'taskTitle',task_record.title,'status',status_name,
        'smeClassification',classification_value,
        'subject',jsonb_build_object('applicationUserId',subject.id,
          'wrikeUserId',identity_id,'name',identity_name)
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
      'subject',jsonb_build_object('applicationUserId',subject.id,
        'wrikeUserId',identity_id,'name',identity_name)
    )
  );
end;
$$;

create or replace function public.queue_private_object_deletion(
  target_organization_id uuid,target_bucket text,target_object_key text,target_reason text
)
returns void
language sql
security definer
set search_path=public
as $$
  insert into public.private_object_deletion_queue(
    organization_id,bucket,object_key,reason
  ) values (
    target_organization_id,target_bucket,target_object_key,target_reason
  )
  on conflict(bucket,object_key) do update set
    status='pending',next_attempt_at=now(),last_error=null,completed_at=null;
$$;

create or replace function public.set_application_user_sme_classification(
  target_application_user_id uuid,target_classification text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  actor public.application_users%rowtype;
  target public.application_users%rowtype;
  previous_value text;
  attachment_record record;
begin
  select * into actor from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  if actor.id is null or not (
    public.current_has_management_role('admin')
    or public.current_has_management_role('super_admin')
  ) or target_classification not in ('internal','external') then
    raise exception using errcode='42501',message='SME classification cannot be changed.';
  end if;
  select * into target from public.application_users
  where id=target_application_user_id
    and organization_id=actor.organization_id and account_state='active';
  if target.id is null or not (
    target.role='sme' or exists(
      select 1 from public.application_user_operational_personas persona
      where persona.application_user_id=target.id
        and persona.organization_id=target.organization_id
        and persona.operational_role='sme' and persona.is_active
    )
  ) then
    raise exception using errcode='23514',
      message='SME type is available only for an active SME account.';
  end if;
  select classification into previous_value
  from public.application_user_sme_profiles
  where application_user_id=target.id for update;
  insert into public.application_user_sme_profiles(
    application_user_id,organization_id,classification,updated_by,updated_at
  ) values (
    target.id,target.organization_id,target_classification,actor.id,now()
  )
  on conflict(application_user_id) do update set
    classification=excluded.classification,updated_by=excluded.updated_by,
    updated_at=excluded.updated_at;
  insert into public.application_user_sme_profile_audit(
    organization_id,application_user_id,actor_user_id,
    previous_classification,classification
  ) values (
    target.organization_id,target.id,actor.id,previous_value,target_classification
  );
  if target_classification='internal' then
    update public.survey_submissions survey
    set answers=(survey.answers-'billableHours'-'amountBilled'-'internalEmployee'
      -'smeClassification'-'reportingYear'),
      context_snapshot=(survey.context_snapshot
        || jsonb_build_object('smeClassification','internal','internalEmployee',true)),
      updated_at=now(),last_edited_by=actor.id
    where survey.organization_id=target.organization_id
      and survey.subject_application_user_id=target.id
      and survey.survey_type='course_development_debrief'
      and survey.status='draft';
    for attachment_record in
      update public.survey_attachments attachment
      set is_active=false,removed_by=actor.id,removed_at=now()
      from public.survey_submissions survey
      where survey.id=attachment.submission_id
        and survey.organization_id=target.organization_id
        and survey.subject_application_user_id=target.id
        and survey.survey_type='course_development_debrief'
        and survey.status='draft'
        and attachment.kind='invoice' and attachment.is_active
      returning attachment.organization_id,attachment.object_key
    loop
      perform public.queue_private_object_deletion(
        attachment_record.organization_id,'survey-invoices',
        attachment_record.object_key,'sme_reclassified_internal'
      );
    end loop;
  end if;
  return jsonb_build_object(
    'applicationUserId',target.id,'classification',target_classification,
    'previousClassification',previous_value,'updatedAt',now()
  );
end;
$$;

create or replace function public.refresh_sme_debrief_draft_context(
  target_submission_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  survey public.survey_submissions%rowtype;
  configuration jsonb;
  trusted_context jsonb;
  classification_value text;
  attachment_record record;
  cleanup_keys jsonb:='[]'::jsonb;
begin
  select * into survey from public.survey_submissions
  where id=target_submission_id for update;
  if survey.id is null or survey.survey_type<>'course_development_debrief'
    or survey.status<>'draft' or not public.can_view_survey(survey.id) then
    return null;
  end if;
  configuration:=public.sme_debrief_configuration(
    survey.task_id,survey.subject_application_user_id
  );
  trusted_context:=coalesce(configuration->'context','{}'::jsonb)
    || jsonb_build_object(
      'configurationCode',configuration->>'code',
      'configurationMessage',configuration->>'message'
    );
  classification_value:=trusted_context->>'smeClassification';
  update public.survey_submissions set
    definition_snapshot=public.trusted_sme_debrief_definition(definition_snapshot),
    context_snapshot=(context_snapshot
      -'originalDueYear'-'smeClassification'-'internalEmployee'
      -'reportingYear'-'configurationCode'-'configurationMessage')
      || trusted_context,
    answers=case when classification_value='external'
      then (answers-'originalDueYear'-'reportingYear'-'smeClassification')
        || jsonb_build_object('internalEmployee',false)
      else answers-'originalDueYear'-'reportingYear'-'smeClassification'
        -'internalEmployee'-'billableHours'-'amountBilled'
      end,
    updated_at=now()
  where id=survey.id;
  if classification_value is distinct from 'external' then
    for attachment_record in
      update public.survey_attachments
      set is_active=false,removed_at=now()
      where submission_id=survey.id and kind='invoice' and is_active
      returning organization_id,object_key
    loop
      cleanup_keys:=cleanup_keys||to_jsonb(attachment_record.object_key);
      perform public.queue_private_object_deletion(
        attachment_record.organization_id,'survey-invoices',
        attachment_record.object_key,'trusted_sme_context_refresh'
      );
    end loop;
  end if;
  return jsonb_build_object(
    'configuration',configuration,'cleanupObjectKeys',cleanup_keys
  );
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
  own_identity uuid;
  submission_id uuid;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  own_identity:=public.current_operational_identity('sme');
  if viewer.id is null or not public.current_has_operational_role('sme')
    or own_identity is null
    or not public.is_course_development_person_assigned(
      target_task_id,'sme',own_identity
    )
    or not public.survey_sme_status_available(target_task_id) then
    raise exception using errcode='42501',message='Survey context is unavailable.';
  end if;
  select survey.id into submission_id
  from public.survey_submissions survey
  where survey.organization_id=viewer.organization_id
    and survey.task_id=target_task_id
    and survey.survey_type='course_development_debrief'
    and survey.subject_application_user_id=viewer.id;
  if submission_id is null then
    submission_id:=public.survey_personal_create_or_resume_without_submitted_sme_lock(
      target_task_id,own_identity
    );
  else
    if exists(select 1 from public.survey_submissions survey
      where survey.id=submission_id and survey.status='submitted') then
      raise exception using errcode='42501',message='Survey context is unavailable.';
    end if;
  end if;
  perform public.refresh_sme_debrief_draft_context(submission_id);
  return submission_id;
end;
$$;

alter function public.survey_save_versioned(uuid,jsonb,boolean)
  rename to survey_save_versioned_without_trusted_sme_context;

create function public.survey_save_versioned(
  target_submission_id uuid,next_answers jsonb,submit_now boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  viewer public.application_users%rowtype;
  survey public.survey_submissions%rowtype;
  configuration jsonb;
  trusted_context jsonb;
  classification_value text;
  raw_answers jsonb;
  sanitized_answers jsonb;
  sanitized_definition jsonb;
  previous_answers jsonb;
  next_revision integer;
  attachment_record record;
  cleanup_keys jsonb:='[]'::jsonb;
  event_id uuid;
  invoice_id uuid;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  select * into survey from public.survey_submissions
  where id=target_submission_id for update;
  if survey.id is null or survey.organization_id<>viewer.organization_id
    or not public.can_edit_survey(survey.id)
    or jsonb_typeof(next_answers) is distinct from 'object' then
    raise exception using errcode='42501',message='Survey is unavailable.';
  end if;
  if survey.survey_type<>'course_development_debrief' then
    return public.survey_save_versioned_without_trusted_sme_context(
      target_submission_id,next_answers,submit_now
    );
  end if;
  if survey.status='draft' then
    configuration:=public.sme_debrief_configuration(
      survey.task_id,survey.subject_application_user_id
    );
    trusted_context:=coalesce(configuration->'context','{}'::jsonb);
    if submit_now and coalesce((configuration->>'ok')::boolean,false)=false then
      raise exception using errcode='P0001',
        message=coalesce(configuration->>'message','Survey configuration is incomplete.');
    end if;
  else
    trusted_context:=jsonb_build_object(
      'smeClassification',survey.context_snapshot->>'smeClassification',
      'reportingYear',survey.context_snapshot->'reportingYear',
      'internalEmployee',survey.context_snapshot->'internalEmployee'
    );
    configuration:=jsonb_build_object('ok',true,'code','submitted_snapshot');
  end if;
  classification_value:=trusted_context->>'smeClassification';
  sanitized_definition:=public.trusted_sme_debrief_definition(survey.definition_snapshot);
  raw_answers:=next_answers-'originalDueYear'-'reportingYear'
    -'smeClassification'-'internalEmployee';
  if classification_value='external' then
    raw_answers:=raw_answers||jsonb_build_object('internalEmployee',false);
  elsif classification_value='internal' then
    raw_answers:=(raw_answers-'billableHours'-'amountBilled')
      ||jsonb_build_object('internalEmployee',true);
    for attachment_record in
      update public.survey_attachments
      set is_active=false,removed_by=viewer.id,removed_at=now()
      where submission_id=survey.id and kind='invoice' and is_active
      returning organization_id,object_key
    loop
      cleanup_keys:=cleanup_keys||to_jsonb(attachment_record.object_key);
      perform public.queue_private_object_deletion(
        attachment_record.organization_id,'survey-invoices',
        attachment_record.object_key,'internal_sme_debrief'
      );
    end loop;
  end if;
  select coalesce(jsonb_object_agg(answer_value.key,answer_value.value),'{}'::jsonb)
  into sanitized_answers
  from jsonb_each(raw_answers) answer_value
  where answer_value.key='internalEmployee' or exists(
    select 1
    from jsonb_array_elements(sanitized_definition->'sections') section_value
    cross join lateral jsonb_array_elements(section_value->'questions') question_value
    where question_value->>'id'=answer_value.key
      and question_value->>'type'<>'file_upload'
      and public.survey_question_is_visible(question_value,raw_answers)
  );
  if not public.survey_answers_are_valid(
    sanitized_definition,sanitized_answers,
    case when submit_now then survey.id else null end
  ) then
    raise exception using errcode='23514',
      message=case when submit_now
        then 'Complete every required survey field before submitting.'
        else 'Review the survey values before saving.' end;
  end if;
  previous_answers:=survey.answers;
  update public.survey_submissions set
    answers=sanitized_answers,
    definition_snapshot=sanitized_definition,
    context_snapshot=(context_snapshot-'originalDueYear'-'smeClassification'
      -'internalEmployee'-'reportingYear'-'configurationCode'
      -'configurationMessage')
      ||trusted_context
      ||jsonb_build_object(
        'configurationCode',configuration->>'code',
        'configurationMessage',configuration->>'message'
      ),
    last_edited_by=viewer.id,updated_at=now()
  where id=survey.id;
  insert into public.course_development_debrief_responses(
    submission_id,reporting_year,sme_classification,internal_employee,
    billable_hours,amount_billed,work_started_on,work_finished_on,
    rating_01,rating_02,rating_03,rating_04,rating_05,
    rating_06,rating_07,rating_08,rating_09,rating_10,comments,updated_at
  ) values (
    survey.id,nullif(trusted_context->>'reportingYear','')::integer,
    classification_value,classification_value='internal',
    case when classification_value='external'
      then nullif(sanitized_answers->>'billableHours','')::numeric end,
    case when classification_value='external'
      then nullif(sanitized_answers->>'amountBilled','')::numeric end,
    nullif(sanitized_answers->>'workStartedOn','')::date,
    nullif(sanitized_answers->>'workFinishedOn','')::date,
    nullif(sanitized_answers#>>'{collaborationRatings,rating01}','')::smallint,
    nullif(sanitized_answers#>>'{collaborationRatings,rating02}','')::smallint,
    nullif(sanitized_answers#>>'{collaborationRatings,rating03}','')::smallint,
    nullif(sanitized_answers#>>'{collaborationRatings,rating04}','')::smallint,
    nullif(sanitized_answers#>>'{collaborationRatings,rating05}','')::smallint,
    nullif(sanitized_answers#>>'{collaborationRatings,rating06}','')::smallint,
    nullif(sanitized_answers#>>'{collaborationRatings,rating07}','')::smallint,
    nullif(sanitized_answers#>>'{collaborationRatings,rating08}','')::smallint,
    nullif(sanitized_answers#>>'{collaborationRatings,rating09}','')::smallint,
    nullif(sanitized_answers#>>'{collaborationRatings,rating10}','')::smallint,
    nullif(sanitized_answers->>'comments',''),now()
  )
  on conflict(submission_id) do update set
    reporting_year=excluded.reporting_year,
    sme_classification=excluded.sme_classification,
    internal_employee=excluded.internal_employee,
    billable_hours=excluded.billable_hours,amount_billed=excluded.amount_billed,
    work_started_on=excluded.work_started_on,
    work_finished_on=excluded.work_finished_on,
    rating_01=excluded.rating_01,rating_02=excluded.rating_02,
    rating_03=excluded.rating_03,rating_04=excluded.rating_04,
    rating_05=excluded.rating_05,rating_06=excluded.rating_06,
    rating_07=excluded.rating_07,rating_08=excluded.rating_08,
    rating_09=excluded.rating_09,rating_10=excluded.rating_10,
    comments=excluded.comments,updated_at=now();
  if not submit_now then
    insert into public.survey_audit_log(
      submission_id,organization_id,event_type,actor_id,actor_role,
      previous_values,new_values
    ) values (
      survey.id,survey.organization_id,'draft_updated',viewer.id,viewer.role,
      previous_answers,sanitized_answers
    );
    return jsonb_build_object(
      'id',survey.id,'status','draft','locked',false,
      'revision',survey.revision_number,'cleanupObjectKeys',cleanup_keys
    );
  end if;
  next_revision:=case when survey.status='submitted'
    then survey.revision_number+1 else survey.revision_number end;
  insert into public.survey_revisions(
    submission_id,organization_id,revision_number,context_snapshot,
    response_snapshot,attachment_snapshot,changed_fields,submitted_by,
    definition_snapshot,answers_snapshot
  )
  select survey.id,survey.organization_id,next_revision,
    (select context_snapshot from public.survey_submissions where id=survey.id),
    sanitized_answers,
    coalesce((select jsonb_agg(jsonb_build_object(
      'id',attachment.id,'questionId',attachment.question_id,
      'filename',attachment.original_filename,'mimeType',attachment.mime_type,
      'size',attachment.size_bytes
    )) from public.survey_attachments attachment
      where attachment.submission_id=survey.id and attachment.is_active),'[]'::jsonb),
    jsonb_build_object('before',previous_answers,'after',sanitized_answers),
    viewer.id,sanitized_definition,sanitized_answers;
  update public.survey_submissions set status='submitted',is_locked=true,
    revision_number=next_revision,
    original_submitted_at=coalesce(original_submitted_at,now()),
    latest_submitted_at=now(),locked_at=now(),locked_by=viewer.id,
    revision_assignee_id=null,updated_at=now()
  where id=survey.id;
  insert into public.survey_audit_log(
    submission_id,organization_id,event_type,actor_id,actor_role,
    previous_values,new_values
  ) values (
    survey.id,survey.organization_id,
    case when survey.status='submitted' then 'resubmitted' else 'submitted' end,
    viewer.id,viewer.role,previous_answers,sanitized_answers
  );
  select attachment.id into invoice_id
  from public.survey_attachments attachment
  where attachment.submission_id=survey.id
    and attachment.kind='invoice' and attachment.is_active
  order by attachment.uploaded_at desc limit 1;
  insert into public.sme_debrief_notification_events(
    organization_id,submission_id,revision_number,payload
  )
  select survey.organization_id,survey.id,next_revision,
    jsonb_build_object(
      'submissionId',survey.id,'taskId',survey.task_id,
      'smeApplicationUserId',survey.subject_application_user_id,
      'smeWrikeUserId',survey.reviewed_wrike_user_id,
      'smeName',coalesce(subject.display_name,
        trusted_context#>>'{subject,name}','SME'),
      'classification',classification_value,
      'courseTitle',task.title,
      'reportingYear',trusted_context->'reportingYear',
      'projectStatus',coalesce(status.title,task.status),
      'submittedAt',now(),
      'billableHours',case when classification_value='external'
        then sanitized_answers->'billableHours' end,
      'invoicedAmount',case when classification_value='external'
        then sanitized_answers->'amountBilled' end,
      'invoiceAttachmentId',case when classification_value='external'
        then invoice_id end
    )
  from public.wrike_tasks task
  left join public.wrike_workflow_statuses status
    on status.organization_id=task.organization_id
    and status.wrike_id=task.custom_status_id
  left join public.application_users subject
    on subject.id=survey.subject_application_user_id
  where task.id=survey.task_id
  on conflict(submission_id,revision_number,event_type)
  do update set payload=excluded.payload
  returning id into event_id;
  insert into public.sme_debrief_notification_deliveries(
    event_id,organization_id,recipient_application_user_id
  )
  select event_id,survey.organization_id,grant_row.application_user_id
  from public.application_user_management_roles grant_row
  join public.application_users recipient
    on recipient.id=grant_row.application_user_id
    and recipient.organization_id=survey.organization_id
    and recipient.account_state='active'
  where grant_row.organization_id=survey.organization_id
    and grant_row.management_role='sme_coordinator'
    and grant_row.is_active
  on conflict(event_id,recipient_application_user_id) do nothing;
  return jsonb_build_object(
    'id',survey.id,'status','submitted','locked',true,
    'revision',next_revision,'cleanupObjectKeys',cleanup_keys,
    'notificationEventId',event_id
  );
end;
$$;

create or replace function public.sme_debrief_invoice_upload_allowed(
  target_submission_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1
    from public.survey_submissions survey
    join public.application_user_sme_profiles profile
      on profile.application_user_id=survey.subject_application_user_id
      and profile.organization_id=survey.organization_id
      and profile.classification='external'
    where survey.id=target_submission_id
      and survey.survey_type='course_development_debrief'
      and survey.status='draft'
      and public.can_edit_survey(survey.id)
  );
$$;

create or replace function public.claim_sme_debrief_notification_deliveries(
  batch_size integer default 10
)
returns table(
  delivery_id uuid,event_id uuid,organization_id uuid,
  recipient_application_user_id uuid,payload jsonb,attempt_count integer
)
language plpgsql
security definer
set search_path=public
as $$
begin
  if auth.role()<>'service_role' then
    raise exception using errcode='42501',message='Notification delivery is unavailable.';
  end if;
  return query
  with candidates as (
    select delivery.id
    from public.sme_debrief_notification_deliveries delivery
    where (
      delivery.status in ('pending','failed','configuration_error')
      and delivery.next_attempt_at<=now()
    ) or (
      delivery.status='processing' and delivery.locked_until<now()
    )
    order by delivery.next_attempt_at,delivery.created_at
    for update skip locked
    limit greatest(1,least(coalesce(batch_size,10),50))
  ), claimed as (
    update public.sme_debrief_notification_deliveries delivery
    set status='processing',locked_until=now()+interval '5 minutes',
      attempt_count=delivery.attempt_count+1,updated_at=now()
    from candidates
    where delivery.id=candidates.id
    returning delivery.*
  )
  select claimed.id,claimed.event_id,claimed.organization_id,
    claimed.recipient_application_user_id,event.payload,claimed.attempt_count
  from claimed
  join public.sme_debrief_notification_events event on event.id=claimed.event_id;
end;
$$;

create or replace function public.complete_sme_debrief_notification_delivery(
  target_delivery_id uuid,delivered boolean,provider_id text default null,
  failure_message text default null,configuration_failure boolean default false
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare attempts integer;
begin
  if auth.role()<>'service_role' then
    raise exception using errcode='42501',message='Notification delivery is unavailable.';
  end if;
  select attempt_count into attempts
  from public.sme_debrief_notification_deliveries where id=target_delivery_id;
  update public.sme_debrief_notification_deliveries set
    status=case when delivered then 'delivered'
      when attempts>=5 then 'exhausted'
      when configuration_failure then 'configuration_error' else 'failed' end,
    provider_message_id=case when delivered then provider_id else provider_message_id end,
    last_error=case when delivered then null else left(coalesce(failure_message,'Delivery failed.'),2000) end,
    delivered_at=case when delivered then now() else delivered_at end,
    next_attempt_at=case
      when delivered then next_attempt_at
      when attempts<=1 then now()+interval '5 minutes'
      when attempts=2 then now()+interval '30 minutes'
      when attempts=3 then now()+interval '2 hours'
      when attempts=4 then now()+interval '12 hours'
      else now()+interval '24 hours' end,
    locked_until=null,updated_at=now()
  where id=target_delivery_id;
end;
$$;

create or replace function public.retry_sme_debrief_notification_delivery(
  target_delivery_id uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if not (
    public.current_has_management_role('admin')
    or public.current_has_management_role('super_admin')
  ) then
    raise exception using errcode='42501',message='Notification retry is unavailable.';
  end if;
  update public.sme_debrief_notification_deliveries delivery
  set status='pending',next_attempt_at=now(),locked_until=null,
    last_error=null,updated_at=now()
  where delivery.id=target_delivery_id
    and delivery.organization_id=public.current_organization_id()
    and delivery.status<>'delivered';
end;
$$;

create or replace function public.sme_project_access(
  target_task_id uuid,target_sme_wrike_user_id uuid default null
)
returns jsonb
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
    return jsonb_build_object('state','unavailable');
  end if;
  if not exists(
    select 1 from public.wrike_tasks task
    where task.id=target_task_id
      and task.organization_id=viewer.organization_id
      and not task.is_deleted
  ) then
    return jsonb_build_object('state','not_found');
  end if;
  if public.current_has_management_role('sme_coordinator')
    or public.current_has_management_role('admin')
    or public.current_has_management_role('super_admin') then
    selected_identity:=target_sme_wrike_user_id;
    if selected_identity is null then
      return jsonb_build_object('state','selection_required');
    end if;
  else
    selected_identity:=public.current_operational_identity('sme');
    if selected_identity is null then
      return jsonb_build_object('state','mapping_missing');
    end if;
  end if;
  if not exists(
    select 1 from public.wrike_users identity
    where identity.id=selected_identity
      and identity.organization_id=viewer.organization_id
      and identity.is_active and not identity.is_unresolved
      and identity.identity_verified
  ) then
    return jsonb_build_object('state','identity_unavailable');
  end if;
  if not public.is_course_development_person_assigned(
    target_task_id,'sme',selected_identity
  ) then
    return jsonb_build_object('state','not_assigned');
  end if;
  return jsonb_build_object(
    'state','allowed','selectedSmeWrikeUserId',selected_identity
  );
end;
$$;

create or replace function public.sme_project_detail(
  target_task_id uuid,target_sme_wrike_user_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  access_result jsonb;
  viewer public.application_users%rowtype;
  selected_identity uuid;
  task_record public.wrike_tasks%rowtype;
  subject_id uuid;
  status_name text;
  status_color text;
  reporting_year_value integer;
  vertical_value text;
  course_length text;
  legal_reviewer text;
  assigned_ids jsonb;
  category_time jsonb;
  finalized_draft jsonb;
  debrief jsonb;
begin
  access_result:=public.sme_project_access(
    target_task_id,target_sme_wrike_user_id
  );
  if access_result->>'state'<>'allowed' then return access_result; end if;
  selected_identity:=(access_result->>'selectedSmeWrikeUserId')::uuid;
  select * into viewer from public.application_users
  where id=public.current_effective_user_id();
  select * into task_record from public.wrike_tasks
  where id=target_task_id and organization_id=viewer.organization_id
    and not is_deleted;
  if task_record.id is null then return jsonb_build_object('state','unavailable'); end if;
  select coalesce(status.title,task_record.status),status.color
  into status_name,status_color
  from (select 1) seed
  left join public.wrike_workflow_statuses status
    on status.organization_id=viewer.organization_id
    and status.wrike_id=task_record.custom_status_id;
  select coalesce(
    (select persona.application_user_id
      from public.application_user_operational_personas persona
      where persona.organization_id=viewer.organization_id
        and persona.operational_role='sme'
        and persona.wrike_user_id=selected_identity and persona.is_active
      limit 1),
    (select member.id from public.application_users member
      where member.organization_id=viewer.organization_id
        and member.role='sme' and member.wrike_user_id=selected_identity
      limit 1)
  ) into subject_id;
  select value.reporting_year into reporting_year_value
  from public.wrike_task_normalized_custom_field_values value
  join public.wrike_normalized_custom_fields field
    on field.id=value.normalized_field_id
    and field.organization_id=viewer.organization_id
  where value.task_id=target_task_id
    and field.normalized_key in ('reporting','reporting year')
    and cardinality(value.source_wrike_field_ids)>0
    and not value.has_conflict and value.reporting_year is not null
  limit 1;
  select value.vertical_reporting_category into vertical_value
  from public.wrike_task_normalized_custom_field_values value
  join public.wrike_normalized_custom_fields field
    on field.id=value.normalized_field_id
    and field.organization_id=viewer.organization_id
  where value.task_id=target_task_id and field.normalized_key='vertical'
    and not value.has_conflict and not value.has_unresolved_vertical
  limit 1;
  select array_to_string(value.display_values,', ') into course_length
  from public.wrike_task_normalized_custom_field_values value
  join public.wrike_normalized_custom_fields field
    on field.id=value.normalized_field_id
    and field.organization_id=viewer.organization_id
  where value.task_id=target_task_id
    and field.normalized_key in ('course length','course duration','estimated course length')
    and not value.has_conflict
  limit 1;
  select array_to_string(value.display_values,', ') into legal_reviewer
  from public.wrike_task_normalized_custom_field_values value
  join public.wrike_normalized_custom_fields field
    on field.id=value.normalized_field_id
    and field.organization_id=viewer.organization_id
  where value.task_id=target_task_id
    and field.normalized_key='legal reviewer' and not value.has_conflict
  limit 1;
  select coalesce(jsonb_agg(jsonb_build_object(
    'wrikeUserId',identity.id,'name',identity.display_name
  ) order by identity.display_name),'[]'::jsonb)
  into assigned_ids
  from public.course_development_person_assignments(
    viewer.organization_id,'id'
  ) assignment
  join public.wrike_users identity on identity.id=assignment.wrike_user_id
  where assignment.task_id=target_task_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'category',grouped.category_name,'minutes',grouped.minutes
  ) order by grouped.minutes desc,grouped.category_name),'[]'::jsonb)
  into category_time
  from (
    select coalesce(category.title,'Uncategorized') category_name,
      sum(entry.minutes)::bigint minutes
    from public.wrike_time_entries entry
    left join public.wrike_timelog_categories category
      on category.organization_id=viewer.organization_id
      and category.wrike_id=entry.category
    where entry.task_id=target_task_id and not entry.is_deleted
    group by coalesce(category.title,'Uncategorized')
  ) grouped;
  select jsonb_build_object(
    'available',draft.url is not null,'url',draft.url,'updatedAt',draft.updated_at
  ) into finalized_draft
  from public.project_finalized_course_drafts draft
  where draft.organization_id=viewer.organization_id
    and draft.task_id=target_task_id;
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
      'attachments',case when public.current_has_capability('view_sme_survey_details')
        then coalesce((
          select jsonb_agg(jsonb_build_object(
            'id',attachment.id,'filename',attachment.original_filename,
            'sizeBytes',attachment.size_bytes,'uploadedAt',attachment.uploaded_at
          ) order by attachment.uploaded_at desc)
          from public.survey_attachments attachment
          where attachment.submission_id=survey.id and attachment.is_active
        ),'[]'::jsonb) else '[]'::jsonb end
    ) end
  into debrief
  from public.survey_submissions survey
  where survey.organization_id=viewer.organization_id
    and survey.task_id=target_task_id
    and survey.survey_type='course_development_debrief'
    and survey.reviewed_wrike_user_id=selected_identity;
  return jsonb_build_object(
    'state','allowed','taskId',task_record.id,'title',task_record.title,
    'status',status_name,'statusColor',status_color,
    'reportingYear',reporting_year_value,'assignedIds',assigned_ids,
    'vertical',vertical_value,'courseLength',course_length,
    'legalReviewer',legal_reviewer,'debrief',debrief,
    'finalizedDraft',coalesce(finalized_draft,jsonb_build_object('available',false)),
    'timeline',jsonb_build_object(
      'startDate',task_record.start_date,
      'originalDueDate',task_record.original_due_date,
      'dueDate',task_record.due_date,'completedAt',task_record.completed_at
    ),
    'categoryTime',category_time,
    'subjectApplicationUserId',subject_id,
    'isRecent',case when task_record.completed_at is not null
      then task_record.completed_at::date>=current_date-interval '12 months'
      else task_record.due_date is not null
        and task_record.due_date>=current_date-interval '12 months' end,
    'selectedSmeWrikeUserId',selected_identity
  );
end;
$$;

alter table public.application_user_sme_profiles enable row level security;
alter table public.application_user_sme_profile_audit enable row level security;
alter table public.private_object_deletion_queue enable row level security;
alter table public.sme_debrief_notification_events enable row level security;
alter table public.sme_debrief_notification_deliveries enable row level security;

create policy "administrators read sme profiles"
on public.application_user_sme_profiles for select
using (
  organization_id=public.current_organization_id() and (
    public.current_has_management_role('admin')
    or public.current_has_management_role('super_admin')
  )
);
create policy "administrators read sme profile audit"
on public.application_user_sme_profile_audit for select
using (
  organization_id=public.current_organization_id() and (
    public.current_has_management_role('admin')
    or public.current_has_management_role('super_admin')
  )
);
create policy "administrators read notification events"
on public.sme_debrief_notification_events for select
using (
  organization_id=public.current_organization_id() and (
    public.current_has_management_role('admin')
    or public.current_has_management_role('super_admin')
  )
);
create policy "administrators read notification deliveries"
on public.sme_debrief_notification_deliveries for select
using (
  organization_id=public.current_organization_id() and (
    public.current_has_management_role('admin')
    or public.current_has_management_role('super_admin')
  )
);

revoke all on public.application_user_sme_profiles,
  public.application_user_sme_profile_audit,
  public.private_object_deletion_queue,
  public.sme_debrief_notification_events,
  public.sme_debrief_notification_deliveries from anon,authenticated;
grant select on public.application_user_sme_profiles,
  public.application_user_sme_profile_audit,
  public.sme_debrief_notification_events,
  public.sme_debrief_notification_deliveries to authenticated;
grant all on public.application_user_sme_profiles,
  public.application_user_sme_profile_audit,
  public.private_object_deletion_queue,
  public.sme_debrief_notification_events,
  public.sme_debrief_notification_deliveries to service_role;

revoke all on function public.trusted_sme_debrief_definition(jsonb) from public;
revoke all on function public.prevent_editable_sme_trusted_context() from public;
revoke all on function public.sme_debrief_configuration(uuid,uuid) from public;
revoke all on function public.queue_private_object_deletion(uuid,text,text,text) from public;
revoke all on function public.set_application_user_sme_classification(uuid,text) from public;
revoke all on function public.refresh_sme_debrief_draft_context(uuid) from public;
revoke all on function public.survey_personal_create_or_resume_sme_debrief(uuid) from public;
revoke all on function public.survey_save_versioned(uuid,jsonb,boolean) from public;
revoke all on function public.survey_save_versioned_without_trusted_sme_context(uuid,jsonb,boolean)
  from public,anon,authenticated;
revoke all on function public.sme_debrief_invoice_upload_allowed(uuid) from public;
revoke all on function public.claim_sme_debrief_notification_deliveries(integer) from public;
revoke all on function public.complete_sme_debrief_notification_delivery(uuid,boolean,text,text,boolean)
  from public;
revoke all on function public.retry_sme_debrief_notification_delivery(uuid) from public;
revoke all on function public.sme_project_access(uuid,uuid) from public;
revoke all on function public.sme_project_detail(uuid,uuid) from public;

grant execute on function public.sme_debrief_configuration(uuid,uuid),
  public.set_application_user_sme_classification(uuid,text),
  public.refresh_sme_debrief_draft_context(uuid),
  public.survey_personal_create_or_resume_sme_debrief(uuid),
  public.survey_save_versioned(uuid,jsonb,boolean),
  public.sme_debrief_invoice_upload_allowed(uuid),
  public.retry_sme_debrief_notification_delivery(uuid),
  public.sme_project_access(uuid,uuid),
  public.sme_project_detail(uuid,uuid)
  to authenticated,service_role;
grant execute on function public.trusted_sme_debrief_definition(jsonb),
  public.queue_private_object_deletion(uuid,text,text,text),
  public.claim_sme_debrief_notification_deliveries(integer),
  public.complete_sme_debrief_notification_delivery(uuid,boolean,text,text,boolean)
  to service_role;

comment on table public.application_user_sme_profiles is
  'Account-level SME classification. Null is an intentional not-configured state and is never inferred from survey answers.';
comment on function public.sme_project_access(uuid,uuid) is
  'Central organization, capability, verified-identity, and exact Wrike SME-field assignment resolver shared by direct and intercepted SME project pages.';

select pg_notify('pgrst','reload schema');
