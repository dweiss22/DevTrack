-- Versioned no-code survey definitions, role-scoped personal requirements, and
-- immutable definition/answer snapshots. Existing typed response tables and
-- invoice objects remain in place for forward and rollback compatibility.

create table public.survey_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  survey_type text not null check (survey_type in ('course_development_debrief','id_sme_review')),
  template_key text not null default 'primary' check (template_key ~ '^[a-z0-9_-]{1,100}$'),
  archived_at timestamptz,
  archived_by uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,survey_type,template_key),
  foreign key (archived_by,organization_id)
    references public.application_user_principals(id,organization_id),
  foreign key (created_by,organization_id)
    references public.application_user_principals(id,organization_id)
);

create table public.survey_template_drafts (
  template_id uuid primary key references public.survey_templates(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  definition jsonb not null,
  lock_version integer not null default 1 check (lock_version > 0),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  foreign key (updated_by,organization_id)
    references public.application_user_principals(id,organization_id)
);

create table public.survey_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.survey_templates(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  survey_type text not null check (survey_type in ('course_development_debrief','id_sme_review')),
  version_number integer not null check (version_number > 0),
  definition jsonb not null,
  published_by uuid,
  published_at timestamptz not null default now(),
  unique (organization_id,survey_type,version_number),
  foreign key (published_by,organization_id)
    references public.application_user_principals(id,organization_id)
);
create index survey_template_versions_template_idx
  on public.survey_template_versions(template_id,version_number desc);

create table public.survey_template_audit_log (
  id bigint generated always as identity primary key,
  template_id uuid not null references public.survey_templates(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_type text not null check (event_type in ('draft_saved','published','duplicated','archived','restored')),
  actor_id uuid not null,
  authenticated_actor_id uuid not null,
  actor_role text not null check (actor_role in ('super_admin','admin')),
  previous_values jsonb not null default '{}'::jsonb,
  new_values jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (actor_id,organization_id)
    references public.application_user_principals(id,organization_id),
  foreign key (authenticated_actor_id,organization_id)
    references public.application_user_principals(id,organization_id)
);

create or replace function public.default_survey_definition(requested_type text)
returns jsonb language plpgsql immutable set search_path=public as $$
begin
  if requested_type='course_development_debrief' then
    return $definition$
    {
      "schemaVersion":1,
      "surveyType":"course_development_debrief",
      "title":"Course Development Debrief",
      "introduction":"Share your experience developing this course with Lexipol.",
      "instructions":"Complete every required field. You may save a draft and return before submitting.",
      "completionMessage":"Survey submitted successfully. Your response is locked and its history has been preserved.",
      "presentation":"one_page",
      "buttons":{"saveDraft":"Save draft","previous":"Previous","next":"Next","submit":"Submit survey","return":"Return to dashboard"},
      "sections":[
        {"id":"project-details","title":"Project details","description":"","pageBreakBefore":false,"questions":[
          {"id":"originalDueYear","type":"number","label":"Course’s Original Due Year","helpText":"","required":true,"width":"half","contextBinding":"originalDueYear","validation":{"min":1000,"max":9999,"step":1}},
          {"id":"internalEmployee","type":"yes_no","label":"Are you an internal Lexipol employee?","helpText":"","required":true,"width":"half","validation":{}}
        ]},
        {"id":"billing","title":"Billable information","description":"External SMEs must provide billing details and an invoice.","pageBreakBefore":false,"questions":[
          {"id":"billableHours","type":"number","label":"Billable Hours","helpText":"","required":true,"width":"half","validation":{"min":0,"max":99999999,"step":0.01},"visibility":{"match":"all","rules":[{"questionId":"internalEmployee","operator":"equals","value":false}]}},
          {"id":"amountBilled","type":"currency","label":"Amount Billed (USD)","helpText":"","required":true,"width":"half","validation":{"min":0,"max":99999999,"step":0.01},"visibility":{"match":"all","rules":[{"questionId":"internalEmployee","operator":"equals","value":false}]}},
          {"id":"invoice","type":"file_upload","label":"Invoice","helpText":"","required":true,"width":"full","validation":{"maxSizeBytes":10485760,"allowedExtensions":["pdf","doc","docx","xls","xlsx","png","jpg","jpeg"]},"visibility":{"match":"all","rules":[{"questionId":"internalEmployee","operator":"equals","value":false}]}}
        ]},
        {"id":"dates","title":"Dates","description":"","pageBreakBefore":false,"questions":[
          {"id":"workStartedOn","type":"date","label":"When did you START working on this project?","helpText":"","required":true,"width":"half","validation":{}},
          {"id":"workFinishedOn","type":"date","label":"When did you FINISH working on this project?","helpText":"","required":true,"width":"half","validation":{}}
        ]},
        {"id":"ratings","title":"Collaboration ratings","description":"","pageBreakBefore":false,"questions":[
          {"id":"collaborationRatings","type":"rating_matrix","label":"Rate each statement","helpText":"","required":true,"width":"full","validation":{},"rows":[
            {"id":"rating01","label":"I had a positive experience working with Lexipol as a course developer or contributor."},
            {"id":"rating02","label":"The goals and objectives set by Lexipol for my contributions were clear."},
            {"id":"rating03","label":"Lexipol staff were responsive to my inquiries, questions, and concerns related to course development."},
            {"id":"rating04","label":"The tools and resources provided by Lexipol met my needs to complete assigned work."},
            {"id":"rating05","label":"The training and support provided by Lexipol met my needs to complete assigned work."},
            {"id":"rating06","label":"My expertise was utilized throughout course development."},
            {"id":"rating07","label":"Lexipol was effective in incorporating my feedback."},
            {"id":"rating08","label":"I had autonomy in designing the course content I was tasked with contributing."},
            {"id":"rating09","label":"I felt valued and respected as an SME for Lexipol."},
            {"id":"rating10","label":"I would recommend my peers work with Lexipol for future SME opportunities."}
          ],"scale":{"min":1,"max":5,"minLabel":"Strongly Disagree","maxLabel":"Strongly Agree","labels":["Strongly Disagree","Disagree","Neutral","Agree","Strongly Agree"]}}
        ]},
        {"id":"comments-section","title":"Additional comments","description":"","pageBreakBefore":false,"questions":[
          {"id":"comments","type":"long_text","label":"Please provide any additional comments or suggestions for improving the course development process at Lexipol.","helpText":"","required":false,"width":"full","validation":{"maxLength":5000}}
        ]}
      ]
    }
    $definition$::jsonb;
  elsif requested_type='id_sme_review' then
    return $definition$
    {
      "schemaVersion":1,
      "surveyType":"id_sme_review",
      "title":"Review of Subject Matter Expert",
      "introduction":"It’s time to share your insights on your recent work with the SME assigned to this project.",
      "instructions":"Complete every required field. You may save a draft and return before submitting.",
      "completionMessage":"Review submitted successfully. Your response is locked and its history has been preserved.",
      "presentation":"one_page",
      "buttons":{"saveDraft":"Save draft","previous":"Previous","next":"Next","submit":"Submit survey","return":"Return to dashboard"},
      "sections":[
        {"id":"publication-context","title":"Publication context","description":"","pageBreakBefore":false,"questions":[
          {"id":"publicationYear","type":"number","label":"Publication Year","helpText":"","required":true,"width":"half","contextBinding":"publicationYear","validation":{"min":1000,"max":9999,"step":1}},
          {"id":"vertical","type":"single_choice","label":"Vertical","helpText":"","required":true,"width":"half","contextBinding":"vertical","validation":{},"options":[
            {"id":"P1A","label":"P1A"},{"id":"FR1A","label":"FR1A"},{"id":"EMS1","label":"EMS1"},{"id":"C1A","label":"C1A"},{"id":"LGU","label":"LGU"},{"id":"D1A","label":"D1A"},{"id":"Lexipol","label":"Lexipol"},{"id":"Wellness","label":"Wellness"},{"id":"Cross_Vertical","label":"Cross Vertical"},{"id":"Other","label":"Other"}
          ]}
        ]},
        {"id":"ratings","title":"Collaboration ratings","description":"Use the scale to evaluate different aspects of the collaboration.","pageBreakBefore":false,"questions":[
          {"id":"collaborationRatings","type":"rating_matrix","label":"Rate each statement","helpText":"","required":true,"width":"full","validation":{},"rows":[
            {"id":"rating01","label":"How would you rate your overall experience working with the SME?"},
            {"id":"rating02","label":"How would you evaluate the SME’s knowledge and expertise in public safety?"},
            {"id":"rating03","label":"How responsive was the SME to your inquiries and concerns during the project?"},
            {"id":"rating04","label":"How well did the SME understand the principles of instructional design and the needs of our learners?"},
            {"id":"rating05","label":"How effectively did the SME contribute to the development of course content?"},
            {"id":"rating06","label":"How open was the SME to your suggestions and feedback?"},
            {"id":"rating07","label":"How well did the SME meet deadlines and adhere to the project schedule?"},
            {"id":"rating08","label":"How would you rate the overall quality of the course content provided by the SME?"},
            {"id":"rating09","label":"How effectively did the SME assist in making the course content accessible and engaging for learners?"}
          ],"scale":{"min":1,"max":5,"minLabel":"Needs Improvement","maxLabel":"Exceeds Expectations","labels":["Needs Improvement","Below Expectations","Meets Expectations","Above Expectations","Exceeds Expectations"]}}
        ]},
        {"id":"examples","title":"Real-world examples","description":"","pageBreakBefore":false,"questions":[
          {"id":"providedRealWorldExamples","type":"yes_no","label":"Did the SME provide sufficient real-world examples and/or case studies for inclusion in the course?","helpText":"","required":true,"width":"full","validation":{}},
          {"id":"realWorldExamplesEffectiveness","type":"rating_scale","label":"Rate the effectiveness of the real-world examples and case studies provided by the SME.","helpText":"","required":true,"width":"full","validation":{},"scale":{"min":1,"max":5,"minLabel":"Barely Lifted Off the Ground","maxLabel":"Out-of-This-World Amazing","labels":["Barely Lifted Off the Ground — The examples were included but did not meaningfully add value.","A Bit Higher — The examples had some use, but their overall impact was limited.","Reached Orbit — The examples made a useful and noticeable contribution.","Shooting for the Moon — The examples significantly enhanced the course content.","Out-of-This-World Amazing — The examples were essential and greatly enriched the learning experience."]},"visibility":{"match":"all","rules":[{"questionId":"providedRealWorldExamples","operator":"equals","value":true}]}}
        ]},
        {"id":"recommendation","title":"Recommendation","description":"","pageBreakBefore":false,"questions":[
          {"id":"recommendationScore","type":"rating_scale","label":"Considering your experience, how likely are you to recommend working with this SME to other team members or instructional designers?","helpText":"","required":true,"width":"full","validation":{},"scale":{"min":0,"max":10,"minLabel":"Not at all likely","maxLabel":"Extremely likely"}}
        ]},
        {"id":"comments-section","title":"Additional comments","description":"","pageBreakBefore":false,"questions":[
          {"id":"comments","type":"long_text","label":"Please provide any additional comments or suggestions for improving the process of working with SMEs in course development.","helpText":"","required":false,"width":"full","validation":{"maxLength":5000}}
        ]}
      ]
    }
    $definition$::jsonb;
  end if;
  raise exception using errcode='22023',message='Unsupported survey type.';
end;
$$;

insert into public.survey_templates(organization_id,survey_type,template_key)
select organization.id,survey_type.value,'primary'
from public.organizations organization
cross join (values ('course_development_debrief'),('id_sme_review')) survey_type(value)
on conflict (organization_id,survey_type,template_key) do nothing;

insert into public.survey_template_drafts(template_id,organization_id,definition)
select template.id,template.organization_id,public.default_survey_definition(template.survey_type)
from public.survey_templates template
where template.template_key='primary'
on conflict (template_id) do nothing;

insert into public.survey_template_versions(
  template_id,organization_id,survey_type,version_number,definition
)
select template.id,template.organization_id,template.survey_type,1,
  public.default_survey_definition(template.survey_type)
from public.survey_templates template
where template.template_key='primary'
on conflict (organization_id,survey_type,version_number) do nothing;

alter table public.survey_submissions
  add column if not exists survey_version_id uuid references public.survey_template_versions(id) on delete restrict,
  add column if not exists survey_version_number integer,
  add column if not exists definition_snapshot jsonb,
  add column if not exists answers jsonb not null default '{}'::jsonb;

update public.survey_submissions submission
set survey_version_id=version.id,
    survey_version_number=version.version_number,
    definition_snapshot=version.definition
from public.survey_template_versions version
where version.organization_id=submission.organization_id
  and version.survey_type=submission.survey_type
  and version.version_number=1
  and submission.survey_version_id is null;

update public.survey_submissions submission
set answers=case
  when submission.survey_type='course_development_debrief' then jsonb_strip_nulls(jsonb_build_object(
    'originalDueYear',debrief.original_due_year,
    'internalEmployee',debrief.internal_employee,
    'billableHours',debrief.billable_hours,
    'amountBilled',debrief.amount_billed,
    'workStartedOn',debrief.work_started_on,
    'workFinishedOn',debrief.work_finished_on,
    'collaborationRatings',jsonb_strip_nulls(jsonb_build_object(
      'rating01',debrief.rating_01,'rating02',debrief.rating_02,'rating03',debrief.rating_03,
      'rating04',debrief.rating_04,'rating05',debrief.rating_05,'rating06',debrief.rating_06,
      'rating07',debrief.rating_07,'rating08',debrief.rating_08,'rating09',debrief.rating_09,
      'rating10',debrief.rating_10
    )),
    'comments',coalesce(debrief.comments,'')
  ))
  else jsonb_strip_nulls(jsonb_build_object(
    'publicationYear',review.publication_year,'vertical',review.vertical,
    'collaborationRatings',jsonb_strip_nulls(jsonb_build_object(
      'rating01',review.rating_01,'rating02',review.rating_02,'rating03',review.rating_03,
      'rating04',review.rating_04,'rating05',review.rating_05,'rating06',review.rating_06,
      'rating07',review.rating_07,'rating08',review.rating_08,'rating09',review.rating_09
    )),
    'providedRealWorldExamples',review.provided_real_world_examples,
    'realWorldExamplesEffectiveness',review.real_world_examples_effectiveness,
    'recommendationScore',review.recommendation_score,
    'comments',coalesce(review.comments,'')
  ))
end
from public.course_development_debrief_responses debrief
full join public.id_sme_review_responses review
  on review.submission_id=debrief.submission_id
where coalesce(debrief.submission_id,review.submission_id)=submission.id
  and submission.answers='{}'::jsonb;

alter table public.survey_submissions
  alter column survey_version_id set not null,
  alter column survey_version_number set not null,
  alter column definition_snapshot set not null;

alter table public.survey_revisions
  add column if not exists definition_snapshot jsonb,
  add column if not exists answers_snapshot jsonb;

update public.survey_revisions revision
set definition_snapshot=submission.definition_snapshot,
    answers_snapshot=case
      when submission.survey_type='course_development_debrief' then jsonb_strip_nulls(jsonb_build_object(
        'originalDueYear',revision.response_snapshot->'original_due_year',
        'internalEmployee',revision.response_snapshot->'internal_employee',
        'billableHours',revision.response_snapshot->'billable_hours',
        'amountBilled',revision.response_snapshot->'amount_billed',
        'workStartedOn',revision.response_snapshot->'work_started_on',
        'workFinishedOn',revision.response_snapshot->'work_finished_on',
        'collaborationRatings',jsonb_strip_nulls(jsonb_build_object(
          'rating01',revision.response_snapshot->'rating_01','rating02',revision.response_snapshot->'rating_02',
          'rating03',revision.response_snapshot->'rating_03','rating04',revision.response_snapshot->'rating_04',
          'rating05',revision.response_snapshot->'rating_05','rating06',revision.response_snapshot->'rating_06',
          'rating07',revision.response_snapshot->'rating_07','rating08',revision.response_snapshot->'rating_08',
          'rating09',revision.response_snapshot->'rating_09','rating10',revision.response_snapshot->'rating_10'
        )),'comments',coalesce(revision.response_snapshot->'comments','""'::jsonb)
      ))
      else jsonb_strip_nulls(jsonb_build_object(
        'publicationYear',revision.response_snapshot->'publication_year',
        'vertical',revision.response_snapshot->'vertical',
        'collaborationRatings',jsonb_strip_nulls(jsonb_build_object(
          'rating01',revision.response_snapshot->'rating_01','rating02',revision.response_snapshot->'rating_02',
          'rating03',revision.response_snapshot->'rating_03','rating04',revision.response_snapshot->'rating_04',
          'rating05',revision.response_snapshot->'rating_05','rating06',revision.response_snapshot->'rating_06',
          'rating07',revision.response_snapshot->'rating_07','rating08',revision.response_snapshot->'rating_08',
          'rating09',revision.response_snapshot->'rating_09'
        )),
        'providedRealWorldExamples',revision.response_snapshot->'provided_real_world_examples',
        'realWorldExamplesEffectiveness',revision.response_snapshot->'real_world_examples_effectiveness',
        'recommendationScore',revision.response_snapshot->'recommendation_score',
        'comments',coalesce(revision.response_snapshot->'comments','""'::jsonb)
      ))
    end
from public.survey_submissions submission
where submission.id=revision.submission_id
  and revision.definition_snapshot is null;

alter table public.survey_revisions
  alter column definition_snapshot set not null,
  alter column answers_snapshot set not null;

alter table public.survey_attachments
  add column if not exists question_id text;
update public.survey_attachments set question_id='invoice' where question_id is null;
alter table public.survey_attachments alter column question_id set not null;
alter table public.survey_attachments drop constraint if exists survey_attachments_kind_check;
alter table public.survey_attachments
  add constraint survey_attachments_kind_check check (kind in ('invoice','file_upload'));
drop index if exists survey_one_active_invoice_per_revision_idx;
create unique index survey_one_active_file_per_question_revision_idx
  on public.survey_attachments(submission_id,revision_number,question_id) where is_active;

create or replace function public.survey_authored_text_is_safe(
  value text,maximum_length integer,required_value boolean default false
) returns boolean language sql immutable set search_path=public as $$
  select length(coalesce(value,''))<=maximum_length
    and (not required_value or length(btrim(coalesce(value,'')))>0)
    and coalesce(value,'') !~* '(<[^>]*>|\m(https?|ftp)://|\mwww\.|javascript:|data:text/html|\m(expression|url)[[:space:]]*\(|\$\{|{{|}})';
$$;

create or replace function public.survey_definition_is_valid(definition jsonb,expected_type text)
returns boolean language plpgsql immutable set search_path=public as $$
declare section jsonb; question jsonb; option_value jsonb; row_value jsonb; rule jsonb;
  question_count integer:=0; section_count integer; option_count integer;
  all_ids text[]:=array[]::text[]; prior_types jsonb:='{}'::jsonb;
  item_id text; question_type text; referenced_type text; operator_name text;
  scale_min integer; scale_max integer; binding text;
begin
  if jsonb_typeof(definition) is distinct from 'object'
    or definition->>'schemaVersion' is distinct from '1'
    or definition->>'surveyType' is distinct from expected_type
    or coalesce(expected_type,'') not in ('course_development_debrief','id_sme_review')
    or not public.survey_authored_text_is_safe(definition->>'title',200,true)
    or not public.survey_authored_text_is_safe(definition->>'introduction',5000,false)
    or not public.survey_authored_text_is_safe(definition->>'instructions',5000,false)
    or not public.survey_authored_text_is_safe(definition->>'completionMessage',5000,true)
    or coalesce(definition->>'presentation','') not in ('one_page','multi_page')
    or jsonb_typeof(definition->'buttons') is distinct from 'object'
    or jsonb_typeof(definition->'sections') is distinct from 'array'
  then return false; end if;
  if not public.survey_authored_text_is_safe(definition#>>'{buttons,saveDraft}',80,true)
    or not public.survey_authored_text_is_safe(definition#>>'{buttons,previous}',80,true)
    or not public.survey_authored_text_is_safe(definition#>>'{buttons,next}',80,true)
    or not public.survey_authored_text_is_safe(definition#>>'{buttons,submit}',80,true)
    or not public.survey_authored_text_is_safe(definition#>>'{buttons,return}',80,true)
  then return false; end if;
  section_count:=jsonb_array_length(definition->'sections');
  if section_count not between 1 and 30 then return false; end if;
  for section in select value from jsonb_array_elements(definition->'sections') loop
    if jsonb_typeof(section) is distinct from 'object'
      or jsonb_typeof(section->'questions') is distinct from 'array'
      or jsonb_typeof(section->'pageBreakBefore') is distinct from 'boolean'
    then return false; end if;
    item_id:=section->>'id';
    if item_id is null or item_id !~ '^[A-Za-z0-9_-]{1,100}$' or item_id=any(all_ids)
      or not public.survey_authored_text_is_safe(section->>'title',200,true)
      or not public.survey_authored_text_is_safe(section->>'description',1000,false)
    then return false; end if;
    all_ids:=array_append(all_ids,item_id);
    question_count:=question_count+jsonb_array_length(section->'questions');
    if question_count>200 then return false; end if;
    for question in select value from jsonb_array_elements(section->'questions') loop
      item_id:=question->>'id';
      question_type:=question->>'type';
      if jsonb_typeof(question) is distinct from 'object'
        or item_id is null or item_id !~ '^[A-Za-z0-9_-]{1,100}$' or item_id=any(all_ids)
        or coalesce(question_type,'') not in (
          'short_text','long_text','number','currency','date','yes_no',
          'single_choice','multiple_choice','rating_scale','rating_matrix','file_upload'
        )
        or not public.survey_authored_text_is_safe(question->>'label',1000,true)
        or not public.survey_authored_text_is_safe(question->>'helpText',1000,false)
        or jsonb_typeof(question->'required') is distinct from 'boolean'
        or coalesce(question->>'width','') not in ('full','half','third')
        or jsonb_typeof(question->'validation') is distinct from 'object'
      then return false; end if;
      binding:=question->>'contextBinding';
      if binding is not null and (
        binding not in ('originalDueYear','publicationYear','vertical')
        or (binding='vertical' and question_type<>'single_choice')
        or (binding in ('originalDueYear','publicationYear') and question_type<>'number')
      ) then return false; end if;
      if question_type in ('single_choice','multiple_choice') then
        if jsonb_typeof(question->'options') is distinct from 'array' then return false; end if;
        option_count:=jsonb_array_length(question->'options');
        if option_count not between 2 and 50 then return false; end if;
        for option_value in select value from jsonb_array_elements(question->'options') loop
          if option_value->>'id' !~ '^[A-Za-z0-9_-]{1,100}$'
            or not public.survey_authored_text_is_safe(option_value->>'label',200,true)
          then return false; end if;
        end loop;
      end if;
      if question_type in ('rating_scale','rating_matrix') then
        if jsonb_typeof(question->'scale') is distinct from 'object'
          or coalesce(question#>>'{scale,min}','') !~ '^-?[0-9]+$'
          or coalesce(question#>>'{scale,max}','') !~ '^-?[0-9]+$'
        then return false; end if;
        scale_min:=(question#>>'{scale,min}')::integer;
        scale_max:=(question#>>'{scale,max}')::integer;
        if scale_min<0 or scale_max>10 or scale_max<=scale_min or scale_max-scale_min>10
          or not public.survey_authored_text_is_safe(question#>>'{scale,minLabel}',200,false)
          or not public.survey_authored_text_is_safe(question#>>'{scale,maxLabel}',200,false)
        then return false; end if;
      end if;
      if question_type='rating_matrix' then
        if jsonb_typeof(question->'rows') is distinct from 'array'
          or jsonb_array_length(question->'rows') not between 1 and 50
        then return false; end if;
        for row_value in select value from jsonb_array_elements(question->'rows') loop
          if row_value->>'id' !~ '^[A-Za-z0-9_-]{1,100}$'
            or not public.survey_authored_text_is_safe(row_value->>'label',200,true)
          then return false; end if;
        end loop;
      end if;
      if question ? 'visibility' then
        if jsonb_typeof(question->'visibility') is distinct from 'object'
          or coalesce(question#>>'{visibility,match}','') not in ('all','any')
          or jsonb_typeof(question#>'{visibility,rules}') is distinct from 'array'
          or jsonb_array_length(question#>'{visibility,rules}') not between 1 and 20
        then return false; end if;
        for rule in select value from jsonb_array_elements(question#>'{visibility,rules}') loop
          referenced_type:=prior_types->>(rule->>'questionId');
          operator_name:=rule->>'operator';
          if referenced_type is null
            or coalesce(operator_name,'') not in (
              'equals','not_equals','contains','not_contains','greater_than',
              'less_than','answered','not_answered'
            )
            or (operator_name not in ('answered','not_answered') and not (rule ? 'value'))
            or (operator_name in ('equals','not_equals') and referenced_type in ('file_upload','rating_matrix'))
            or (operator_name in ('contains','not_contains')
              and referenced_type not in ('short_text','long_text','multiple_choice'))
            or (operator_name in ('greater_than','less_than')
              and referenced_type not in ('number','currency','date','rating_scale'))
          then return false; end if;
        end loop;
      end if;
      all_ids:=array_append(all_ids,item_id);
      prior_types:=prior_types||jsonb_build_object(item_id,question_type);
    end loop;
  end loop;
  return question_count between 1 and 200;
end;
$$;

create or replace function public.prevent_published_survey_version_changes()
returns trigger language plpgsql set search_path=public as $$
begin
  raise exception using errcode='55000',message='Published survey versions are immutable.';
end;
$$;
create trigger immutable_published_survey_version
before update or delete on public.survey_template_versions
for each row execute function public.prevent_published_survey_version_changes();

create or replace function public.seed_default_survey_templates(target_organization_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare requested_type text; template_id uuid;
begin
  foreach requested_type in array array['course_development_debrief','id_sme_review'] loop
    insert into public.survey_templates(organization_id,survey_type,template_key)
    values(target_organization_id,requested_type,'primary')
    on conflict (organization_id,survey_type,template_key)
    do update set updated_at=public.survey_templates.updated_at
    returning id into template_id;
    insert into public.survey_template_drafts(template_id,organization_id,definition)
    values(template_id,target_organization_id,public.default_survey_definition(requested_type))
    on conflict (template_id) do nothing;
    insert into public.survey_template_versions(
      template_id,organization_id,survey_type,version_number,definition
    ) values (
      template_id,target_organization_id,requested_type,1,
      public.default_survey_definition(requested_type)
    ) on conflict (organization_id,survey_type,version_number) do nothing;
  end loop;
end;
$$;

create or replace function public.seed_survey_templates_for_new_organization()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform public.seed_default_survey_templates(new.id);
  return new;
end;
$$;
drop trigger if exists seed_survey_templates_after_organization_insert on public.organizations;
create trigger seed_survey_templates_after_organization_insert
after insert on public.organizations
for each row execute function public.seed_survey_templates_for_new_organization();

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
  if not found or viewer.role not in ('super_admin','admin') then
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
        and candidate.survey_type=template.survey_type and eligible.archived_at is null
    )
  from public.survey_templates template
  join public.survey_template_drafts draft on draft.template_id=template.id
  left join lateral (
    select published.version_number,published.published_at
    from public.survey_template_versions published
    where published.template_id=template.id
    order by published.version_number desc limit 1
  ) version on true
  where template.organization_id=viewer.organization_id
  order by template.survey_type,template.archived_at nulls first,draft.updated_at desc;
end;
$$;

create or replace function public.survey_admin_save_draft(
  target_template_id uuid,next_definition jsonb,expected_lock_version integer
) returns integer language plpgsql security definer set search_path=public as $$
declare viewer public.application_users%rowtype; template public.survey_templates%rowtype;
  previous_definition jsonb; next_lock integer;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  select * into template from public.survey_templates
  where id=target_template_id and organization_id=viewer.organization_id for update;
  if not found or viewer.role not in ('super_admin','admin') or template.archived_at is not null
    or not public.survey_definition_is_valid(next_definition,template.survey_type) then
    raise exception using errcode='42501',message='Survey template is unavailable.';
  end if;
  select definition into previous_definition from public.survey_template_drafts
  where template_id=template.id and lock_version=expected_lock_version for update;
  if not found then raise exception using errcode='40001',message='This survey draft was updated by another administrator.'; end if;
  update public.survey_template_drafts set definition=next_definition,
    lock_version=lock_version+1,updated_by=viewer.id,updated_at=now()
  where template_id=template.id returning lock_version into next_lock;
  update public.survey_templates set updated_at=now() where id=template.id;
  insert into public.survey_template_audit_log(
    template_id,organization_id,event_type,actor_id,authenticated_actor_id,actor_role,
    previous_values,new_values
  ) values (
    template.id,viewer.organization_id,'draft_saved',viewer.id,
    public.current_actor_user_id(),viewer.role,
    jsonb_build_object('lockVersion',expected_lock_version,'title',previous_definition->>'title'),
    jsonb_build_object('lockVersion',next_lock,'title',next_definition->>'title')
  );
  return next_lock;
end;
$$;

create or replace function public.survey_admin_publish(target_template_id uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare viewer public.application_users%rowtype; template public.survey_templates%rowtype;
  draft public.survey_template_drafts%rowtype; next_version integer;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  select * into template from public.survey_templates
  where id=target_template_id and organization_id=viewer.organization_id for update;
  select * into draft from public.survey_template_drafts where template_id=target_template_id;
  if not found or viewer.role not in ('super_admin','admin') or template.archived_at is not null
    or not public.survey_definition_is_valid(draft.definition,template.survey_type) then
    raise exception using errcode='42501',message='Survey template is unavailable.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(viewer.organization_id::text||':'||template.survey_type,0));
  select coalesce(max(version_number),0)+1 into next_version
  from public.survey_template_versions
  where organization_id=viewer.organization_id and survey_type=template.survey_type;
  insert into public.survey_template_versions(
    template_id,organization_id,survey_type,version_number,definition,published_by
  ) values (
    template.id,viewer.organization_id,template.survey_type,next_version,draft.definition,viewer.id
  );
  update public.survey_templates set updated_at=now() where id=template.id;
  insert into public.survey_template_audit_log(
    template_id,organization_id,event_type,actor_id,authenticated_actor_id,actor_role,new_values
  ) values (
    template.id,viewer.organization_id,'published',viewer.id,
    public.current_actor_user_id(),viewer.role,
    jsonb_build_object('version',next_version,'title',draft.definition->>'title')
  );
  return next_version;
end;
$$;

create or replace function public.survey_admin_duplicate_template(target_template_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare viewer public.application_users%rowtype; source public.survey_templates%rowtype;
  source_definition jsonb; duplicate_id uuid; duplicate_key text;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  select * into source from public.survey_templates
  where id=target_template_id and organization_id=viewer.organization_id;
  if not found or viewer.role not in ('super_admin','admin') then
    raise exception using errcode='42501',message='Survey template is unavailable.';
  end if;
  select definition into source_definition from public.survey_template_drafts where template_id=source.id;
  duplicate_key:='copy-'||replace(gen_random_uuid()::text,'-','');
  insert into public.survey_templates(
    organization_id,survey_type,template_key,created_by
  ) values (
    viewer.organization_id,source.survey_type,duplicate_key,viewer.id
  ) returning id into duplicate_id;
  source_definition:=jsonb_set(
    source_definition,'{title}',to_jsonb(('Copy of '||source_definition->>'title')::text)
  );
  insert into public.survey_template_drafts(
    template_id,organization_id,definition,updated_by
  ) values (duplicate_id,viewer.organization_id,source_definition,viewer.id);
  insert into public.survey_template_audit_log(
    template_id,organization_id,event_type,actor_id,authenticated_actor_id,actor_role,new_values
  ) values (
    duplicate_id,viewer.organization_id,'duplicated',viewer.id,
    public.current_actor_user_id(),viewer.role,
    jsonb_build_object('sourceTemplateId',source.id,'title',source_definition->>'title')
  );
  return duplicate_id;
end;
$$;

create or replace function public.survey_admin_set_template_archived(
  target_template_id uuid,archive_template boolean
) returns void language plpgsql security definer set search_path=public as $$
declare viewer public.application_users%rowtype; template public.survey_templates%rowtype;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  select * into template from public.survey_templates
  where id=target_template_id and organization_id=viewer.organization_id for update;
  if not found or viewer.role not in ('super_admin','admin') then
    raise exception using errcode='42501',message='Survey template is unavailable.';
  end if;
  update public.survey_templates set
    archived_at=case when archive_template then coalesce(archived_at,now()) else null end,
    archived_by=case when archive_template then viewer.id else null end,
    updated_at=now()
  where id=template.id;
  insert into public.survey_template_audit_log(
    template_id,organization_id,event_type,actor_id,authenticated_actor_id,actor_role
  ) values (
    template.id,viewer.organization_id,case when archive_template then 'archived' else 'restored' end,
    viewer.id,public.current_actor_user_id(),viewer.role
  );
end;
$$;

create or replace function public.survey_sme_status_available(target_task_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select lower(btrim(coalesce(status.title,task.status,''))) in (
    'testing','testing revisions','ready for loading','published','completed'
  )
  from public.wrike_tasks task
  left join public.wrike_workflow_statuses status
    on status.organization_id=task.organization_id and status.wrike_id=task.custom_status_id
  where task.id=target_task_id and not task.is_deleted;
$$;

create or replace function public.can_view_survey(target_submission_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1
    from public.survey_submissions survey
    join public.application_users viewer
      on viewer.id=public.current_effective_user_id()
      and viewer.organization_id=survey.organization_id
      and viewer.account_state='active'
    where survey.id=target_submission_id and (
      viewer.role in ('super_admin','admin')
      or (
        survey.status='submitted' and (
          (viewer.role='sme' and survey.survey_type='course_development_debrief'
            and survey.subject_application_user_id=viewer.id
            and exists(select 1 from public.survey_revisions revision
              where revision.submission_id=survey.id and revision.submitted_by=viewer.id))
          or (viewer.role='id' and survey.survey_type='id_sme_review' and survey.created_by=viewer.id)
        )
      )
      or (
        survey.status='draft' and viewer.wrike_user_id is not null and (
          (viewer.role='sme' and survey.survey_type='course_development_debrief'
            and survey.subject_application_user_id=viewer.id
            and public.survey_sme_status_available(survey.task_id)
            and exists(select 1 from public.course_development_person_assignments(
              viewer.organization_id,'sme') assignment
              where assignment.task_id=survey.task_id
                and assignment.wrike_user_id=viewer.wrike_user_id))
          or (viewer.role='id' and survey.survey_type='id_sme_review'
            and survey.created_by=viewer.id
            and exists(select 1 from public.course_development_person_assignments(
              viewer.organization_id,'id') assignment
              where assignment.task_id=survey.task_id
                and assignment.wrike_user_id=viewer.wrike_user_id)
            and exists(select 1 from public.course_development_person_assignments(
              viewer.organization_id,'sme') assignment
              where assignment.task_id=survey.task_id
                and assignment.wrike_user_id=survey.reviewed_wrike_user_id))
        )
      )
    )
  );
$$;

create or replace function public.can_edit_survey(target_submission_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1
    from public.survey_submissions survey
    join public.application_users viewer
      on viewer.id=public.current_effective_user_id()
      and viewer.organization_id=survey.organization_id
      and viewer.account_state='active'
    where survey.id=target_submission_id and not survey.is_locked and (
      viewer.role in ('super_admin','admin')
      or (
        survey.status='draft' and viewer.wrike_user_id is not null and (
          (viewer.role='sme' and survey.survey_type='course_development_debrief'
            and survey.subject_application_user_id=viewer.id
            and public.survey_sme_status_available(survey.task_id)
            and exists(select 1 from public.course_development_person_assignments(
              viewer.organization_id,'sme') assignment
              where assignment.task_id=survey.task_id
                and assignment.wrike_user_id=viewer.wrike_user_id))
          or (viewer.role='id' and survey.survey_type='id_sme_review'
            and survey.created_by=viewer.id
            and exists(select 1 from public.course_development_person_assignments(
              viewer.organization_id,'id') assignment
              where assignment.task_id=survey.task_id
                and assignment.wrike_user_id=viewer.wrike_user_id)
            and exists(select 1 from public.course_development_person_assignments(
              viewer.organization_id,'sme') assignment
              where assignment.task_id=survey.task_id
                and assignment.wrike_user_id=survey.reviewed_wrike_user_id))
        )
      )
    )
  );
$$;

create or replace function public.pin_current_survey_version()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.survey_version_id is null then
    select version.id,version.version_number,version.definition
      into new.survey_version_id,new.survey_version_number,new.definition_snapshot
    from public.survey_template_versions version
    join public.survey_templates template on template.id=version.template_id
    where version.organization_id=new.organization_id
      and version.survey_type=new.survey_type and template.archived_at is null
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
drop trigger if exists pin_current_survey_version_before_insert on public.survey_submissions;
create trigger pin_current_survey_version_before_insert
before insert on public.survey_submissions
for each row execute function public.pin_current_survey_version();

create or replace function public.survey_condition_matches(rule jsonb,answers jsonb)
returns boolean language plpgsql immutable set search_path=public as $$
declare actual jsonb:=answers->(rule->>'questionId'); operator text:=rule->>'operator';
begin
  if operator='answered' then return actual is not null and actual<>'null'::jsonb and actual<>'""'::jsonb and actual<>'[]'::jsonb; end if;
  if operator='not_answered' then return actual is null or actual in ('null'::jsonb,'""'::jsonb,'[]'::jsonb); end if;
  if operator='equals' then return actual=rule->'value'; end if;
  if operator='not_equals' then return actual is distinct from rule->'value'; end if;
  if operator='contains' then
    return case when jsonb_typeof(actual)='array' then actual @> jsonb_build_array(rule->'value')
      else trim(both '"' from coalesce(actual::text,'')) like '%'||trim(both '"' from coalesce((rule->'value')::text,''))||'%' end;
  end if;
  if operator='not_contains' then return not public.survey_condition_matches(rule||'{"operator":"contains"}'::jsonb,answers); end if;
  if operator='greater_than' then return (actual#>>'{}')::numeric>(rule->>'value')::numeric; end if;
  if operator='less_than' then return (actual#>>'{}')::numeric<(rule->>'value')::numeric; end if;
  return false;
exception when others then return false;
end;
$$;

create or replace function public.survey_question_is_visible(question jsonb,answers jsonb)
returns boolean language plpgsql immutable set search_path=public as $$
declare visibility jsonb:=question->'visibility'; rule jsonb; result boolean;
begin
  if visibility is null then return true; end if;
  result:=visibility->>'match'='all';
  for rule in select value from jsonb_array_elements(visibility->'rules') loop
    if visibility->>'match'='all' then result:=result and public.survey_condition_matches(rule,answers);
    else result:=result or public.survey_condition_matches(rule,answers); end if;
  end loop;
  return result;
end;
$$;

create or replace function public.survey_answers_are_valid(
  definition jsonb,answers jsonb,target_submission_id uuid
) returns boolean language plpgsql stable security definer set search_path=public as $$
declare question jsonb; answer jsonb; row_value jsonb; question_type text;
  answer_text text; numeric_value numeric; scale_min integer; scale_max integer;
begin
  if jsonb_typeof(answers) is distinct from 'object' then return false; end if;
  for question in
    select question_value
    from jsonb_array_elements(definition->'sections') section_value
    cross join lateral jsonb_array_elements(section_value->'questions') question_value
  loop
    if not public.survey_question_is_visible(question,answers) then continue; end if;
    question_type:=question->>'type';
    answer:=answers->(question->>'id');
    if question_type='file_upload' then
      if target_submission_id is not null
        and coalesce((question->>'required')::boolean,false) and not exists(
        select 1 from public.survey_attachments attachment
        where attachment.submission_id=target_submission_id
          and attachment.question_id=question->>'id' and attachment.is_active
      ) then return false; end if;
      continue;
    end if;
    if target_submission_id is not null and coalesce((question->>'required')::boolean,false)
      and (answer is null or answer in ('null'::jsonb,'""'::jsonb,'[]'::jsonb,'{}'::jsonb))
    then return false; end if;
    if answer is null then continue; end if;
    if question_type in ('short_text','long_text','date','single_choice')
      and jsonb_typeof(answer) is distinct from 'string' then return false; end if;
    if question_type in ('number','currency','rating_scale')
      and jsonb_typeof(answer) is distinct from 'number' then return false; end if;
    if question_type='yes_no' and jsonb_typeof(answer) is distinct from 'boolean' then return false; end if;
    if question_type='multiple_choice' and jsonb_typeof(answer) is distinct from 'array' then return false; end if;
    if question_type in ('short_text','long_text') then
      answer_text:=answer#>>'{}';
      if length(answer_text)>coalesce((question#>>'{validation,maxLength}')::integer,10000)
        or length(answer_text)<coalesce((question#>>'{validation,minLength}')::integer,0)
      then return false; end if;
    elsif question_type in ('number','currency') then
      numeric_value:=(answer#>>'{}')::numeric;
      if (question#>>'{validation,min}') is not null
          and numeric_value<(question#>>'{validation,min}')::numeric
        or (question#>>'{validation,max}') is not null
          and numeric_value>(question#>>'{validation,max}')::numeric
      then return false; end if;
    elsif question_type='date' then
      answer_text:=answer#>>'{}';
      if answer_text !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
      begin
        perform answer_text::date;
      exception when others then
        return false;
      end;
      if (question#>>'{validation,earliest}') is not null
          and answer_text<(question#>>'{validation,earliest}')
        or (question#>>'{validation,latest}') is not null
          and answer_text>(question#>>'{validation,latest}')
      then return false; end if;
    elsif question_type='single_choice' then
      answer_text:=answer#>>'{}';
      if not exists(
        select 1 from jsonb_array_elements(question->'options') option_value
        where option_value->>'id'=answer_text or option_value->>'label'=answer_text
      ) then return false; end if;
    elsif question_type='multiple_choice' then
      if jsonb_array_length(answer)<coalesce((question#>>'{validation,minSelections}')::integer,0)
        or jsonb_array_length(answer)>coalesce((question#>>'{validation,maxSelections}')::integer,50)
      then return false; end if;
      for row_value in select value from jsonb_array_elements(answer) loop
        if jsonb_typeof(row_value) is distinct from 'string' or not exists(
          select 1 from jsonb_array_elements(question->'options') option_value
          where option_value->>'id'=row_value#>>'{}'
        ) then return false; end if;
      end loop;
    elsif question_type='rating_scale' then
      scale_min:=(question#>>'{scale,min}')::integer;
      scale_max:=(question#>>'{scale,max}')::integer;
      numeric_value:=(answer#>>'{}')::numeric;
      if numeric_value<>trunc(numeric_value) or numeric_value<scale_min or numeric_value>scale_max
      then return false; end if;
    end if;
    if question_type='rating_matrix' then
      if jsonb_typeof(answer) is distinct from 'object' then return false; end if;
      scale_min:=(question#>>'{scale,min}')::integer;
      scale_max:=(question#>>'{scale,max}')::integer;
      for row_value in select value from jsonb_array_elements(question->'rows') loop
        if target_submission_id is not null
          and coalesce((question->>'required')::boolean,false)
          and answer->(row_value->>'id') is null
        then return false; end if;
        if answer->(row_value->>'id') is not null then
          if jsonb_typeof(answer->(row_value->>'id')) is distinct from 'number'
          then return false; end if;
          numeric_value:=(answer->>(row_value->>'id'))::numeric;
          if numeric_value<>trunc(numeric_value) or numeric_value<scale_min or numeric_value>scale_max
          then return false; end if;
        end if;
      end loop;
    end if;
  end loop;
  if answers ? 'workStartedOn'
    and (answers->>'workStartedOn')::date > current_date
  then return false; end if;
  if answers ? 'workStartedOn' and answers ? 'workFinishedOn'
    and (answers->>'workFinishedOn')::date < (answers->>'workStartedOn')::date
  then return false; end if;
  return true;
end;
$$;

create or replace function public.survey_personal_create_or_resume(
  target_task_id uuid,target_reviewed_wrike_user_id uuid default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare viewer public.application_users%rowtype; requested_type text; existing_id uuid;
  context jsonb; version public.survey_template_versions%rowtype; created_id uuid;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  if not found or viewer.role not in ('sme','id') or viewer.wrike_user_id is null then
    raise exception using errcode='42501',message='Survey context is unavailable.';
  end if;
  requested_type:=case when viewer.role='sme' then 'course_development_debrief' else 'id_sme_review' end;
  if viewer.role='sme' then
    if not public.survey_sme_status_available(target_task_id) or not exists(
      select 1 from public.course_development_person_assignments(viewer.organization_id,'sme') assignment
      where assignment.task_id=target_task_id and assignment.wrike_user_id=viewer.wrike_user_id
    ) then raise exception using errcode='42501',message='Survey context is unavailable.'; end if;
    select id into existing_id from public.survey_submissions
    where organization_id=viewer.organization_id and task_id=target_task_id
      and survey_type=requested_type and subject_application_user_id=viewer.id;
    target_reviewed_wrike_user_id:=viewer.wrike_user_id;
  else
    if target_reviewed_wrike_user_id is null or not exists(
      select 1 from public.course_development_person_assignments(viewer.organization_id,'id') assignment
      where assignment.task_id=target_task_id and assignment.wrike_user_id=viewer.wrike_user_id
    ) or not exists(
      select 1 from public.course_development_person_assignments(viewer.organization_id,'sme') assignment
      where assignment.task_id=target_task_id and assignment.wrike_user_id=target_reviewed_wrike_user_id
    ) then raise exception using errcode='42501',message='Survey context is unavailable.'; end if;
    select id into existing_id from public.survey_submissions
    where organization_id=viewer.organization_id and task_id=target_task_id
      and survey_type=requested_type and reviewed_wrike_user_id=target_reviewed_wrike_user_id
      and created_by=viewer.id;
  end if;
  if existing_id is not null then return existing_id; end if;
  select published.* into version
  from public.survey_template_versions published
  join public.survey_templates template on template.id=published.template_id
  where published.organization_id=viewer.organization_id
    and published.survey_type=requested_type and template.archived_at is null
  order by published.version_number desc limit 1;
  if not found then raise exception using errcode='42501',message='Survey context is unavailable.'; end if;
  context:=public.survey_context_for_task(target_task_id,requested_type);
  insert into public.survey_submissions(
    organization_id,survey_type,task_id,project_id,task_wrike_id,
    subject_application_user_id,reviewed_wrike_user_id,created_by,last_edited_by,
    context_snapshot,survey_version_id,definition_snapshot,answers
  ) values (
    viewer.organization_id,requested_type,target_task_id,
    nullif(context->>'projectId','')::uuid,context->>'taskWrikeId',
    case when viewer.role='sme' then viewer.id else null end,
    target_reviewed_wrike_user_id,viewer.id,viewer.id,context,
    version.id,version.definition,'{}'::jsonb
  ) returning id into created_id;
  if requested_type='course_development_debrief' then
    insert into public.course_development_debrief_responses(submission_id) values(created_id);
  else
    insert into public.id_sme_review_responses(submission_id) values(created_id);
  end if;
  insert into public.survey_audit_log(
    submission_id,organization_id,event_type,actor_id,actor_role,new_values
  ) values (
    created_id,viewer.organization_id,'draft_created',viewer.id,viewer.role,
    jsonb_build_object('surveyVersion',version.version_number)
  );
  return created_id;
end;
$$;

create or replace function public.survey_save_versioned(
  target_submission_id uuid,next_answers jsonb,submit_now boolean default false
) returns jsonb language plpgsql security definer set search_path=public as $$
declare viewer public.application_users%rowtype; survey public.survey_submissions%rowtype;
  previous_answers jsonb; raw_answers jsonb; next_revision integer; event_name text;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  select * into survey from public.survey_submissions
  where id=target_submission_id for update;
  if not found or survey.organization_id<>viewer.organization_id
    or not public.can_edit_survey(survey.id) or jsonb_typeof(next_answers) is distinct from 'object' then
    raise exception using errcode='42501',message='Survey is unavailable.';
  end if;
  raw_answers:=next_answers;
  update public.survey_attachments attachment
  set is_active=false,removed_by=viewer.id,removed_at=now()
  where attachment.submission_id=survey.id and attachment.is_active
    and exists(
      select 1
      from jsonb_array_elements(survey.definition_snapshot->'sections') section_value
      cross join lateral jsonb_array_elements(section_value->'questions') question_value
      where question_value->>'id'=attachment.question_id
        and question_value->>'type'='file_upload'
        and not public.survey_question_is_visible(question_value,next_answers)
    );
  select coalesce(jsonb_object_agg(answer_value.key,answer_value.value),'{}'::jsonb)
  into next_answers
  from jsonb_each(raw_answers) answer_value
  where exists(
    select 1
    from jsonb_array_elements(survey.definition_snapshot->'sections') section_value
    cross join lateral jsonb_array_elements(section_value->'questions') question_value
    where question_value->>'id'=answer_value.key
      and question_value->>'type'<>'file_upload'
      and public.survey_question_is_visible(question_value,raw_answers)
  );
  if not public.survey_answers_are_valid(
    survey.definition_snapshot,next_answers,case when submit_now then survey.id else null end
  ) then raise exception using errcode='23514',
    message=case when submit_now then 'Complete every required survey field before submitting.'
      else 'Review the survey values before saving.' end;
  end if;
  previous_answers:=survey.answers;
  update public.survey_submissions set answers=next_answers,last_edited_by=viewer.id,updated_at=now()
  where id=survey.id;
  if not submit_now then
    event_name:=case when survey.status='submitted' then 'edited_after_unlock' else 'draft_updated' end;
    insert into public.survey_audit_log(
      submission_id,organization_id,event_type,actor_id,actor_role,previous_values,new_values
    ) values (
      survey.id,survey.organization_id,event_name,viewer.id,viewer.role,
      previous_answers,next_answers
    );
    return jsonb_build_object('id',survey.id,'status',survey.status,'locked',false,'revision',survey.revision_number);
  end if;
  next_revision:=case when survey.status='submitted' then survey.revision_number+1 else survey.revision_number end;
  insert into public.survey_revisions(
    submission_id,organization_id,revision_number,context_snapshot,response_snapshot,
    attachment_snapshot,changed_fields,submitted_by,definition_snapshot,answers_snapshot
  ) values (
    survey.id,survey.organization_id,next_revision,survey.context_snapshot,next_answers,
    coalesce((select jsonb_agg(jsonb_build_object(
      'id',attachment.id,'questionId',attachment.question_id,
      'filename',attachment.original_filename,'mimeType',attachment.mime_type,'size',attachment.size_bytes
    )) from public.survey_attachments attachment
      where attachment.submission_id=survey.id and attachment.is_active),'[]'::jsonb),
    jsonb_build_object('before',previous_answers,'after',next_answers),viewer.id,
    survey.definition_snapshot,next_answers
  );
  update public.survey_submissions set status='submitted',is_locked=true,
    revision_number=next_revision,original_submitted_at=coalesce(original_submitted_at,now()),
    latest_submitted_at=now(),locked_at=now(),locked_by=viewer.id,
    revision_assignee_id=null,updated_at=now()
  where id=survey.id;
  insert into public.survey_audit_log(
    submission_id,organization_id,event_type,actor_id,actor_role,previous_values,new_values
  ) values (
    survey.id,survey.organization_id,
    case when survey.status='submitted' then 'resubmitted' else 'submitted' end,
    viewer.id,viewer.role,previous_answers,next_answers
  );
  return jsonb_build_object('id',survey.id,'status','submitted','locked',true,'revision',next_revision);
end;
$$;

create or replace function public.survey_register_attachment(
  target_submission_id uuid,target_question_id text,target_object_key text,
  target_original_filename text,target_mime_type text,target_extension text,
  target_size_bytes bigint
) returns jsonb language plpgsql security definer set search_path=public as $$
declare viewer public.application_users%rowtype; survey public.survey_submissions%rowtype;
  question jsonb; created public.survey_attachments%rowtype;
  previous_filenames jsonb; previous_draft_keys jsonb;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  select * into survey from public.survey_submissions
  where id=target_submission_id for update;
  if not found or survey.organization_id<>viewer.organization_id
    or not public.can_edit_survey(survey.id)
    or target_question_id !~ '^[A-Za-z0-9_-]{1,100}$'
    or target_size_bytes not between 1 and 10485760
    or length(target_original_filename) not between 1 and 255
    or target_object_key like '%..%'
    or target_object_key not like survey.organization_id::text||'/'||survey.id::text||'/%'
  then raise exception using errcode='42501',message='Survey is unavailable.'; end if;
  select question_value into question
  from jsonb_array_elements(survey.definition_snapshot->'sections') section_value
  cross join lateral jsonb_array_elements(section_value->'questions') question_value
  where question_value->>'id'=target_question_id
    and question_value->>'type'='file_upload'
  limit 1;
  if question is null
    or target_size_bytes>coalesce((question#>>'{validation,maxSizeBytes}')::bigint,10485760)
    or (
      jsonb_typeof(question#>'{validation,allowedExtensions}')='array'
      and not (question#>'{validation,allowedExtensions}') ? lower(target_extension)
    )
  then raise exception using errcode='23514',message='Choose an available survey file.'; end if;
  select coalesce(jsonb_agg(original_filename),'[]'::jsonb),
    coalesce(jsonb_agg(object_key) filter(where survey.status='draft'),'[]'::jsonb)
  into previous_filenames,previous_draft_keys
  from public.survey_attachments
  where submission_id=survey.id and question_id=target_question_id and is_active;
  update public.survey_attachments set is_active=false,removed_by=viewer.id,removed_at=now()
  where submission_id=survey.id and question_id=target_question_id and is_active;
  insert into public.survey_attachments(
    submission_id,organization_id,revision_number,question_id,kind,
    original_filename,object_key,mime_type,size_bytes,uploaded_by
  ) values (
    survey.id,survey.organization_id,survey.revision_number,target_question_id,
    case when target_question_id='invoice' then 'invoice' else 'file_upload' end,
    target_original_filename,target_object_key,target_mime_type,target_size_bytes,viewer.id
  ) returning * into created;
  insert into public.survey_audit_log(
    submission_id,organization_id,event_type,actor_id,actor_role,previous_values,new_values
  ) values (
    survey.id,survey.organization_id,
    case when jsonb_array_length(previous_filenames)>0 then 'invoice_replaced' else 'invoice_uploaded' end,
    viewer.id,viewer.role,
    case when jsonb_array_length(previous_filenames)>0
      then jsonb_build_object('questionId',target_question_id,'filenames',previous_filenames)
      else '{}'::jsonb end,
    jsonb_build_object(
      'questionId',target_question_id,'filename',target_original_filename,
      'mimeType',target_mime_type,'size',target_size_bytes
    )
  );
  return jsonb_build_object(
    'attachment',jsonb_build_object(
      'id',created.id,'question_id',created.question_id,
      'original_filename',created.original_filename,'mime_type',created.mime_type,
      'size_bytes',created.size_bytes,'uploaded_at',created.uploaded_at
    ),
    'previousDraftObjectKeys',previous_draft_keys
  );
end;
$$;

create or replace function public.survey_remove_attachment(
  target_submission_id uuid,target_attachment_id uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare viewer public.application_users%rowtype; survey public.survey_submissions%rowtype;
  attachment public.survey_attachments%rowtype;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  select * into survey from public.survey_submissions
  where id=target_submission_id for update;
  select * into attachment from public.survey_attachments
  where id=target_attachment_id and submission_id=target_submission_id
    and organization_id=viewer.organization_id and is_active for update;
  if survey.id is null or attachment.id is null
    or survey.organization_id<>viewer.organization_id or not public.can_edit_survey(survey.id)
  then raise exception using errcode='42501',message='Survey is unavailable.'; end if;
  update public.survey_attachments set is_active=false,removed_by=viewer.id,removed_at=now()
  where id=attachment.id;
  insert into public.survey_audit_log(
    submission_id,organization_id,event_type,actor_id,actor_role,previous_values
  ) values (
    survey.id,survey.organization_id,'invoice_removed',viewer.id,viewer.role,
    jsonb_build_object('questionId',attachment.question_id,'filename',attachment.original_filename)
  );
  return jsonb_build_object(
    'id',attachment.id,
    'draftObjectKey',case when survey.status='draft' then attachment.object_key else null end
  );
end;
$$;

create or replace function public.survey_relock(target_submission_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare viewer public.application_users%rowtype; survey public.survey_submissions%rowtype;
  snapshot jsonb;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  select * into survey from public.survey_submissions
  where id=target_submission_id for update;
  if not found or survey.organization_id<>viewer.organization_id
    or viewer.role not in ('super_admin','admin')
    or survey.status<>'submitted' or survey.is_locked then
    raise exception using errcode='42501',message='Survey is unavailable.';
  end if;
  select answers_snapshot into snapshot
  from public.survey_revisions
  where submission_id=survey.id
  order by revision_number desc limit 1;
  if snapshot is null then
    raise exception using errcode='23514',message='A submitted snapshot is required.';
  end if;
  update public.survey_submissions set answers=snapshot,is_locked=true,
    locked_at=now(),locked_by=viewer.id,unlocked_at=null,unlocked_by=null,
    unlock_reason=null,revision_assignee_id=null,last_edited_by=viewer.id,updated_at=now()
  where id=survey.id;
  insert into public.survey_audit_log(
    submission_id,organization_id,event_type,actor_id,actor_role
  ) values (survey.id,survey.organization_id,'relocked',viewer.id,viewer.role);
end;
$$;

create or replace function public.survey_personal_requirements()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare viewer public.application_users%rowtype; result jsonb;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  if not found or viewer.role not in ('sme','id') then
    raise exception using errcode='42501',message='Surveys are unavailable.';
  end if;
  with current_requirements as (
    select task.id task_id,'course_development_debrief'::text survey_type,
      viewer.wrike_user_id reviewed_wrike_user_id,task.title course_name,
      coalesce(status.title,task.status) workflow_status,viewer.display_name sme_name,
      reporting.reporting_year,null::integer publication_year,
      extract(year from task.original_due_date)::integer original_due_year,
      public.survey_sme_status_available(task.id) action_available,
      case when public.survey_sme_status_available(task.id) then null
        else 'This course has not reached the survey stage.' end unavailable_reason
    from public.course_development_person_assignments(viewer.organization_id,'sme') assignment
    join public.wrike_tasks task on task.id=assignment.task_id and not task.is_deleted
    join public.wrike_users identity on identity.id=viewer.wrike_user_id
      and identity.identity_verified and identity.is_active and not identity.is_unresolved
    left join public.wrike_workflow_statuses status
      on status.organization_id=task.organization_id and status.wrike_id=task.custom_status_id
    left join lateral (
      select value.reporting_year
      from public.wrike_task_normalized_custom_field_values value
      join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
      where value.task_id=task.id and field.normalized_key in ('reporting','reporting year')
        and not value.has_conflict limit 1
    ) reporting on true
    where viewer.role='sme' and assignment.wrike_user_id=viewer.wrike_user_id
    union all
    select task.id,'id_sme_review',sme_identity.id,task.title,
      coalesce(status.title,task.status),sme_identity.display_name,
      reporting.reporting_year,publication.publication_year,
      extract(year from task.original_due_date)::integer,true,null::text
    from public.course_development_person_assignments(viewer.organization_id,'id') owner
    join public.wrike_tasks task on task.id=owner.task_id and not task.is_deleted
    join public.wrike_users id_identity on id_identity.id=viewer.wrike_user_id
      and id_identity.identity_verified and id_identity.is_active and not id_identity.is_unresolved
    join public.course_development_person_assignments(viewer.organization_id,'sme') sme
      on sme.task_id=task.id
    join public.wrike_users sme_identity on sme_identity.id=sme.wrike_user_id
      and sme_identity.identity_verified and sme_identity.is_active and not sme_identity.is_unresolved
    left join public.wrike_workflow_statuses status
      on status.organization_id=task.organization_id and status.wrike_id=task.custom_status_id
    left join lateral (
      select value.reporting_year
      from public.wrike_task_normalized_custom_field_values value
      join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
      where value.task_id=task.id and field.normalized_key in ('reporting','reporting year')
        and not value.has_conflict limit 1
    ) reporting on true
    left join lateral (
      select extract(year from observed.value::date)::integer publication_year
      from public.wrike_task_normalized_custom_field_values value
      join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
      cross join lateral unnest(value.display_values) observed(value)
      where value.task_id=task.id and field.normalized_key in ('publication','publication date','publish date')
        and not value.has_conflict and observed.value ~ '^\d{4}-\d{2}-\d{2}$' limit 1
    ) publication on true
    where viewer.role='id' and owner.wrike_user_id=viewer.wrike_user_id
  ), incomplete as (
    select requirement.*,submission.id submission_id,coalesce(submission.status,'not_started') survey_state,
      version.version_number
    from current_requirements requirement
    left join public.survey_submissions submission
      on submission.organization_id=viewer.organization_id
      and submission.task_id=requirement.task_id
      and submission.survey_type=requirement.survey_type
      and (
        (viewer.role='sme' and submission.subject_application_user_id=viewer.id)
        or (viewer.role='id' and submission.created_by=viewer.id
          and submission.reviewed_wrike_user_id=requirement.reviewed_wrike_user_id)
      )
    left join public.survey_template_versions version on version.id=submission.survey_version_id
    where submission.id is null or submission.status='draft'
  ), completed as (
    select submission.task_id,submission.survey_type,submission.reviewed_wrike_user_id,
      coalesce(submission.context_snapshot->>'taskTitle','Unavailable') course_name,
      coalesce(submission.context_snapshot->>'status','Unavailable') workflow_status,
      coalesce(submission.context_snapshot#>>'{subject,name}',reviewed.display_name,'Unavailable') sme_name,
      case when submission.context_snapshot->>'reportingYear' ~ '^\d{4}$'
        then (submission.context_snapshot->>'reportingYear')::integer end reporting_year,
      case when submission.context_snapshot->>'publicationYear' ~ '^\d{4}$'
        then (submission.context_snapshot->>'publicationYear')::integer end publication_year,
      case when submission.context_snapshot->>'originalDueYear' ~ '^\d{4}$'
        then (submission.context_snapshot->>'originalDueYear')::integer end original_due_year,
      submission.id submission_id,'submitted'::text survey_state,version.version_number,
      submission.latest_submitted_at submitted_at
    from public.survey_submissions submission
    join public.survey_template_versions version on version.id=submission.survey_version_id
    left join public.wrike_users reviewed on reviewed.id=submission.reviewed_wrike_user_id
    where submission.organization_id=viewer.organization_id and submission.status='submitted'
      and (
        (viewer.role='sme' and submission.survey_type='course_development_debrief'
          and submission.subject_application_user_id=viewer.id
          and exists(select 1 from public.survey_revisions revision
            where revision.submission_id=submission.id and revision.submitted_by=viewer.id))
        or (viewer.role='id' and submission.survey_type='id_sme_review'
          and submission.created_by=viewer.id)
      )
  )
  select jsonb_build_object(
    'incompleteCount',(select count(*) from incomplete),
    'completedCount',(select count(*) from completed),
    'incomplete',coalesce((select jsonb_agg(to_jsonb(item) order by item.course_name,item.sme_name)
      from incomplete item),'[]'::jsonb),
    'completed',coalesce((select jsonb_agg(to_jsonb(item) order by item.submitted_at desc)
      from completed item),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;

alter table public.survey_templates enable row level security;
alter table public.survey_template_drafts enable row level security;
alter table public.survey_template_versions enable row level security;
alter table public.survey_template_audit_log enable row level security;

create policy "administrator template read" on public.survey_templates for select using (
  exists(select 1 from public.application_users viewer
    where viewer.id=public.current_effective_user_id()
      and viewer.organization_id=survey_templates.organization_id
      and viewer.role in ('super_admin','admin') and viewer.account_state='active')
);
create policy "administrator template draft read" on public.survey_template_drafts for select using (
  exists(select 1 from public.application_users viewer
    where viewer.id=public.current_effective_user_id()
      and viewer.organization_id=survey_template_drafts.organization_id
      and viewer.role in ('super_admin','admin') and viewer.account_state='active')
);
create policy "administrator template version read" on public.survey_template_versions for select using (
  exists(select 1 from public.application_users viewer
    where viewer.id=public.current_effective_user_id()
      and viewer.organization_id=survey_template_versions.organization_id
      and viewer.role in ('super_admin','admin') and viewer.account_state='active')
);
create policy "administrator template audit read" on public.survey_template_audit_log for select using (
  exists(select 1 from public.application_users viewer
    where viewer.id=public.current_effective_user_id()
      and viewer.organization_id=survey_template_audit_log.organization_id
      and viewer.role in ('super_admin','admin') and viewer.account_state='active')
);

revoke all on public.survey_templates,public.survey_template_drafts,
  public.survey_template_versions,public.survey_template_audit_log from anon,authenticated;
grant select on public.survey_templates,public.survey_template_drafts,
  public.survey_template_versions,public.survey_template_audit_log to authenticated;
grant all on public.survey_templates,public.survey_template_drafts,
  public.survey_template_versions,public.survey_template_audit_log to service_role;

revoke all on function public.default_survey_definition(text) from public;
revoke all on function public.survey_authored_text_is_safe(text,integer,boolean) from public;
revoke all on function public.survey_definition_is_valid(jsonb,text) from public;
revoke all on function public.seed_default_survey_templates(uuid) from public;
revoke all on function public.survey_admin_templates() from public;
revoke all on function public.survey_admin_save_draft(uuid,jsonb,integer) from public;
revoke all on function public.survey_admin_publish(uuid) from public;
revoke all on function public.survey_admin_duplicate_template(uuid) from public;
revoke all on function public.survey_admin_set_template_archived(uuid,boolean) from public;
revoke all on function public.survey_sme_status_available(uuid) from public;
revoke all on function public.survey_condition_matches(jsonb,jsonb) from public;
revoke all on function public.survey_question_is_visible(jsonb,jsonb) from public;
revoke all on function public.survey_answers_are_valid(jsonb,jsonb,uuid) from public;
revoke all on function public.survey_personal_create_or_resume(uuid,uuid) from public;
revoke all on function public.survey_save_versioned(uuid,jsonb,boolean) from public;
revoke all on function public.survey_register_attachment(uuid,text,text,text,text,text,bigint) from public;
revoke all on function public.survey_remove_attachment(uuid,uuid) from public;
revoke all on function public.survey_personal_requirements() from public;

grant execute on function public.survey_admin_templates(),
  public.survey_admin_save_draft(uuid,jsonb,integer),
  public.survey_admin_publish(uuid),
  public.survey_admin_duplicate_template(uuid),
  public.survey_admin_set_template_archived(uuid,boolean),
  public.survey_personal_create_or_resume(uuid,uuid),
  public.survey_save_versioned(uuid,jsonb,boolean),
  public.survey_register_attachment(uuid,text,text,text,text,text,bigint),
  public.survey_remove_attachment(uuid,uuid),
  public.survey_relock(uuid),
  public.survey_personal_requirements()
  to authenticated,service_role;
revoke all on function public.survey_assign_reviser(uuid,uuid) from anon,authenticated;
grant execute on function public.survey_assign_reviser(uuid,uuid) to service_role;
grant execute on function public.default_survey_definition(text),
  public.survey_authored_text_is_safe(text,integer,boolean),
  public.survey_definition_is_valid(jsonb,text),
  public.seed_default_survey_templates(uuid),
  public.survey_sme_status_available(uuid),
  public.survey_condition_matches(jsonb,jsonb),
  public.survey_question_is_visible(jsonb,jsonb),
  public.survey_answers_are_valid(jsonb,jsonb,uuid)
  to service_role;

revoke insert,update,delete on public.survey_submissions,
  public.course_development_debrief_responses,public.id_sme_review_responses,
  public.survey_attachments,public.survey_revisions,public.survey_audit_log
  from anon,authenticated;

select pg_notify('pgrst','reload schema');
