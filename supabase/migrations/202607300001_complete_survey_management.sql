-- Complete the versioned survey-management rollout without changing any
-- existing published definition, response, revision, or attachment.

alter table public.id_sme_review_responses
  add column if not exists reporting_year integer
    check (reporting_year between 1000 and 9999);

alter table public.survey_template_audit_log
  alter column actor_id drop not null,
  alter column authenticated_actor_id drop not null,
  alter column actor_role drop not null;
alter table public.survey_template_audit_log
  drop constraint if exists survey_template_audit_log_event_type_check,
  drop constraint if exists survey_template_audit_log_actor_role_check;
alter table public.survey_template_audit_log
  add column if not exists actor_kind text not null default 'user'
    check (actor_kind in ('user','system')),
  add constraint survey_template_audit_log_event_type_check
    check (event_type in (
      'draft_saved','published','duplicated','archived','restored','seed_upgraded'
    )),
  add constraint survey_template_audit_log_actor_role_check
    check (
      (actor_kind='system' and actor_id is null
        and authenticated_actor_id is null and actor_role is null)
      or
      (actor_kind='user' and actor_id is not null
        and authenticated_actor_id is not null and actor_role is not null)
    );

create or replace function public.survey_definition_is_valid(
  definition jsonb,expected_type text
) returns boolean language plpgsql immutable set search_path=public as $$
declare
  section jsonb; question jsonb; option_value jsonb; row_value jsonb; rule jsonb;
  question_count integer:=0; section_count integer; option_count integer;
  all_ids text[]:=array[]::text[];
  prior_types jsonb:=case when expected_type='course_development_debrief'
    then '{"internalEmployee":"yes_no"}'::jsonb else '{}'::jsonb end;
  item_id text; question_type text; referenced_type text; operator_name text;
  scale_min integer; scale_max integer; binding text; display_order text;
