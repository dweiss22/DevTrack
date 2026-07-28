create or replace function public.ensure_historical_survey_version(
  requested_type text,
  requested_schema_checksum text,
  requested_definition jsonb
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  viewer public.application_users%rowtype;
  target_template_id uuid;
  target_version_id uuid;
  next_version_number integer;
begin
  select *
  into viewer
  from public.application_users
  where id=public.current_effective_user_id()
    and account_state='active';

  if not found or not public.current_has_capability('manage_data') then
    raise exception using
      errcode='42501',
      message='Historical survey imports are unavailable.';
  end if;

  if requested_type not in ('course_development_debrief','id_sme_review')
    or requested_schema_checksum !~ '^[0-9a-f]{64}$'
    or not public.survey_definition_is_valid(requested_definition,requested_type)
  then
    raise exception using
      errcode='22023',
      message='Historical survey definition is invalid.';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(viewer.organization_id::text||':'||requested_type)
  );

  select historical_version.id
  into target_version_id
  from public.survey_template_versions historical_version
  where historical_version.organization_id=viewer.organization_id
    and historical_version.survey_type=requested_type
    and historical_version.version_origin='historical_import'
    and historical_version.schema_checksum=requested_schema_checksum;

  if target_version_id is not null then
    return target_version_id;
  end if;

  insert into public.survey_templates(
    organization_id,
    survey_type,
    template_key,
    archived_at,
    archived_by,
    created_by,
    is_import_only
  ) values (
    viewer.organization_id,
    requested_type,
    'historical-import',
    now(),
    viewer.id,
    viewer.id,
    true
  )
  on conflict(organization_id,survey_type,template_key) do update
    set is_import_only=true,
        archived_at=coalesce(public.survey_templates.archived_at,now())
  returning public.survey_templates.id into target_template_id;

  insert into public.survey_template_drafts(
    template_id,
    organization_id,
    definition,
    updated_by
  ) values (
    target_template_id,
    viewer.organization_id,
    requested_definition,
    viewer.id
  )
  on conflict on constraint survey_template_drafts_pkey do nothing;

  select coalesce(max(historical_version.version_number),0)+1
  into next_version_number
  from public.survey_template_versions historical_version
  where historical_version.organization_id=viewer.organization_id
    and historical_version.survey_type=requested_type;

  insert into public.survey_template_versions(
    template_id,
    organization_id,
    survey_type,
    version_number,
    definition,
    published_by,
    version_origin,
    schema_checksum
  ) values (
    target_template_id,
    viewer.organization_id,
    requested_type,
    next_version_number,
    requested_definition,
    viewer.id,
    'historical_import',
    requested_schema_checksum
  )
  returning public.survey_template_versions.id into target_version_id;

  return target_version_id;
end;
$$;

revoke all on function public.ensure_historical_survey_version(text,text,jsonb) from public;
grant execute on function public.ensure_historical_survey_version(text,text,jsonb)
  to authenticated,service_role;
