-- survey_results_by_sme() declares `returns table(sme_identity_id uuid, ...)`.
-- In PL/pgSQL, RETURNS TABLE columns become variables in scope for the whole
-- function body, so the bare `sme_identity_id` references inside the CTEs
-- (overall, per_statement, statement_arrays) collided with that OUT
-- variable, raising 42702 "column reference sme_identity_id is ambiguous".
-- This was never caught earlier because current_has_capability('view_surveys')
-- was missing (202609020003) and always rejected the call first, masking
-- this bug. Qualify every CTE reference so there's no ambiguity, without
-- changing the function's signature or output shape.

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
    select survey.id submission_id,survey.sme_identity_id sme_identity_id,statement_index,
      (survey.answers->>('rating'||lpad(statement_index::text,2,'0')))::numeric rating
    from public.survey_submissions survey
    cross join generate_series(1,10) statement_index
    where survey.organization_id=viewer.organization_id
      and survey.survey_type='course_development_debrief'
      and survey.status='submitted'
      and survey.sme_identity_id is not null
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

select pg_notify('pgrst','reload schema');
