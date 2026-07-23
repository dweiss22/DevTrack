-- Qualify application-user columns in the caller-aware survey browser. The
-- table-returning PL/pgSQL function exposes `id` as an output variable, so an
-- unqualified `where id=...` is ambiguous at runtime.

create or replace function public.survey_browse(
  filters jsonb default '{}'::jsonb,
  page_number integer default 1,
  page_size integer default 50
)
returns table(
  total_count bigint,
  id uuid,
  survey_type text,
  status text,
  is_locked boolean,
  revision_number integer,
  updated_at timestamptz,
  task_id uuid,
  project_title text,
  sme_name text,
  creator_id uuid,
  creator_name text,
  vertical text,
  reporting_year integer,
  publication_year integer
)
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  viewer public.application_users%rowtype;
  safe_page integer:=greatest(page_number,1);
  safe_size integer:=least(greatest(page_size,1),100);
begin
  select application_user.*
  into viewer
  from public.application_users application_user
  where application_user.id=auth.uid();

  if not found then
    raise exception using errcode='42501',message='Surveys are unavailable.';
  end if;

  return query
  with visible as (
    select
      survey.*,
      coalesce(survey.context_snapshot#>>'{subject,name}',reviewed.display_name,'Unavailable') resolved_sme,
      coalesce(creator.display_name,'Unnamed reviewer') resolved_creator,
      coalesce(review.vertical,survey.context_snapshot->>'vertical') resolved_vertical,
      coalesce(
        debrief.original_due_year,
        case when survey.context_snapshot->>'reportingYear' ~ '^\d{4}$'
          then (survey.context_snapshot->>'reportingYear')::integer end
      ) resolved_reporting_year,
      coalesce(
        review.publication_year,
        case when survey.context_snapshot->>'publicationYear' ~ '^\d{4}$'
          then (survey.context_snapshot->>'publicationYear')::integer end
      ) resolved_publication_year,
      coalesce(
        survey.context_snapshot->>'projectTitle',
        survey.context_snapshot->>'taskTitle',
        'Unavailable'
      ) resolved_project
    from public.survey_submissions survey
    join public.application_users creator on creator.id=survey.created_by
    left join public.wrike_users reviewed on reviewed.id=survey.reviewed_wrike_user_id
    left join public.course_development_debrief_responses debrief on debrief.submission_id=survey.id
    left join public.id_sme_review_responses review on review.submission_id=survey.id
    where survey.organization_id=viewer.organization_id
      and (
        viewer.role in ('super_admin','admin')
        or (viewer.role='id' and survey.survey_type='id_sme_review')
        or (
          viewer.role='sme'
          and survey.survey_type='course_development_debrief'
          and survey.subject_application_user_id=viewer.id
        )
      )
  ), filtered as (
    select visible.*
    from visible
    where (coalesce(filters->>'surveyType','')='' or visible.survey_type=filters->>'surveyType')
      and (coalesce(filters->>'status','')='' or visible.status=filters->>'status')
      and (
        coalesce(filters->>'lockState','')=''
        or (
          filters->>'lockState' in ('true','false')
          and visible.is_locked=(filters->>'lockState')::boolean
        )
      )
      and (coalesce(filters->>'project','')='' or visible.task_id::text=filters->>'project')
      and (coalesce(filters->>'sme','')='' or visible.reviewed_wrike_user_id::text=filters->>'sme')
      and (coalesce(filters->>'creator','')='' or visible.created_by::text=filters->>'creator')
      and (coalesce(filters->>'vertical','')='' or visible.resolved_vertical=filters->>'vertical')
      and (
        coalesce(filters->>'reportingYear','')=''
        or (
          filters->>'reportingYear' ~ '^\d{4}$'
          and visible.resolved_reporting_year=(filters->>'reportingYear')::integer
        )
      )
      and (
        coalesce(filters->>'publicationYear','')=''
        or (
          filters->>'publicationYear' ~ '^\d{4}$'
          and visible.resolved_publication_year=(filters->>'publicationYear')::integer
        )
      )
  )
  select
    count(*) over(),
    filtered.id,
    filtered.survey_type,
    filtered.status,
    filtered.is_locked,
    filtered.revision_number,
    filtered.updated_at,
    filtered.task_id,
    filtered.resolved_project,
    filtered.resolved_sme,
    filtered.created_by,
    filtered.resolved_creator,
    filtered.resolved_vertical,
    filtered.resolved_reporting_year,
    filtered.resolved_publication_year
  from filtered
  order by filtered.updated_at desc
  limit safe_size
  offset (safe_page-1)*safe_size;
end;
$$;

revoke all on function public.survey_browse(jsonb,integer,integer) from public;
grant execute on function public.survey_browse(jsonb,integer,integer) to authenticated,service_role;

select pg_notify('pgrst','reload schema');