begin
  if jsonb_typeof(definition) is distinct from 'object'
    or definition->>'schemaVersion' is distinct from '1'
    or definition->>'surveyType' is distinct from expected_type
    or coalesce(expected_type,'') not in (
      'course_development_debrief','id_sme_review'
    )
    or not public.survey_authored_text_is_safe(
      definition->>'title',200,true
    )
    or not public.survey_authored_text_is_safe(
      definition->>'introduction',5000,false
    )
    or not public.survey_authored_text_is_safe(
      definition->>'instructions',5000,false
    )
    or not public.survey_authored_text_is_safe(
      definition->>'completionMessage',5000,true
    )
    or coalesce(definition->>'presentation','')
      not in ('one_page','multi_page')
    or jsonb_typeof(definition->'buttons') is distinct from 'object'
    or jsonb_typeof(definition->'sections') is distinct from 'array'
  then return false; end if;
  if not public.survey_authored_text_is_safe(
      definition#>>'{buttons,saveDraft}',80,true)
    or not public.survey_authored_text_is_safe(
      definition#>>'{buttons,previous}',80,true)
    or not public.survey_authored_text_is_safe(
      definition#>>'{buttons,next}',80,true)
    or not public.survey_authored_text_is_safe(
      definition#>>'{buttons,submit}',80,true)
    or not public.survey_authored_text_is_safe(
      definition#>>'{buttons,return}',80,true)
  then return false; end if;
  section_count:=jsonb_array_length(definition->'sections');
  if section_count not between 1 and 30 then return false; end if;
  for section in select value from jsonb_array_elements(definition->'sections')
  loop
    if jsonb_typeof(section) is distinct from 'object'
      or jsonb_typeof(section->'questions') is distinct from 'array'
      or jsonb_typeof(section->'pageBreakBefore') is distinct from 'boolean'
    then return false; end if;
    item_id:=section->>'id';
    if item_id is null or item_id !~ '^[A-Za-z0-9_-]{1,100}$'
      or item_id=any(all_ids)
      or not public.survey_authored_text_is_safe(
        section->>'title',200,true)
      or not public.survey_authored_text_is_safe(
        section->>'description',1000,false)
    then return false; end if;
    all_ids:=array_append(all_ids,item_id);
    question_count:=question_count+jsonb_array_length(section->'questions');
    if question_count>200 then return false; end if;
    for question in select value
      from jsonb_array_elements(section->'questions')
    loop
      item_id:=question->>'id';
      question_type:=question->>'type';
      if jsonb_typeof(question) is distinct from 'object'
        or item_id is null or item_id !~ '^[A-Za-z0-9_-]{1,100}$'
        or item_id=any(all_ids)
        or coalesce(question_type,'') not in (
          'short_text','long_text','number','currency','date','yes_no',
          'single_choice','multiple_choice','rating_scale','rating_matrix',
          'file_upload'
        )
        or not public.survey_authored_text_is_safe(
          question->>'label',1000,true)
        or not public.survey_authored_text_is_safe(
          question->>'helpText',1000,false)
        or jsonb_typeof(question->'required') is distinct from 'boolean'
        or coalesce(question->>'width','') not in ('full','half','third')
        or jsonb_typeof(question->'validation') is distinct from 'object'
      then return false; end if;
      binding:=question->>'contextBinding';
      if binding is not null and (
        binding not in (
          'smeName','smeEmail','smeClassification','respondentName',
          'courseName','reviewedSmeName','originalDueYear','reportingYear',
          'publicationYear','vertical'
        )
        or (binding in ('vertical','smeClassification')
          and question_type<>'single_choice')
        or (binding in (
          'originalDueYear','reportingYear','publicationYear'
        ) and question_type<>'number')
        or (binding in (
          'smeName','smeEmail','respondentName','courseName','reviewedSmeName'
        ) and question_type<>'short_text')
        or coalesce((question->>'required')::boolean,false)
      ) then return false; end if;
      if question_type in ('single_choice','multiple_choice') then
        if jsonb_typeof(question->'options') is distinct from 'array'
        then return false; end if;
        option_count:=jsonb_array_length(question->'options');
        if option_count not between 2 and 50 then return false; end if;
        for option_value in
          select value from jsonb_array_elements(question->'options')
        loop
          if option_value->>'id' !~ '^[A-Za-z0-9_-]{1,100}$'
            or not public.survey_authored_text_is_safe(
              option_value->>'label',200,true)
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
        display_order:=coalesce(
          question#>>'{scale,displayOrder}','ascending'
        );
        if scale_min<0 or scale_max>10 or scale_max<=scale_min
          or scale_max-scale_min>10
          or display_order not in ('ascending','descending')
          or not public.survey_authored_text_is_safe(
            question#>>'{scale,minLabel}',200,false)
          or not public.survey_authored_text_is_safe(
            question#>>'{scale,maxLabel}',200,false)
          or not public.survey_authored_text_is_safe(
            question#>>'{scale,minDescription}',1000,false)
          or not public.survey_authored_text_is_safe(
            question#>>'{scale,maxDescription}',1000,false)
        then return false; end if;
      end if;
      if question_type='rating_matrix' then
        if jsonb_typeof(question->'rows') is distinct from 'array'
          or jsonb_array_length(question->'rows') not between 1 and 50
        then return false; end if;
        for row_value in
          select value from jsonb_array_elements(question->'rows')
        loop
          if row_value->>'id' !~ '^[A-Za-z0-9_-]{1,100}$'
            or not public.survey_authored_text_is_safe(
              row_value->>'label',200,true)
          then return false; end if;
        end loop;
      end if;
      if question ? 'visibility' then
        if jsonb_typeof(question->'visibility') is distinct from 'object'
          or coalesce(question#>>'{visibility,match}','')
            not in ('all','any')
          or jsonb_typeof(question#>'{visibility,rules}')
            is distinct from 'array'
          or jsonb_array_length(question#>'{visibility,rules}')
            not between 1 and 20
        then return false; end if;
        for rule in
          select value from jsonb_array_elements(
            question#>'{visibility,rules}'
          )
        loop
          referenced_type:=prior_types->>(rule->>'questionId');
          operator_name:=rule->>'operator';
          if referenced_type is null
            or coalesce(operator_name,'') not in (
              'equals','not_equals','contains','not_contains',
              'greater_than','less_than','answered','not_answered'
            )
            or (operator_name not in ('answered','not_answered')
              and not (rule ? 'value'))
            or (operator_name in ('equals','not_equals')
              and referenced_type in ('file_upload','rating_matrix'))
            or (operator_name in ('contains','not_contains')
              and referenced_type not in (
                'short_text','long_text','multiple_choice'
              ))
            or (operator_name in ('greater_than','less_than')
              and referenced_type not in (
                'number','currency','date','rating_scale'
              ))
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

create or replace function public.trusted_sme_debrief_definition(
  definition jsonb
) returns jsonb language sql immutable parallel safe set search_path=public as $$
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
            where not (
              question_value->>'id' in (
                'internalEmployee','originalDueYear','reportingYear',
                'smeClassification','smeName','smeEmail'
              )
              and coalesce(question_value->>'contextBinding','')=''
            )
          ),'[]'::jsonb)
        ) order by section_order
      )
      from jsonb_array_elements(definition->'sections')
        with ordinality sections(section_value,section_order)
    ),'[]'::jsonb),true
  );
$$;

create or replace function public.prevent_editable_sme_trusted_context()
returns trigger language plpgsql set search_path=public as $$
declare template_type text;
begin
  select template.survey_type into template_type
  from public.survey_templates template where template.id=new.template_id;
  if template_type='course_development_debrief' and exists(
    select 1
    from jsonb_array_elements(new.definition->'sections') section_value
    cross join lateral
      jsonb_array_elements(section_value->'questions') question_value
    where question_value->>'id' in (
      'internalEmployee','originalDueYear','reportingYear',
      'smeClassification','smeName','smeEmail'
    )
      and coalesce(question_value->>'contextBinding','')=''
  ) then
    raise exception using errcode='23514',
      message='SME identity, classification, and course context must use trusted context bindings.';
  end if;
  return new;
end;
$$;

create or replace function public.default_survey_definition(requested_type text)
returns jsonb language plpgsql immutable set search_path=public as $$
begin
  if requested_type='course_development_debrief' then
    return $definition$
    {
      "schemaVersion":1,
      "surveyType":"course_development_debrief",
      "title":"Lexipol Course Development Debrief",
      "introduction":"Share your experience developing this course with Lexipol.",
      "instructions":"Complete every required field. You may save a draft and return before submitting.",
      "completionMessage":"Survey submitted successfully. Your response is locked and its history has been preserved.",
      "presentation":"one_page",
      "buttons":{"saveDraft":"Save draft","previous":"Previous","next":"Next","submit":"Submit survey","return":"Return to dashboard"},
      "sections":[
        {
          "id":"project-details","title":"Course and SME details",
          "description":"These values come from your DevTrack profile and the associated Wrike course.",
          "pageBreakBefore":false,"questions":[
            {"id":"smeName","type":"short_text","label":"SME Name","helpText":"","required":false,"width":"half","contextBinding":"smeName","validation":{"maxLength":200}},
            {"id":"smeEmail","type":"short_text","label":"Email","helpText":"","required":false,"width":"half","contextBinding":"smeEmail","validation":{"maxLength":320}},
            {"id":"smeClassification","type":"single_choice","label":"Internal/External","helpText":"","required":false,"width":"half","contextBinding":"smeClassification","validation":{},"options":[{"id":"internal","label":"Internal"},{"id":"external","label":"External"}]},
            {"id":"reportingYear","type":"number","label":"Course Reporting Year","helpText":"","required":false,"width":"half","contextBinding":"reportingYear","validation":{"min":1000,"max":9999,"step":1}}
          ]
        },
        {
          "id":"billing","title":"Billable information",
          "description":"External SMEs must provide billing details and an invoice.",
          "pageBreakBefore":false,"questions":[
            {"id":"billableHours","type":"number","label":"Billable Hours","helpText":"Enter the number of hours billed to Lexipol on your invoice for this work.","required":true,"width":"half","validation":{"min":0,"max":99999999,"step":0.01},"visibility":{"match":"all","rules":[{"questionId":"internalEmployee","operator":"equals","value":false}]}},
            {"id":"amountBilled","type":"currency","label":"Total Amount Billed","helpText":"Enter the total dollar amount billed to Lexipol on your invoice for this work.","required":true,"width":"half","validation":{"min":0,"max":99999999,"step":0.01},"visibility":{"match":"all","rules":[{"questionId":"internalEmployee","operator":"equals","value":false}]}},
            {"id":"invoice","type":"file_upload","label":"Invoice","helpText":"","required":true,"width":"full","validation":{"maxSizeBytes":10485760,"allowedExtensions":["pdf","doc","docx","xls","xlsx","png","jpg","jpeg"]},"visibility":{"match":"all","rules":[{"questionId":"internalEmployee","operator":"equals","value":false}]}}
          ]
        },
        {
          "id":"dates","title":"Dates","description":"","pageBreakBefore":false,
          "questions":[
            {"id":"workStartedOn","type":"date","label":"Project Start","helpText":"Enter the date you started working on this project.","required":true,"width":"half","validation":{}},
            {"id":"workFinishedOn","type":"date","label":"Project End","helpText":"Enter the date you submitted your final lesson plan to the Instructional Designer.","required":true,"width":"half","validation":{}}
          ]
        },
        {
          "id":"ratings","title":"Collaboration ratings","description":"","pageBreakBefore":false,
          "questions":[
            {"id":"rating01","type":"rating_scale","label":"Overall Experience with Lexipol","helpText":"I had a positive experience working with Lexipol as a course developer or contributor.","required":true,"width":"full","validation":{},"scale":{"min":1,"max":5,"minLabel":"Strongly Disagree","maxLabel":"Strongly Agree","labels":["Strongly Disagree","Disagree","Neither Agree nor Disagree","Agree","Strongly Agree"],"displayOrder":"descending"}},
            {"id":"rating02","type":"rating_scale","label":"Clarity of Goals and Objectives","helpText":"The goals and objectives set by Lexipol for my contributions were clear.","required":true,"width":"full","validation":{},"scale":{"min":1,"max":5,"minLabel":"Strongly Disagree","maxLabel":"Strongly Agree","labels":["Strongly Disagree","Disagree","Neither Agree nor Disagree","Agree","Strongly Agree"],"displayOrder":"descending"}},
            {"id":"rating03","type":"rating_scale","label":"Staff Responsiveness","helpText":"Lexipol staff were responsive to my inquiries, questions, and concerns related to course development.","required":true,"width":"full","validation":{},"scale":{"min":1,"max":5,"minLabel":"Strongly Disagree","maxLabel":"Strongly Agree","labels":["Strongly Disagree","Disagree","Neither Agree nor Disagree","Agree","Strongly Agree"],"displayOrder":"descending"}},
            {"id":"rating04","type":"rating_scale","label":"Adequacy of Tools and Resources","helpText":"The tools and resources provided by Lexipol met my needs to complete assigned work.","required":true,"width":"full","validation":{},"scale":{"min":1,"max":5,"minLabel":"Strongly Disagree","maxLabel":"Strongly Agree","labels":["Strongly Disagree","Disagree","Neither Agree nor Disagree","Agree","Strongly Agree"],"displayOrder":"descending"}},
            {"id":"rating05","type":"rating_scale","label":"Training and Support Provided","helpText":"The training and support provided by Lexipol staff met my needs to complete assigned work.","required":true,"width":"full","validation":{},"scale":{"min":1,"max":5,"minLabel":"Strongly Disagree","maxLabel":"Strongly Agree","labels":["Strongly Disagree","Disagree","Neither Agree nor Disagree","Agree","Strongly Agree"],"displayOrder":"descending"}},
            {"id":"rating06","type":"rating_scale","label":"Use of My Expertise","helpText":"My expertise was utilized throughout course development.","required":true,"width":"full","validation":{},"scale":{"min":1,"max":5,"minLabel":"Strongly Disagree","maxLabel":"Strongly Agree","labels":["Strongly Disagree","Disagree","Neither Agree nor Disagree","Agree","Strongly Agree"],"displayOrder":"descending"}},
            {"id":"rating07","type":"rating_scale","label":"Incorporation of My Feedback","helpText":"Lexipol was effective in incorporating my feedback.","required":true,"width":"full","validation":{},"scale":{"min":1,"max":5,"minLabel":"Strongly Disagree","maxLabel":"Strongly Agree","labels":["Strongly Disagree","Disagree","Neither Agree nor Disagree","Agree","Strongly Agree"],"displayOrder":"descending"}},
            {"id":"rating08","type":"rating_scale","label":"Autonomy in Course Design","helpText":"I had autonomy in designing the course content I was tasked with contributing.","required":true,"width":"full","validation":{},"scale":{"min":1,"max":5,"minLabel":"Strongly Disagree","maxLabel":"Strongly Agree","labels":["Strongly Disagree","Disagree","Neither Agree nor Disagree","Agree","Strongly Agree"],"displayOrder":"descending"}},
            {"id":"rating09","type":"rating_scale","label":"Feeling Valued as an SME","helpText":"I felt valued and respected as an SME for Lexipol.","required":true,"width":"full","validation":{},"scale":{"min":1,"max":5,"minLabel":"Strongly Disagree","maxLabel":"Strongly Agree","labels":["Strongly Disagree","Disagree","Neither Agree nor Disagree","Agree","Strongly Agree"],"displayOrder":"descending"}},
            {"id":"rating10","type":"rating_scale","label":"Likelihood to Recommend Lexipol","helpText":"I would recommend that my peers work with Lexipol for future SME opportunities.","required":true,"width":"full","validation":{},"scale":{"min":1,"max":5,"minLabel":"Strongly Disagree","maxLabel":"Strongly Agree","labels":["Strongly Disagree","Disagree","Neither Agree nor Disagree","Agree","Strongly Agree"],"displayOrder":"descending"}}
          ]
        },
        {
          "id":"comments-section","title":"Additional comments","description":"","pageBreakBefore":false,
          "questions":[
            {"id":"comments","type":"long_text","label":"Additional Feedback or Suggestions","helpText":"Please provide any additional comments or suggestions for improving the course development process at Lexipol.","required":false,"width":"full","validation":{"maxLength":5000}}
          ]
        }
      ]
    }
    $definition$::jsonb;
  elsif requested_type='id_sme_review' then
    return $definition$
    {
      "schemaVersion":1,
      "surveyType":"id_sme_review",
      "title":"ID Review of SME",
      "introduction":"It’s time to share your insights on your recent work with the SME assigned to this project.",
      "instructions":"Complete every required field. You may save a draft and return before submitting.",
      "completionMessage":"Review submitted successfully. Your response is locked and its history has been preserved.",
      "presentation":"one_page",
      "buttons":{"saveDraft":"Save draft","previous":"Previous","next":"Next","submit":"Submit survey","return":"Return to dashboard"},
      "sections":[
        {
          "id":"project-context","title":"Course and assignment details",
          "description":"These values come from your DevTrack profile and the associated Wrike course.",
          "pageBreakBefore":false,"questions":[
            {"id":"respondentName","type":"short_text","label":"Instructional Designer’s Name","helpText":"","required":false,"width":"half","contextBinding":"respondentName","validation":{"maxLength":200}},
            {"id":"courseName","type":"short_text","label":"Course Name","helpText":"","required":false,"width":"half","contextBinding":"courseName","validation":{"maxLength":1000}},
            {"id":"reviewedSmeName","type":"short_text","label":"Project SME","helpText":"","required":false,"width":"half","contextBinding":"reviewedSmeName","validation":{"maxLength":200}},
            {"id":"vertical","type":"single_choice","label":"Vertical","helpText":"","required":false,"width":"half","contextBinding":"vertical","validation":{},"options":[{"id":"P1A","label":"P1A"},{"id":"FR1A","label":"FR1A"},{"id":"EMS1","label":"EMS1"},{"id":"C1A","label":"C1A"},{"id":"LGU","label":"LGU"},{"id":"D1A","label":"D1A"},{"id":"Lexipol","label":"Lexipol"},{"id":"Wellness","label":"Wellness"},{"id":"Cross_Vertical","label":"Cross Vertical"},{"id":"Other","label":"Other"}]},
            {"id":"reportingYear","type":"number","label":"Reporting Year","helpText":"","required":false,"width":"half","contextBinding":"reportingYear","validation":{"min":1000,"max":9999,"step":1}}
          ]
        },
        {
          "id":"ratings","title":"Collaboration ratings",
          "description":"Use the scale to evaluate different aspects of the collaboration.",
          "pageBreakBefore":false,"questions":[
            {"id":"rating01","type":"rating_scale","label":"Overall Experience","helpText":"How would you rate your overall experience working with the SME?","required":true,"width":"full","validation":{},"scale":{"min":1,"max":5,"minLabel":"Needs Improvement","maxLabel":"Exceeds Expectations","labels":["Needs Improvement","Below Expectations","Meets Expectations","Above Expectations","Exceeds Expectations"],"displayOrder":"ascending","minDescription":"It really wasn’t up to par.","maxDescription":"Absolutely knocked it out of the park—beyond what we hoped for."}},
            {"id":"rating02","type":"rating_scale","label":"SME’s Knowledge and Expertise","helpText":"How would you evaluate the SME’s knowledge and expertise in public safety?","required":true,"width":"full","validation":{},"scale":{"min":1,"max":5,"minLabel":"Needs Improvement","maxLabel":"Exceeds Expectations","labels":["Needs Improvement","Below Expectations","Meets Expectations","Above Expectations","Exceeds Expectations"],"displayOrder":"ascending","minDescription":"It really wasn’t up to par.","maxDescription":"Absolutely knocked it out of the park—beyond what we hoped for."}},
            {"id":"rating03","type":"rating_scale","label":"Responsiveness","helpText":"How responsive was the SME to your inquiries and concerns during the project?","required":true,"width":"full","validation":{},"scale":{"min":1,"max":5,"minLabel":"Needs Improvement","maxLabel":"Exceeds Expectations","labels":["Needs Improvement","Below Expectations","Meets Expectations","Above Expectations","Exceeds Expectations"],"displayOrder":"ascending","minDescription":"It really wasn’t up to par.","maxDescription":"Absolutely knocked it out of the park—beyond what we hoped for."}},
            {"id":"rating04","type":"rating_scale","label":"Instructional Design Knowledge","helpText":"How well did the SME understand the principles of instructional design and the needs of our learners?","required":true,"width":"full","validation":{},"scale":{"min":1,"max":5,"minLabel":"Needs Improvement","maxLabel":"Exceeds Expectations","labels":["Needs Improvement","Below Expectations","Meets Expectations","Above Expectations","Exceeds Expectations"],"displayOrder":"ascending","minDescription":"It really wasn’t up to par.","maxDescription":"Absolutely knocked it out of the park—beyond what we hoped for."}},
            {"id":"rating05","type":"rating_scale","label":"Contribution to Development","helpText":"How effectively did the SME contribute to the development of course content?","required":true,"width":"full","validation":{},"scale":{"min":1,"max":5,"minLabel":"Needs Improvement","maxLabel":"Exceeds Expectations","labels":["Needs Improvement","Below Expectations","Meets Expectations","Above Expectations","Exceeds Expectations"],"displayOrder":"ascending","minDescription":"It really wasn’t up to par.","maxDescription":"Absolutely knocked it out of the park—beyond what we hoped for."}},
            {"id":"rating06","type":"rating_scale","label":"Openness to Suggestions and Feedback","helpText":"How open was the SME to your suggestions and feedback?","required":true,"width":"full","validation":{},"scale":{"min":1,"max":5,"minLabel":"Needs Improvement","maxLabel":"Exceeds Expectations","labels":["Needs Improvement","Below Expectations","Meets Expectations","Above Expectations","Exceeds Expectations"],"displayOrder":"ascending","minDescription":"It really wasn’t up to par.","maxDescription":"Absolutely knocked it out of the park—beyond what we hoped for."}},
            {"id":"rating07","type":"rating_scale","label":"Deadlines and Schedule","helpText":"How well did the SME meet deadlines and adhere to the project schedule?","required":true,"width":"full","validation":{},"scale":{"min":1,"max":5,"minLabel":"Needs Improvement","maxLabel":"Exceeds Expectations","labels":["Needs Improvement","Below Expectations","Meets Expectations","Above Expectations","Exceeds Expectations"],"displayOrder":"ascending","minDescription":"It really wasn’t up to par.","maxDescription":"Absolutely knocked it out of the park—beyond what we hoped for."}},
            {"id":"rating08","type":"rating_scale","label":"Overall Quality of the End Product","helpText":"How would you rate the overall quality of the course content provided by the SME?","required":true,"width":"full","validation":{},"scale":{"min":1,"max":5,"minLabel":"Needs Improvement","maxLabel":"Exceeds Expectations","labels":["Needs Improvement","Below Expectations","Meets Expectations","Above Expectations","Exceeds Expectations"],"displayOrder":"ascending","minDescription":"It really wasn’t up to par.","maxDescription":"Absolutely knocked it out of the park—beyond what we hoped for."}},
            {"id":"rating09","type":"rating_scale","label":"SME Assistance in Learner Interactions","helpText":"How effectively did the SME assist in making the course content accessible and engaging for learners?","required":true,"width":"full","validation":{},"scale":{"min":1,"max":5,"minLabel":"Needs Improvement","maxLabel":"Exceeds Expectations","labels":["Needs Improvement","Below Expectations","Meets Expectations","Above Expectations","Exceeds Expectations"],"displayOrder":"ascending","minDescription":"It really wasn’t up to par.","maxDescription":"Absolutely knocked it out of the park—beyond what we hoped for."}}
          ]
        },
        {
          "id":"examples","title":"Real-world examples","description":"","pageBreakBefore":false,
          "questions":[
            {"id":"providedRealWorldExamples","type":"yes_no","label":"Real-World Examples","helpText":"Did the SME provide sufficient real-world examples and/or case studies for inclusion in the course?","required":true,"width":"full","validation":{}}
          ]
        },
        {
          "id":"recommendation","title":"Recommendation","description":"","pageBreakBefore":false,
          "questions":[
            {"id":"recommendationScore","type":"rating_scale","label":"SME Promoter Score","helpText":"Considering your experience, how likely are you to recommend working with this SME to other team members or instructional designers?","required":true,"width":"full","validation":{},"scale":{"min":0,"max":10,"minLabel":"0 — Not at all likely","maxLabel":"10 — Extremely likely"}}
          ]
        },
        {
          "id":"comments-section","title":"Additional comments","description":"","pageBreakBefore":false,
          "questions":[
            {"id":"comments","type":"long_text","label":"Additional Comments","helpText":"Please provide any additional comments or suggestions for improving the process of working with SMEs in course development.","required":false,"width":"full","validation":{"maxLength":5000}}
          ]
        }
      ]
    }
    $definition$::jsonb;
  end if;
  raise exception using errcode='22023',message='Unsupported survey type.';
end;
$$;

create or replace function public.survey_sme_availability_at(
  target_task_id uuid,evaluated_at timestamptz
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  task_record public.wrike_tasks%rowtype;
  organization_timezone text;
  classification text;
  completed_on date;
  available_through date;
  local_today date;
  availability_code text;
begin
  select task.* into task_record
  from public.wrike_tasks task
  where task.id=target_task_id and not task.is_deleted;
  if task_record.id is null then
    return jsonb_build_object(
      'available',false,'code','unavailable',
      'reason','Survey context is unavailable.'
    );
  end if;
  select coalesce(organization.timezone,'America/Chicago')
    into organization_timezone
  from public.organizations organization
  where organization.id=task_record.organization_id;
  select status.dashboard_classification into classification
  from public.wrike_workflow_statuses status
  where status.organization_id=task_record.organization_id
    and status.wrike_id=task_record.custom_status_id;
  if classification is distinct from 'completed' then
    availability_code:='not_completed';
  elsif task_record.completed_at is null then
    availability_code:='completion_date_missing';
  else
    completed_on:=(task_record.completed_at
      at time zone organization_timezone)::date;
    available_through:=(completed_on+interval '6 months')::date;
    local_today:=(evaluated_at at time zone organization_timezone)::date;
    availability_code:=case
      when local_today<completed_on then 'not_completed'
      when local_today<=available_through then 'available'
      else 'expired' end;
  end if;
  return jsonb_build_object(
    'available',availability_code='available',
    'code',availability_code,
    'completedOn',completed_on,
    'availableThrough',available_through,
    'timezone',organization_timezone,
    'reason',case availability_code
      when 'available' then null
      when 'expired' then 'The six-month survey window has closed.'
      when 'completion_date_missing'
        then 'The project completion date is unavailable.'
      else 'This course has not reached the completed survey stage.'
    end
  );
end;
$$;

create or replace function public.survey_sme_availability(
  target_task_id uuid
) returns jsonb language sql stable security definer set search_path=public as $$
  select public.survey_sme_availability_at(target_task_id,now());
$$;

create or replace function public.survey_sme_status_available(
  target_task_id uuid
) returns boolean language sql stable security definer set search_path=public as $$
  select coalesce(
    (public.survey_sme_availability(target_task_id)->>'available')::boolean,
    false
  );
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
    where survey.id=target_submission_id
      and (
        public.current_has_capability('manage_surveys')
        or (
          survey.status='submitted'
          and survey.survey_type='course_development_debrief'
          and survey.subject_application_user_id=viewer.id
        )
        or (
          survey.status='submitted'
          and survey.survey_type='id_sme_review'
          and survey.created_by=viewer.id
        )
        or (
          survey.status='draft'
          and survey.survey_type='course_development_debrief'
          and survey.subject_application_user_id=viewer.id
          and public.survey_sme_status_available(survey.task_id)
          and public.current_has_operational_role('sme')
          and public.is_sme_identity_assigned(
            survey.task_id,public.current_sme_dashboard_identity()
          )
        )
        or (
          survey.status='draft'
          and survey.survey_type='id_sme_review'
          and survey.created_by=viewer.id
          and public.current_has_operational_role('id')
          and public.is_course_development_person_assigned(
            survey.task_id,'id',public.current_operational_identity('id')
          )
          and public.is_sme_identity_assigned(
            survey.task_id,survey.sme_identity_id
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
    where survey.id=target_submission_id and not survey.is_locked
      and (
        public.current_has_capability('manage_surveys')
        or (
          survey.status='draft'
          and survey.survey_type='course_development_debrief'
          and survey.subject_application_user_id=viewer.id
          and public.survey_sme_status_available(survey.task_id)
          and public.current_has_operational_role('sme')
          and public.is_sme_identity_assigned(
            survey.task_id,public.current_sme_dashboard_identity()
          )
        )
        or (
          survey.status='draft'
          and survey.survey_type='id_sme_review'
          and survey.created_by=viewer.id
          and public.current_has_operational_role('id')
          and public.is_course_development_person_assigned(
            survey.task_id,'id',public.current_operational_identity('id')
          )
          and public.is_sme_identity_assigned(
            survey.task_id,survey.sme_identity_id
          )
        )
      )
  );
$$;

create or replace function public.survey_answers_are_valid(
  definition jsonb,answers jsonb,target_submission_id uuid
) returns boolean language plpgsql stable security definer set search_path=public as $$
declare
  question jsonb; answer jsonb; row_value jsonb; question_type text;
  answer_text text; numeric_value numeric; scale_min integer; scale_max integer;
begin
  if jsonb_typeof(answers) is distinct from 'object' then return false; end if;
  for question in
    select question_value
    from jsonb_array_elements(definition->'sections') section_value
    cross join lateral
      jsonb_array_elements(section_value->'questions') question_value
  loop
    if not public.survey_question_is_visible(question,answers)
    then continue; end if;
    question_type:=question->>'type';
    answer:=answers->(question->>'id');
    if question_type='file_upload' then
      if target_submission_id is not null
        and coalesce((question->>'required')::boolean,false)
        and not exists(
          select 1 from public.survey_attachments attachment
          where attachment.submission_id=target_submission_id
            and attachment.question_id=question->>'id'
            and attachment.is_active
        )
      then return false; end if;
      continue;
    end if;
    if target_submission_id is not null
      and coalesce((question->>'required')::boolean,false)
      and (
        answer is null
        or answer in ('null'::jsonb,'""'::jsonb,'[]'::jsonb,'{}'::jsonb)
      )
    then return false; end if;
    if answer is null then continue; end if;
    if question_type in (
      'short_text','long_text','date','single_choice'
    ) and jsonb_typeof(answer) is distinct from 'string'
    then return false; end if;
    if question_type in ('number','rating_scale')
      and jsonb_typeof(answer) is distinct from 'number'
    then return false; end if;
    if question_type='currency'
      and jsonb_typeof(answer) not in ('number','string')
    then return false; end if;
    if question_type='yes_no'
      and jsonb_typeof(answer) is distinct from 'boolean'
    then return false; end if;
    if question_type='multiple_choice'
      and jsonb_typeof(answer) is distinct from 'array'
    then return false; end if;
    if question_type in ('short_text','long_text') then
      answer_text:=answer#>>'{}';
      if length(answer_text)>coalesce(
          (question#>>'{validation,maxLength}')::integer,10000)
        or length(answer_text)<coalesce(
          (question#>>'{validation,minLength}')::integer,0)
      then return false; end if;
    elsif question_type in ('number','currency') then
      answer_text:=answer#>>'{}';
      if question_type='currency'
        and answer_text !~ '^[0-9]+([.][0-9]{1,2})?$'
      then return false; end if;
      begin
        numeric_value:=answer_text::numeric;
      exception when others then
        return false;
      end;
      if (
          (question#>>'{validation,min}') is not null
          and numeric_value<(question#>>'{validation,min}')::numeric
        ) or (
          (question#>>'{validation,max}') is not null
          and numeric_value>(question#>>'{validation,max}')::numeric
        )
      then return false; end if;
    elsif question_type='date' then
      answer_text:=answer#>>'{}';
      if answer_text !~ '^\d{4}-\d{2}-\d{2}$'
      then return false; end if;
      begin
        perform answer_text::date;
      exception when others then
        return false;
      end;
      if (
          (question#>>'{validation,earliest}') is not null
          and answer_text<(question#>>'{validation,earliest}')
        ) or (
          (question#>>'{validation,latest}') is not null
          and answer_text>(question#>>'{validation,latest}')
        )
      then return false; end if;
    elsif question_type='single_choice' then
      answer_text:=answer#>>'{}';
      if not exists(
        select 1 from jsonb_array_elements(question->'options') option_value
        where option_value->>'id'=answer_text
          or option_value->>'label'=answer_text
      ) then return false; end if;
    elsif question_type='multiple_choice' then
      if jsonb_array_length(answer)<coalesce(
          (question#>>'{validation,minSelections}')::integer,0)
        or jsonb_array_length(answer)>coalesce(
          (question#>>'{validation,maxSelections}')::integer,50)
      then return false; end if;
      for row_value in select value from jsonb_array_elements(answer)
      loop
        if jsonb_typeof(row_value) is distinct from 'string'
          or not exists(
            select 1
            from jsonb_array_elements(question->'options') option_value
            where option_value->>'id'=row_value#>>'{}'
          )
        then return false; end if;
      end loop;
    elsif question_type='rating_scale' then
      scale_min:=(question#>>'{scale,min}')::integer;
      scale_max:=(question#>>'{scale,max}')::integer;
      numeric_value:=(answer#>>'{}')::numeric;
      if numeric_value<>trunc(numeric_value)
        or numeric_value<scale_min or numeric_value>scale_max
      then return false; end if;
    end if;
    if question_type='rating_matrix' then
      if jsonb_typeof(answer) is distinct from 'object'
      then return false; end if;
      scale_min:=(question#>>'{scale,min}')::integer;
      scale_max:=(question#>>'{scale,max}')::integer;
      for row_value in select value
        from jsonb_array_elements(question->'rows')
      loop
        if target_submission_id is not null
          and coalesce((question->>'required')::boolean,false)
          and answer->(row_value->>'id') is null
        then return false; end if;
        if answer->(row_value->>'id') is not null then
          if jsonb_typeof(answer->(row_value->>'id'))
            is distinct from 'number'
          then return false; end if;
          numeric_value:=(answer->>(row_value->>'id'))::numeric;
          if numeric_value<>trunc(numeric_value)
            or numeric_value<scale_min or numeric_value>scale_max
          then return false; end if;
        end if;
      end loop;
    end if;
  end loop;
  if answers ? 'workStartedOn'
    and (answers->>'workStartedOn')::date>current_date
  then return false; end if;
  if answers ? 'workStartedOn' and answers ? 'workFinishedOn'
    and (answers->>'workFinishedOn')::date
      <(answers->>'workStartedOn')::date
  then return false; end if;
  return true;
exception when others then
  return false;
end;
$$;

create or replace function public.enrich_survey_draft_context()
returns trigger language plpgsql security definer set search_path=public,auth as $$
declare
  task_record public.wrike_tasks%rowtype;
  actor_name text;
  subject_name text;
  subject_email text;
  reviewed_name text;
  reporting_year_value integer;
  vertical_value text;
  availability jsonb;
begin
  if new.status<>'draft' then return new; end if;
  select * into task_record from public.wrike_tasks where id=new.task_id;
  select principal.display_name into actor_name
  from public.application_user_principals principal
  where principal.id=new.created_by
    and principal.organization_id=new.organization_id;
  if new.subject_application_user_id is not null then
    select principal.display_name,auth_user.email
      into subject_name,subject_email
    from public.application_user_principals principal
    left join auth.users auth_user on auth_user.id=principal.id
    where principal.id=new.subject_application_user_id
      and principal.organization_id=new.organization_id;
  end if;
  if new.sme_identity_id is not null then
    select identity.display_name into reviewed_name
    from public.sme_dashboard_identities identity
    where identity.id=new.sme_identity_id
      and identity.organization_id=new.organization_id;
  end if;
  if reviewed_name is null and new.reviewed_wrike_user_id is not null then
    select identity.display_name into reviewed_name
    from public.wrike_users identity
    where identity.id=new.reviewed_wrike_user_id
      and identity.organization_id=new.organization_id;
  end if;
  if new.survey_type='course_development_debrief' then
    availability:=public.survey_sme_availability(new.task_id);
    new.context_snapshot:=(new.context_snapshot
      -'smeName'-'smeEmail'-'completedOn'
      -'availableThrough'-'availabilityCode')
      ||jsonb_strip_nulls(
      jsonb_build_object(
        'smeName',coalesce(
          subject_name,new.context_snapshot#>>'{subject,name}',
          new.context_snapshot#>>'{viewer,name}'
        ),
        'smeEmail',coalesce(
          subject_email,new.context_snapshot#>>'{subject,email}',
          new.context_snapshot#>>'{viewer,email}'
        ),
        'completedOn',availability->'completedOn',
        'availableThrough',availability->'availableThrough',
        'availabilityCode',availability->>'code'
      )
    );
  else
    select value.reporting_year into reporting_year_value
    from public.wrike_task_normalized_custom_field_values value
    join public.wrike_normalized_custom_fields field
      on field.id=value.normalized_field_id
    where value.task_id=new.task_id
      and field.normalized_key in ('reporting','reporting year')
      and not value.has_conflict
    limit 1;
    select value.vertical_reporting_category into vertical_value
    from public.wrike_task_normalized_custom_field_values value
    join public.wrike_normalized_custom_fields field
      on field.id=value.normalized_field_id
    where value.task_id=new.task_id
      and field.normalized_key='vertical'
      and not value.has_conflict
    limit 1;
    new.context_snapshot:=(new.context_snapshot
      -'respondentName'-'courseName'-'reviewedSmeName'
      -'reportingYear'-'vertical')
      ||jsonb_strip_nulls(
      jsonb_build_object(
        'respondentName',coalesce(
          actor_name,new.context_snapshot#>>'{viewer,name}'
        ),
        'courseName',coalesce(
          task_record.title,new.context_snapshot->>'taskTitle'
        ),
        'reviewedSmeName',coalesce(
          reviewed_name,new.context_snapshot#>>'{reviewedSme,name}',
          new.context_snapshot#>>'{subject,name}'
        ),
        'reportingYear',reporting_year_value,
        'vertical',vertical_value
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists enrich_survey_draft_context_before_write
  on public.survey_submissions;
create trigger enrich_survey_draft_context_before_write
before insert or update of context_snapshot on public.survey_submissions
for each row execute function public.enrich_survey_draft_context();

alter function public.refresh_sme_debrief_draft_context(uuid)
  rename to refresh_sme_debrief_draft_context_without_complete_management;

create function public.refresh_sme_debrief_draft_context(
  target_submission_id uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  result:=public.refresh_sme_debrief_draft_context_without_complete_management(
    target_submission_id
  );
  if result is not null then
    update public.survey_submissions
    set context_snapshot=context_snapshot,updated_at=updated_at
    where id=target_submission_id and status='draft';
  end if;
  return result;
end;
$$;

alter function public.survey_save_versioned(uuid,jsonb,boolean)
  rename to survey_save_versioned_without_complete_management;

create function public.survey_save_versioned(
  target_submission_id uuid,next_answers jsonb,
  submit_now boolean default false
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  survey public.survey_submissions%rowtype;
  sanitized_answers jsonb;
  result jsonb;
  question jsonb;
  amount_text text;
  binding text;
  trusted_value jsonb;
begin
  select * into survey from public.survey_submissions
  where id=target_submission_id;
  if survey.id is null or not public.can_edit_survey(survey.id)
    or jsonb_typeof(next_answers) is distinct from 'object'
  then
    raise exception using errcode='42501',message='Survey is unavailable.';
  end if;
  sanitized_answers:=next_answers
    -'smeName'-'smeEmail'-'smeClassification'
    -'respondentName'-'courseName'-'reviewedSmeName'
    -'originalDueYear'-'reportingYear'-'publicationYear'-'vertical';
  for question in
    select question_value
    from jsonb_array_elements(
      survey.definition_snapshot->'sections'
    ) section_value
    cross join lateral jsonb_array_elements(
      section_value->'questions'
    ) question_value
    where question_value->>'type'='currency'
      and sanitized_answers ? (question_value->>'id')
  loop
    amount_text:=sanitized_answers->>(question->>'id');
    if amount_text ~ '^\d+(\.\d{1,2})?$' then
      sanitized_answers:=jsonb_set(
        sanitized_answers,
        array[question->>'id'],
        to_jsonb(round(amount_text::numeric,2)::text),
        false
      );
    end if;
  end loop;
  if survey.status='draft' then
    update public.survey_submissions
    set context_snapshot=context_snapshot,updated_at=updated_at
    where id=target_submission_id;
    select * into survey from public.survey_submissions
    where id=target_submission_id;
  end if;
  for question in
    select question_value
    from jsonb_array_elements(
      survey.definition_snapshot->'sections'
    ) section_value
    cross join lateral jsonb_array_elements(
      section_value->'questions'
    ) question_value
    where question_value ? 'contextBinding'
  loop
    binding:=question->>'contextBinding';
    trusted_value:=survey.context_snapshot->binding;
    if trusted_value is not null
      and trusted_value not in ('null'::jsonb,'""'::jsonb)
    then
      sanitized_answers:=jsonb_set(
        sanitized_answers,array[question->>'id'],trusted_value,true
      );
    else
      sanitized_answers:=sanitized_answers-(question->>'id');
    end if;
  end loop;
  result:=public.survey_save_versioned_without_complete_management(
    target_submission_id,sanitized_answers,submit_now
  );
  -- The pre-existing SME wrapper writes a legacy compatibility row after it
  -- updates the JSON answer document. Re-run the additive typed synchronizer
  -- last so new individual ratings cannot be replaced by null matrix values.
  update public.survey_submissions
  set context_snapshot=context_snapshot,updated_at=updated_at
  where id=target_submission_id;
  return result;
end;
$$;

create or replace function public.sync_survey_typed_response()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  classification_value text;
begin
  if new.survey_type='course_development_debrief' then
    classification_value:=new.context_snapshot->>'smeClassification';
    insert into public.course_development_debrief_responses(
      submission_id,reporting_year,sme_classification,internal_employee,
      billable_hours,amount_billed,work_started_on,work_finished_on,
      rating_01,rating_02,rating_03,rating_04,rating_05,
      rating_06,rating_07,rating_08,rating_09,rating_10,comments,updated_at
    ) values (
      new.id,nullif(new.context_snapshot->>'reportingYear','')::integer,
      classification_value,classification_value='internal',
      case when classification_value='external'
        then nullif(new.answers->>'billableHours','')::numeric end,
      case when classification_value='external'
        then nullif(new.answers->>'amountBilled','')::numeric end,
      nullif(new.answers->>'workStartedOn','')::date,
      nullif(new.answers->>'workFinishedOn','')::date,
      nullif(coalesce(
        new.answers->>'rating01',
        new.answers#>>'{collaborationRatings,rating01}'
      ),'')::smallint,
      nullif(coalesce(
        new.answers->>'rating02',
        new.answers#>>'{collaborationRatings,rating02}'
      ),'')::smallint,
      nullif(coalesce(
        new.answers->>'rating03',
        new.answers#>>'{collaborationRatings,rating03}'
      ),'')::smallint,
      nullif(coalesce(
        new.answers->>'rating04',
        new.answers#>>'{collaborationRatings,rating04}'
      ),'')::smallint,
      nullif(coalesce(
        new.answers->>'rating05',
        new.answers#>>'{collaborationRatings,rating05}'
      ),'')::smallint,
      nullif(coalesce(
        new.answers->>'rating06',
        new.answers#>>'{collaborationRatings,rating06}'
      ),'')::smallint,
      nullif(coalesce(
        new.answers->>'rating07',
        new.answers#>>'{collaborationRatings,rating07}'
      ),'')::smallint,
      nullif(coalesce(
        new.answers->>'rating08',
        new.answers#>>'{collaborationRatings,rating08}'
      ),'')::smallint,
      nullif(coalesce(
        new.answers->>'rating09',
        new.answers#>>'{collaborationRatings,rating09}'
      ),'')::smallint,
      nullif(coalesce(
        new.answers->>'rating10',
        new.answers#>>'{collaborationRatings,rating10}'
      ),'')::smallint,
      nullif(new.answers->>'comments',''),now()
    )
    on conflict(submission_id) do update set
      reporting_year=excluded.reporting_year,
      sme_classification=excluded.sme_classification,
      internal_employee=excluded.internal_employee,
      billable_hours=excluded.billable_hours,
      amount_billed=excluded.amount_billed,
      work_started_on=excluded.work_started_on,
      work_finished_on=excluded.work_finished_on,
      rating_01=excluded.rating_01,rating_02=excluded.rating_02,
      rating_03=excluded.rating_03,rating_04=excluded.rating_04,
      rating_05=excluded.rating_05,rating_06=excluded.rating_06,
      rating_07=excluded.rating_07,rating_08=excluded.rating_08,
      rating_09=excluded.rating_09,rating_10=excluded.rating_10,
      comments=excluded.comments,updated_at=now();
  else
    insert into public.id_sme_review_responses(
      submission_id,reporting_year,publication_year,vertical,
      rating_01,rating_02,rating_03,rating_04,rating_05,
      rating_06,rating_07,rating_08,rating_09,
      provided_real_world_examples,real_world_examples_effectiveness,
      recommendation_score,comments,updated_at
    ) values (
      new.id,nullif(new.context_snapshot->>'reportingYear','')::integer,
      nullif(new.context_snapshot->>'publicationYear','')::integer,
      nullif(new.context_snapshot->>'vertical',''),
      nullif(coalesce(
        new.answers->>'rating01',
        new.answers#>>'{collaborationRatings,rating01}'
      ),'')::smallint,
      nullif(coalesce(
        new.answers->>'rating02',
        new.answers#>>'{collaborationRatings,rating02}'
      ),'')::smallint,
      nullif(coalesce(
        new.answers->>'rating03',
        new.answers#>>'{collaborationRatings,rating03}'
      ),'')::smallint,
      nullif(coalesce(
        new.answers->>'rating04',
        new.answers#>>'{collaborationRatings,rating04}'
      ),'')::smallint,
      nullif(coalesce(
        new.answers->>'rating05',
        new.answers#>>'{collaborationRatings,rating05}'
      ),'')::smallint,
      nullif(coalesce(
        new.answers->>'rating06',
        new.answers#>>'{collaborationRatings,rating06}'
      ),'')::smallint,
      nullif(coalesce(
        new.answers->>'rating07',
        new.answers#>>'{collaborationRatings,rating07}'
      ),'')::smallint,
      nullif(coalesce(
        new.answers->>'rating08',
        new.answers#>>'{collaborationRatings,rating08}'
      ),'')::smallint,
      nullif(coalesce(
        new.answers->>'rating09',
        new.answers#>>'{collaborationRatings,rating09}'
      ),'')::smallint,
      nullif(new.answers->>'providedRealWorldExamples','')::boolean,
      nullif(new.answers->>'realWorldExamplesEffectiveness','')::smallint,
      nullif(new.answers->>'recommendationScore','')::smallint,
      nullif(new.answers->>'comments',''),now()
    )
    on conflict(submission_id) do update set
      reporting_year=excluded.reporting_year,
      publication_year=coalesce(
        excluded.publication_year,
        id_sme_review_responses.publication_year
      ),
      vertical=excluded.vertical,
      rating_01=excluded.rating_01,rating_02=excluded.rating_02,
      rating_03=excluded.rating_03,rating_04=excluded.rating_04,
      rating_05=excluded.rating_05,rating_06=excluded.rating_06,
      rating_07=excluded.rating_07,rating_08=excluded.rating_08,
      rating_09=excluded.rating_09,
      provided_real_world_examples=excluded.provided_real_world_examples,
      real_world_examples_effectiveness=
        excluded.real_world_examples_effectiveness,
      recommendation_score=excluded.recommendation_score,
      comments=excluded.comments,updated_at=now();
  end if;
  return new;
end;
$$;

drop trigger if exists sync_survey_typed_response_after_write
  on public.survey_submissions;
create trigger sync_survey_typed_response_after_write
after update of answers,context_snapshot on public.survey_submissions
for each row execute function public.sync_survey_typed_response();

create or replace function public.survey_personal_requirements()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare viewer public.application_users%rowtype; result jsonb;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  if not found or not (
    public.current_has_operational_role('sme')
    or public.current_has_operational_role('id')
  ) then
    raise exception using errcode='42501',message='Surveys are unavailable.';
  end if;
  with current_requirements as (
    select
      task.id task_id,'course_development_debrief'::text survey_type,
      identity.wrike_user_id reviewed_wrike_user_id,
      identity.id reviewed_sme_identity_id,task.title course_name,
      coalesce(status.title,task.status) workflow_status,
      viewer.display_name sme_name,
      reporting.reporting_year,null::integer publication_year,
      extract(year from task.original_due_date)::integer original_due_year,
      coalesce((availability.value->>'available')::boolean,false)
        action_available,
      availability.value->>'reason' unavailable_reason,
      nullif(availability.value->>'completedOn','')::date completed_on,
      nullif(availability.value->>'availableThrough','')::date
        available_through,
      availability.value->>'code' availability_code
    from public.sme_dashboard_task_assignments assignment
    join public.sme_dashboard_identities identity
      on identity.id=assignment.sme_identity_id
      and identity.organization_id=viewer.organization_id
      and identity.application_user_id=viewer.id
      and identity.resolution_status<>'ambiguous'
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
    cross join lateral (
      select public.survey_sme_availability(task.id) value
    ) availability
    where public.current_has_operational_role('sme')
      and assignment.organization_id=viewer.organization_id
      and not assignment.source_has_conflict
    union all
    select
      task.id,'id_sme_review',sme_identity.wrike_user_id,
      sme_identity.id,task.title,
      coalesce(status.title,task.status),sme_identity.display_name,
      reporting.reporting_year,publication.publication_year,
      extract(year from task.original_due_date)::integer,
      true,null::text,null::date,null::date,'available'::text
    from public.course_development_person_assignments(
      viewer.organization_id,'id'
    ) owner
    join public.wrike_tasks task
      on task.id=owner.task_id and not task.is_deleted
    join public.wrike_users id_identity
      on id_identity.id=viewer.wrike_user_id
      and id_identity.identity_verified and id_identity.is_active
      and not id_identity.is_unresolved
    join public.sme_dashboard_task_assignments sme
      on sme.task_id=task.id
      and sme.organization_id=viewer.organization_id
      and not sme.source_has_conflict
    join public.sme_dashboard_identities sme_identity
      on sme_identity.id=sme.sme_identity_id
      and sme_identity.organization_id=viewer.organization_id
      and sme_identity.resolution_status<>'ambiguous'
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
        and not value.has_conflict limit 1
    ) reporting on true
    left join lateral (
      select extract(year from observed.value::date)::integer
        publication_year
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
      limit 1
    ) publication on true
    where public.current_has_operational_role('id')
      and owner.wrike_user_id=viewer.wrike_user_id
  ), incomplete as (
    select
      requirement.*,submission.id submission_id,
      coalesce(submission.status,'not_started') survey_state,
      version.version_number
    from current_requirements requirement
    left join public.survey_submissions submission
      on submission.organization_id=viewer.organization_id
      and submission.task_id=requirement.task_id
      and submission.survey_type=requirement.survey_type
      and (
        (
          requirement.survey_type='course_development_debrief'
          and submission.subject_application_user_id=viewer.id
        )
        or (
          requirement.survey_type='id_sme_review'
          and submission.created_by=viewer.id
          and (
            submission.sme_identity_id=requirement.reviewed_sme_identity_id
            or (
              submission.sme_identity_id is null
              and submission.reviewed_wrike_user_id=
                requirement.reviewed_wrike_user_id
            )
          )
        )
      )
    left join public.survey_template_versions version
      on version.id=submission.survey_version_id
    where submission.id is null or submission.status='draft'
  ), completed as (
    select
      submission.task_id,submission.survey_type,
      submission.reviewed_wrike_user_id,submission.sme_identity_id
        reviewed_sme_identity_id,
      coalesce(
        submission.context_snapshot->>'taskTitle','Unavailable'
      ) course_name,
      coalesce(
        submission.context_snapshot->>'status','Unavailable'
      ) workflow_status,
      coalesce(
        submission.context_snapshot->>'reviewedSmeName',
        submission.context_snapshot#>>'{subject,name}',
        reviewed.display_name,'Unavailable'
      ) sme_name,
      case when submission.context_snapshot->>'reportingYear' ~ '^\d{4}$'
        then (submission.context_snapshot->>'reportingYear')::integer end
        reporting_year,
      case when submission.context_snapshot->>'publicationYear' ~ '^\d{4}$'
        then (submission.context_snapshot->>'publicationYear')::integer end
        publication_year,
      case when submission.context_snapshot->>'originalDueYear' ~ '^\d{4}$'
        then (submission.context_snapshot->>'originalDueYear')::integer end
        original_due_year,
      false action_available,null::text unavailable_reason,
      nullif(
        submission.context_snapshot->>'completedOn',''
      )::date completed_on,
      nullif(
        submission.context_snapshot->>'availableThrough',''
      )::date available_through,
      'submitted'::text availability_code,
      submission.id submission_id,'submitted'::text survey_state,
      version.version_number,submission.latest_submitted_at submitted_at
    from public.survey_submissions submission
    join public.survey_template_versions version
      on version.id=submission.survey_version_id
    left join public.wrike_users reviewed
      on reviewed.id=submission.reviewed_wrike_user_id
    where submission.organization_id=viewer.organization_id
      and submission.status='submitted'
      and (
        (
          submission.survey_type='course_development_debrief'
          and submission.subject_application_user_id=viewer.id
        )
        or (
          submission.survey_type='id_sme_review'
          and submission.created_by=viewer.id
        )
      )
  )
  select jsonb_build_object(
    'incompleteCount',(select count(*) from incomplete),
    'completedCount',(select count(*) from completed),
    'incomplete',coalesce((
      select jsonb_agg(
        to_jsonb(item) order by item.course_name,item.sme_name
      ) from incomplete item
    ),'[]'::jsonb),
    'completed',coalesce((
      select jsonb_agg(
        to_jsonb(item) order by item.submitted_at desc
      ) from completed item
    ),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create or replace function public.seed_default_survey_templates(
  target_organization_id uuid
) returns void language plpgsql security definer set search_path=public as $$
declare
  requested_type text;
  primary_template_id uuid;
  seeded_definition jsonb;
  previous_definition jsonb;
  previous_lock integer;
  next_lock integer;
  next_version integer;
  draft_exists boolean;
begin
  foreach requested_type in array array[
    'course_development_debrief','id_sme_review'
  ] loop
    perform pg_advisory_xact_lock(hashtextextended(
      target_organization_id::text||':'||requested_type,0
    ));
    seeded_definition:=public.default_survey_definition(requested_type);
    insert into public.survey_templates(
      organization_id,survey_type,template_key
    ) values (
      target_organization_id,requested_type,'primary'
    ) on conflict(organization_id,survey_type,template_key)
      do update set updated_at=public.survey_templates.updated_at
    returning id into primary_template_id;

    select draft.definition,draft.lock_version
      into previous_definition,previous_lock
    from public.survey_template_drafts draft
    where draft.template_id=primary_template_id
    for update;
    draft_exists:=found;

    if not exists(
      select 1
      from public.survey_template_versions version
      where version.organization_id=target_organization_id
        and version.survey_type=requested_type
        and version.version_origin='published'
        and version.definition=seeded_definition
    ) then
      select coalesce(max(version.version_number),0)+1
        into next_version
      from public.survey_template_versions version
      where version.organization_id=target_organization_id
        and version.survey_type=requested_type;

      if draft_exists then
        update public.survey_template_drafts
        set definition=seeded_definition,
          lock_version=lock_version+1,
          updated_by=null,
          updated_at=now()
        where template_id=primary_template_id
        returning lock_version into next_lock;
      else
        insert into public.survey_template_drafts(
          template_id,organization_id,definition
        ) values (
          primary_template_id,target_organization_id,seeded_definition
        ) returning lock_version into next_lock;
      end if;

      insert into public.survey_template_versions(
        template_id,organization_id,survey_type,version_number,
        definition,published_by,version_origin
      ) values (
        primary_template_id,target_organization_id,requested_type,next_version,
        seeded_definition,null,'published'
      );
      update public.survey_templates
      set archived_at=null,archived_by=null,updated_at=now()
      where id=primary_template_id;
      insert into public.survey_template_audit_log(
        template_id,organization_id,event_type,actor_kind,
        previous_values,new_values
      ) values (
        primary_template_id,target_organization_id,'seed_upgraded','system',
        jsonb_strip_nulls(jsonb_build_object(
          'lockVersion',previous_lock,
          'title',previous_definition->>'title'
        )),
        jsonb_build_object(
          'lockVersion',next_lock,'version',next_version,
          'title',seeded_definition->>'title'
        )
      );
    elsif not draft_exists then
      insert into public.survey_template_drafts(
        template_id,organization_id,definition
      ) values (
        primary_template_id,target_organization_id,seeded_definition
      );
    end if;
  end loop;
end;
$$;

create or replace function public.survey_admin_save_draft(
  target_template_id uuid,next_definition jsonb,
  expected_lock_version integer
) returns integer language plpgsql security definer set search_path=public as $$
declare
  viewer public.application_users%rowtype;
  template public.survey_templates%rowtype;
  previous_definition jsonb;
  next_lock integer;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  select * into template from public.survey_templates
  where id=target_template_id
    and organization_id=viewer.organization_id for update;
  if not found or not public.current_has_capability('manage_surveys')
    or template.archived_at is not null
    or not public.survey_definition_is_valid(
      next_definition,template.survey_type
    )
  then
    raise exception using errcode='42501',
      message='Survey template is unavailable.';
  end if;
  select definition into previous_definition
  from public.survey_template_drafts
  where template_id=template.id
    and lock_version=expected_lock_version for update;
  if not found then
    raise exception using errcode='40001',
      message='This survey draft was updated by another administrator.';
  end if;
  update public.survey_template_drafts
  set definition=next_definition,lock_version=lock_version+1,
    updated_by=viewer.id,updated_at=now()
  where template_id=template.id
  returning lock_version into next_lock;
  update public.survey_templates set updated_at=now()
  where id=template.id;
  insert into public.survey_template_audit_log(
    template_id,organization_id,event_type,actor_kind,actor_id,
    authenticated_actor_id,actor_role,previous_values,new_values
  ) values (
    template.id,viewer.organization_id,'draft_saved','user',viewer.id,
    public.current_actor_user_id(),viewer.role,
    jsonb_build_object(
      'lockVersion',expected_lock_version,
      'title',previous_definition->>'title'
    ),
    jsonb_build_object(
      'lockVersion',next_lock,'title',next_definition->>'title'
    )
  );
  return next_lock;
end;
$$;

create or replace function public.survey_admin_publish(
  target_template_id uuid
) returns integer language plpgsql security definer set search_path=public as $$
declare
  viewer public.application_users%rowtype;
  template public.survey_templates%rowtype;
  draft public.survey_template_drafts%rowtype;
  next_version integer;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  select * into template from public.survey_templates
  where id=target_template_id
    and organization_id=viewer.organization_id for update;
  select * into draft from public.survey_template_drafts
  where template_id=target_template_id;
  if template.id is null
    or not public.current_has_capability('manage_surveys')
    or template.archived_at is not null
    or not public.survey_definition_is_valid(
      draft.definition,template.survey_type
    )
  then
    raise exception using errcode='42501',
      message='Survey template is unavailable.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    viewer.organization_id::text||':'||template.survey_type,0
  ));
  select coalesce(max(version_number),0)+1 into next_version
  from public.survey_template_versions
  where organization_id=viewer.organization_id
    and survey_type=template.survey_type;
  insert into public.survey_template_versions(
    template_id,organization_id,survey_type,version_number,
    definition,published_by,version_origin
  ) values (
    template.id,viewer.organization_id,template.survey_type,next_version,
    draft.definition,viewer.id,'published'
  );
  update public.survey_templates set updated_at=now()
  where id=template.id;
  insert into public.survey_template_audit_log(
    template_id,organization_id,event_type,actor_kind,actor_id,
    authenticated_actor_id,actor_role,new_values
  ) values (
    template.id,viewer.organization_id,'published','user',viewer.id,
    public.current_actor_user_id(),viewer.role,
    jsonb_build_object(
      'version',next_version,'title',draft.definition->>'title'
    )
  );
  return next_version;
end;
$$;

create or replace function public.survey_admin_duplicate_template(
  target_template_id uuid
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  viewer public.application_users%rowtype;
  source public.survey_templates%rowtype;
  source_definition jsonb;
  duplicate_id uuid;
  duplicate_key text;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  select * into source from public.survey_templates
  where id=target_template_id
    and organization_id=viewer.organization_id;
  if not found or not public.current_has_capability('manage_surveys') then
    raise exception using errcode='42501',
      message='Survey template is unavailable.';
  end if;
  select definition into source_definition
  from public.survey_template_drafts where template_id=source.id;
  duplicate_key:='copy-'||replace(gen_random_uuid()::text,'-','');
  insert into public.survey_templates(
    organization_id,survey_type,template_key,created_by
  ) values (
    viewer.organization_id,source.survey_type,duplicate_key,viewer.id
  ) returning id into duplicate_id;
  source_definition:=jsonb_set(
    source_definition,'{title}',
    to_jsonb(('Copy of '||source_definition->>'title')::text)
  );
  insert into public.survey_template_drafts(
    template_id,organization_id,definition,updated_by
  ) values (
    duplicate_id,viewer.organization_id,source_definition,viewer.id
  );
  insert into public.survey_template_audit_log(
    template_id,organization_id,event_type,actor_kind,actor_id,
    authenticated_actor_id,actor_role,new_values
  ) values (
    duplicate_id,viewer.organization_id,'duplicated','user',viewer.id,
    public.current_actor_user_id(),viewer.role,
    jsonb_build_object(
      'sourceTemplateId',source.id,
      'title',source_definition->>'title'
    )
  );
  return duplicate_id;
end;
$$;

create or replace function public.survey_admin_set_template_archived(
  target_template_id uuid,archive_template boolean
) returns void language plpgsql security definer set search_path=public as $$
declare
  viewer public.application_users%rowtype;
  template public.survey_templates%rowtype;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  select * into template from public.survey_templates
  where id=target_template_id
    and organization_id=viewer.organization_id for update;
  if not found or not public.current_has_capability('manage_surveys') then
    raise exception using errcode='42501',
      message='Survey template is unavailable.';
  end if;
  update public.survey_templates
  set archived_at=case when archive_template
      then coalesce(archived_at,now()) else null end,
    archived_by=case when archive_template then viewer.id else null end,
    updated_at=now()
  where id=template.id;
  insert into public.survey_template_audit_log(
    template_id,organization_id,event_type,actor_kind,actor_id,
    authenticated_actor_id,actor_role
  ) values (
    template.id,viewer.organization_id,
    case when archive_template then 'archived' else 'restored' end,
    'user',viewer.id,public.current_actor_user_id(),viewer.role
  );
end;
$$;

create or replace function public.survey_correct_context(
  target_submission_id uuid,corrections jsonb
) returns void language plpgsql security definer set search_path=public as $$
declare
  viewer public.application_users%rowtype;
  survey public.survey_submissions%rowtype;
  previous_context jsonb;
  next_context jsonb;
  corrected_year integer;
  corrected_vertical text;
  uses_reporting_year boolean;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  select * into survey from public.survey_submissions
  where id=target_submission_id for update;
  if survey.id is null
    or survey.organization_id<>viewer.organization_id
    or not public.current_has_capability('manage_surveys')
    or survey.is_locked
    or survey.status not in ('draft','submitted')
    or jsonb_typeof(corrections) is distinct from 'object'
  then
    raise exception using errcode='42501',
      message='Survey context cannot be corrected.';
  end if;
  previous_context:=survey.context_snapshot;
  next_context:=previous_context;
  select exists(
    select 1
    from jsonb_array_elements(
      survey.definition_snapshot->'sections'
    ) section_value
    cross join lateral jsonb_array_elements(
      section_value->'questions'
    ) question_value
    where question_value->>'contextBinding'='reportingYear'
  ) into uses_reporting_year;

  if uses_reporting_year then
    corrected_year:=nullif(corrections->>'reportingYear','')::integer;
    if corrected_year is null
      or corrected_year not between 1000 and 9999 then
      raise exception using errcode='22023',
        message='Enter a valid four-digit reporting year.';
    end if;
    next_context:=jsonb_set(
      next_context,'{reportingYear}',to_jsonb(corrected_year),true
    );
  elsif survey.survey_type='course_development_debrief' then
    corrected_year:=nullif(corrections->>'originalDueYear','')::integer;
    if corrected_year is null
      or corrected_year not between 1000 and 9999 then
      raise exception using errcode='22023',
        message='Enter a valid four-digit original due year.';
    end if;
    next_context:=jsonb_set(
      next_context,'{originalDueYear}',to_jsonb(corrected_year),true
    );
  else
    corrected_year:=nullif(corrections->>'publicationYear','')::integer;
    if corrected_year is null
      or corrected_year not between 1000 and 9999 then
      raise exception using errcode='22023',
        message='Enter a valid four-digit publication year.';
    end if;
    next_context:=jsonb_set(
      next_context,'{publicationYear}',to_jsonb(corrected_year),true
    );
  end if;

  if survey.survey_type='id_sme_review' then
    corrected_vertical:=nullif(corrections->>'vertical','');
    if corrected_vertical is null or corrected_vertical not in (
      'P1A','FR1A','EMS1','C1A','LGU','D1A','Lexipol','Wellness',
      'Cross Vertical','Other'
    ) then
      raise exception using errcode='22023',
        message='Select an approved survey Vertical.';
    end if;
    next_context:=jsonb_set(
      next_context,'{vertical}',to_jsonb(corrected_vertical),true
    );
  end if;
  update public.survey_submissions
  set context_snapshot=next_context,last_edited_by=viewer.id,updated_at=now()
  where id=survey.id;
  insert into public.survey_audit_log(
    submission_id,organization_id,event_type,actor_id,actor_role,
    previous_values,new_values
  ) values (
    survey.id,survey.organization_id,'context_corrected',viewer.id,
    viewer.role,previous_context,next_context
  );
end;
$$;

alter function public.survey_context_for_task(uuid,text)
  rename to survey_context_for_task_without_complete_management;

create function public.survey_context_for_task(
  target_task_id uuid,requested_type text
) returns jsonb language plpgsql stable security definer
set search_path=public,auth as $$
declare
  viewer public.application_users%rowtype;
  result jsonb;
  availability jsonb;
  configuration jsonb;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  result:=public.survey_context_for_task_without_complete_management(
    target_task_id,requested_type
  );
  if requested_type='course_development_debrief' then
    availability:=public.survey_sme_availability(target_task_id);
    if public.current_has_operational_role('sme')
      and coalesce((availability->>'available')::boolean,false)=false
    then
      raise exception using errcode='42501',
        message='Survey context is unavailable.';
    end if;
    if public.current_has_operational_role('sme') then
      configuration:=public.sme_debrief_configuration(
        target_task_id,viewer.id
      );
    end if;
    result:=result
      ||coalesce(configuration->'context','{}'::jsonb)
      ||jsonb_strip_nulls(jsonb_build_object(
        'smeName',result#>>'{viewer,name}',
        'smeEmail',result#>>'{viewer,email}',
        'completedOn',availability->'completedOn',
        'availableThrough',availability->'availableThrough',
        'availabilityCode',availability->>'code'
      ));
  else
    result:=result||jsonb_strip_nulls(jsonb_build_object(
      'respondentName',result#>>'{viewer,name}',
      'courseName',result->>'taskTitle'
    ));
  end if;
  return result;
end;
$$;

create or replace function public.survey_sme_submission_receipt(
  target_task_id uuid
) returns timestamptz language sql stable security definer
set search_path=public as $$
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
    and public.current_has_operational_role('sme')
  order by survey.latest_submitted_at desc
  limit 1;
$$;

-- Recalculate trusted display values for existing drafts without altering
-- pinned definitions, answers, revisions, submitted snapshots, or attachments.
update public.survey_submissions
set context_snapshot=context_snapshot,updated_at=updated_at
where status='draft';

-- Publish the standard definitions and update only the associated working
-- drafts. The equality guard makes rerunning this operation a no-op.
do $$
declare organization_record record;
begin
  for organization_record in select id from public.organizations loop
    perform public.seed_default_survey_templates(organization_record.id);
  end loop;
end;
$$;

drop policy if exists "administrator template read"
  on public.survey_templates;
create policy "administrator template read"
on public.survey_templates for select using (
  public.current_has_capability('manage_surveys')
  and organization_id=public.current_organization_id()
);
drop policy if exists "administrator template draft read"
  on public.survey_template_drafts;
create policy "administrator template draft read"
on public.survey_template_drafts for select using (
  public.current_has_capability('manage_surveys')
  and organization_id=public.current_organization_id()
);
drop policy if exists "administrator template version read"
  on public.survey_template_versions;
create policy "administrator template version read"
on public.survey_template_versions for select using (
  public.current_has_capability('manage_surveys')
  and organization_id=public.current_organization_id()
);
drop policy if exists "administrator template audit read"
  on public.survey_template_audit_log;
create policy "administrator template audit read"
on public.survey_template_audit_log for select using (
  public.current_has_capability('manage_surveys')
  and organization_id=public.current_organization_id()
);

revoke all on function public.survey_sme_availability_at(uuid,timestamptz)
  from public,anon,authenticated;
grant execute on function public.survey_sme_availability_at(uuid,timestamptz)
  to service_role;
revoke all on function public.survey_sme_availability(uuid)
  from public,anon;
grant execute on function public.survey_sme_availability(uuid)
  to authenticated,service_role;
revoke all on function
  public.refresh_sme_debrief_draft_context_without_complete_management(uuid)
  from public,anon,authenticated;
revoke all on function
  public.survey_save_versioned_without_complete_management(uuid,jsonb,boolean)
  from public,anon,authenticated;
revoke all on function
  public.survey_context_for_task_without_complete_management(uuid,text)
  from public,anon,authenticated;
revoke all on function public.survey_context_for_task(uuid,text),
  public.survey_sme_submission_receipt(uuid)
  from public,anon;
grant execute on function public.survey_context_for_task(uuid,text),
  public.survey_sme_submission_receipt(uuid)
  to authenticated,service_role;
revoke all on function public.enrich_survey_draft_context(),
  public.sync_survey_typed_response(),
  public.seed_default_survey_templates(uuid)
  from public,anon,authenticated;
grant execute on function public.seed_default_survey_templates(uuid)
  to service_role;
revoke all on function public.survey_admin_save_draft(uuid,jsonb,integer),
  public.survey_admin_publish(uuid),
  public.survey_admin_duplicate_template(uuid),
  public.survey_admin_set_template_archived(uuid,boolean),
  public.survey_correct_context(uuid,jsonb)
  from public,anon;
grant execute on function public.survey_admin_save_draft(uuid,jsonb,integer),
  public.survey_admin_publish(uuid),
  public.survey_admin_duplicate_template(uuid),
  public.survey_admin_set_template_archived(uuid,boolean),
  public.survey_correct_context(uuid,jsonb)
  to authenticated,service_role;

select pg_notify('pgrst','reload schema');
