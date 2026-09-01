-- Enhancement: a results view organized around the SME, showing each SME's
-- average rating per surveyed area from their submitted Course Development
-- Debrief surveys. Available to anyone who can view surveys (ID, SME
-- Collaborators/Coordinator, Admin, Project Reviewer).

create or replace function public.survey_results_by_sme()
returns table(
  sme_identity_id uuid,
  sme_name text,
  submission_count bigint,
  average_rating numeric,
  statement_averages numeric[]
)
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  viewer public.application_users%rowtype;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  if viewer.id is null or not public.current_has_capability('view_surveys') then
    raise exception using errcode='42501',message='Survey results are unavailable.';
  end if;
  return query
  with ratings_flat as (
    select survey.id submission_id,survey.sme_identity_id,statement_index,
      (survey.answers->>('rating'||lpad(statement_index::text,2,'0')))::numeric rating
    from public.survey_submissions survey
    cross join generate_series(1,10) statement_index
    where survey.organization_id=viewer.organization_id
      and survey.survey_type='course_development_debrief'
      and survey.status='submitted'
      and survey.sme_identity_id is not null
  ), overall as (
    select sme_identity_id,count(distinct submission_id) submission_count,avg(rating) average_rating
    from ratings_flat where rating is not null
    group by sme_identity_id
  ), per_statement as (
    select sme_identity_id,statement_index,avg(rating) statement_average
    from ratings_flat where rating is not null
    group by sme_identity_id,statement_index
  ), statement_arrays as (
    select sme_identity_id,
      array_agg(round(statement_average,2) order by statement_index) statement_averages
    from per_statement group by sme_identity_id
  )
  select identity.id,identity.display_name,
    overall.submission_count,round(overall.average_rating,2),
    statement_arrays.statement_averages
  from overall
  join public.sme_dashboard_identities identity
    on identity.id=overall.sme_identity_id
    and identity.organization_id=viewer.organization_id
  left join statement_arrays on statement_arrays.sme_identity_id=overall.sme_identity_id
  order by identity.display_name;
end;
$$;

revoke all on function public.survey_results_by_sme() from public;
grant execute on function public.survey_results_by_sme()
  to authenticated,service_role;
comment on function public.survey_results_by_sme() is
  'Per-SME average ratings across submitted Course Development Debrief surveys, for the survey results grid.';

select pg_notify('pgrst','reload schema');
