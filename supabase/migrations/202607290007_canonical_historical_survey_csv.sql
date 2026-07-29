-- Canonical CSV imports reference the exact published survey definition while
-- legacy files continue to use immutable historical-import definitions.
do $migration$
declare
  function_ddl text;
  revised_ddl text;
begin
  select pg_get_functiondef('public.integrate_historical_survey_import_row(uuid)'::regprocedure)
  into function_ddl;
  revised_ddl := regexp_replace(
    function_ddl,
    'version_origin\s*=\s*''historical_import''(::text)?',
    'version_origin in (''historical_import'',''published'')',
    'g'
  );
  revised_ddl := regexp_replace(
    revised_ddl,
    'null,\s*NULLIF\(\(import_row\.normalized_answers ->> ''recommendationScore''::text\), ''''::text\)::smallint',
    'nullif(import_row.normalized_answers->>''realWorldExamplesEffectiveness'','''')::smallint, nullif(import_row.normalized_answers->>''recommendationScore'','''')::smallint',
    'g'
  );
  revised_ddl := regexp_replace(
    revised_ddl,
    'real_world_examples_effectiveness = NULL::smallint',
    'real_world_examples_effectiveness = excluded.real_world_examples_effectiveness',
    'g'
  );
  if revised_ddl = function_ddl
    or position('realWorldExamplesEffectiveness' in revised_ddl) = 0
    or position('version_origin in (''historical_import'',''published'')' in revised_ddl) = 0
  then
    raise exception 'Canonical historical integration migration did not match every required function segment.';
  end if;
  execute revised_ddl;
end
$migration$;

comment on function public.integrate_historical_survey_import_row(uuid) is
  'Integrates a reconciled legacy or definition-derived canonical CSV row without changing survey ownership, privacy, or access.';
