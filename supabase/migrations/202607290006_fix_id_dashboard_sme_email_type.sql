-- auth.users.email is varchar while the public reporting contract returns text.
-- Amend the immediately preceding function definition without duplicating its
-- security-sensitive authorization and survey-ownership body.

do $migration$
declare
  function_definition text;
  corrected_definition text;
begin
  select pg_get_functiondef(
    'public.reporting_id_dashboard_rows(uuid)'::regprocedure
  ) into function_definition;

  corrected_definition := regexp_replace(
    function_definition,
    'coalesce\([[:space:]]*sme_auth\.email[[:space:]]*,[[:space:]]*wrike_sme\.email[[:space:]]*\)',
    'coalesce(sme_auth.email,wrike_sme.email)::text',
    'i'
  );

  if corrected_definition=function_definition then
    raise exception
      'reporting_id_dashboard_rows email expression was not found';
  end if;

  execute corrected_definition;
end;
$migration$;

revoke all on function public.reporting_id_dashboard_rows(uuid) from public;
grant execute on function public.reporting_id_dashboard_rows(uuid)
to authenticated,service_role;

comment on function public.reporting_id_dashboard_rows(uuid) is
  'ID-assigned projects with one row per durable SME custom-field identity. Linked application email is resolved from auth.users and cast to the stable text reporting contract.';

select pg_notify('pgrst','reload schema');
