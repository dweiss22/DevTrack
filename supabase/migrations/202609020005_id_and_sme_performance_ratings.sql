-- survey_results_by_sme() only read live course_development_debrief
-- submissions and was always empty pre-launch (no live SME debriefs
-- submitted yet), ignoring both the imported historical survey data and
-- the id_sme_review survey entirely.
--
-- Neither survey type asks anyone to rate an ID's performance directly:
-- Course Development Debrief is the SME's own self-report on their
-- experience working with Lexipol, and since the assigned ID is
-- responsible for that overall project experience, this data is a
-- reflection of the ID's work -- so it's aggregated per ID here, not per
-- SME. ID Review of SME is the inverse (the ID rating the SME's work),
-- so it's aggregated per SME. Both live and historical rating data use
-- the same rating01..rating09/10 jsonb key convention (live in
-- survey_submissions.answers, historical in the collaboration_ratings
-- column of historical_sme_debrief_responses/historical_id_sme_review_responses),
-- so live and historical rows blend into one combined average per subject.

drop function if exists public.survey_results_by_sme();

create or replace function public.sme_performance_ratings()
returns table(
  sme_identity_id uuid,
  sme_name text,
  submission_count bigint,
  average_rating numeric,
  statement_averages numeric[],
  unresolved_count bigint
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
  with live_ratings as (
    select survey.id submission_id,survey.sme_identity_id,statement_index,
      (survey.answers->>('rating'||lpad(statement_index::text,2,'0')))::numeric rating
    from public.survey_submissions survey
    cross join generate_series(1,9) statement_index
    where survey.organization_id=viewer.organization_id
      and survey.survey_type='id_sme_review'
      and survey.status='submitted'
      and survey.sme_identity_id is not null
  ), historical_matched as (
    select historical.id,identity.id sme_identity_id
    from public.historical_survey_responses historical
    join public.historical_id_sme_review_responses detail on detail.response_id=historical.id
    left join public.sme_dashboard_identities identity
      on identity.organization_id=viewer.organization_id
      and identity.wrike_user_id=historical.matched_reviewed_wrike_user_id
    where historical.organization_id=viewer.organization_id
      and historical.internal_survey_type='id_sme_review'
  ), historical_ratings as (
    select historical.id submission_id,historical.sme_identity_id,statement_index,
      (detail.collaboration_ratings->>('rating'||lpad(statement_index::text,2,'0')))::numeric rating
    from historical_matched historical
    join public.historical_id_sme_review_responses detail on detail.response_id=historical.id
    cross join generate_series(1,9) statement_index
    where historical.sme_identity_id is not null
  ), ratings_flat as (
    select submission_id,live_ratings.sme_identity_id,statement_index,rating from live_ratings
    union all
    select submission_id,historical_ratings.sme_identity_id,statement_index,rating from historical_ratings
  ), overall as (
    select ratings_flat.sme_identity_id,count(distinct submission_id) submission_count,avg(rating) average_rating
    from ratings_flat where rating is not null
    group by ratings_flat.sme_identity_id
  ), per_statement as (
    select ratings_flat.sme_identity_id,statement_index,avg(rating) statement_average
    from ratings_flat where rating is not null
    group by ratings_flat.sme_identity_id,statement_index
  ), statement_arrays as (
    select per_statement.sme_identity_id,
      array_agg(round(statement_average,2) order by statement_index) statement_averages
    from per_statement group by per_statement.sme_identity_id
  ), unresolved as (
    select count(*) unresolved_count
    from historical_matched where historical_matched.sme_identity_id is null
  ), subject_rows as (
    select identity.id sme_identity_id,identity.display_name sme_name,
      overall.submission_count,round(overall.average_rating,2) average_rating,
      statement_arrays.statement_averages
    from overall
    join public.sme_dashboard_identities identity
      on identity.id=overall.sme_identity_id
      and identity.organization_id=viewer.organization_id
    left join statement_arrays on statement_arrays.sme_identity_id=overall.sme_identity_id
  )
  select subject_rows.sme_identity_id,subject_rows.sme_name,subject_rows.submission_count,
    subject_rows.average_rating,subject_rows.statement_averages,unresolved.unresolved_count
  from unresolved
  left join subject_rows on true
  order by subject_rows.sme_name;
end;
$$;

create or replace function public.id_performance_ratings()
returns table(
  id_wrike_user_id uuid,
  id_name text,
  id_email text,
  mapping_status text,
  submission_count bigint,
  average_rating numeric,
  statement_averages numeric[],
  unresolved_count bigint
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
  with id_assignments as (
    select task_id,wrike_user_id
    from public.course_development_person_assignments(viewer.organization_id,'id')
  ), live_ratings as (
    select survey.id submission_id,assignment.wrike_user_id,statement_index,
      (survey.answers->>('rating'||lpad(statement_index::text,2,'0')))::numeric rating
    from public.survey_submissions survey
    join id_assignments assignment on assignment.task_id=survey.task_id
    cross join generate_series(1,10) statement_index
    where survey.organization_id=viewer.organization_id
      and survey.survey_type='course_development_debrief'
      and survey.status='submitted'
  ), historical_matched as (
    select historical.id,historical.matched_task_id,assignment.wrike_user_id
    from public.historical_survey_responses historical
    join public.historical_sme_debrief_responses detail on detail.response_id=historical.id
    left join id_assignments assignment on assignment.task_id=historical.matched_task_id
    where historical.organization_id=viewer.organization_id
      and historical.internal_survey_type='course_development_debrief'
  ), historical_ratings as (
    select historical.id submission_id,historical.wrike_user_id,statement_index,
      (detail.collaboration_ratings->>('rating'||lpad(statement_index::text,2,'0')))::numeric rating
    from historical_matched historical
    join public.historical_sme_debrief_responses detail on detail.response_id=historical.id
    cross join generate_series(1,10) statement_index
    where historical.wrike_user_id is not null
  ), ratings_flat as (
    select submission_id,live_ratings.wrike_user_id,statement_index,rating from live_ratings
    union all
    select submission_id,historical_ratings.wrike_user_id,statement_index,rating from historical_ratings
  ), overall as (
    select ratings_flat.wrike_user_id,count(distinct submission_id) submission_count,avg(rating) average_rating
    from ratings_flat where rating is not null
    group by ratings_flat.wrike_user_id
  ), per_statement as (
    select ratings_flat.wrike_user_id,statement_index,avg(rating) statement_average
    from ratings_flat where rating is not null
    group by ratings_flat.wrike_user_id,statement_index
  ), statement_arrays as (
    select per_statement.wrike_user_id,
      array_agg(round(statement_average,2) order by statement_index) statement_averages
    from per_statement group by per_statement.wrike_user_id
  ), unresolved as (
    select count(*) unresolved_count
    from historical_matched where historical_matched.wrike_user_id is null
  ), subject_rows as (
    select identity.id id_wrike_user_id,identity.display_name id_name,identity.email id_email,
      case when member.id is null then 'unmapped' else 'mapped' end mapping_status,
      overall.submission_count,round(overall.average_rating,2) average_rating,
      statement_arrays.statement_averages
    from overall
    join public.wrike_users identity
      on identity.id=overall.wrike_user_id
      and identity.organization_id=viewer.organization_id
    left join public.application_users member
      on member.organization_id=viewer.organization_id
      and member.role='id' and member.wrike_user_id=identity.id
    left join statement_arrays on statement_arrays.wrike_user_id=overall.wrike_user_id
  )
  select subject_rows.id_wrike_user_id,subject_rows.id_name,subject_rows.id_email,
    subject_rows.mapping_status,subject_rows.submission_count,subject_rows.average_rating,
    subject_rows.statement_averages,unresolved.unresolved_count
  from unresolved
  left join subject_rows on true
  order by subject_rows.id_name;
end;
$$;

revoke all on function public.sme_performance_ratings() from public;
grant execute on function public.sme_performance_ratings() to authenticated,service_role;
revoke all on function public.id_performance_ratings() from public;
grant execute on function public.id_performance_ratings() to authenticated,service_role;
comment on function public.sme_performance_ratings() is
  'Per-SME average ratings across live and historical ID Review of SME surveys, blended into one score per SME.';
comment on function public.id_performance_ratings() is
  'Per-ID average ratings derived from live and historical Course Development Debrief surveys (the SME''s self-reported experience, attributed to the responsible ID), blended into one score per ID.';

select pg_notify('pgrst','reload schema');
