-- Qualify the application user lookup because the function's RETURNS TABLE
-- includes an `id` output variable that otherwise conflicts with application_users.id.
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
  select member.* into viewer
  from public.application_users member
  where member.id=public.current_effective_user_id()
    and member.account_state='active';
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

revoke all on function public.survey_browse_unified(jsonb,integer,integer) from public;
grant execute on function public.survey_browse_unified(jsonb,integer,integer)
  to authenticated,service_role;

select pg_notify('pgrst','reload schema');
