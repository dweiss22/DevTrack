-- Repair the production template listing RPC. Its RETURNS TABLE `id` output
-- variable made the unqualified application_users `id` reference ambiguous at
-- execution time, so the administration page could not display seeded surveys.

create or replace function public.survey_admin_templates()
returns table(
  id uuid,survey_type text,template_key text,archived_at timestamptz,
  definition jsonb,lock_version integer,updated_at timestamptz,
  latest_version integer,latest_published_at timestamptz,is_active boolean
) language plpgsql stable security definer set search_path=public as $$
declare viewer public.application_users%rowtype;
begin
  select member.* into viewer
  from public.application_users member
  where member.id=public.current_effective_user_id()
    and member.account_state='active';
  if not found or not public.current_has_capability('manage_surveys') then
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
        and candidate.survey_type=template.survey_type
        and candidate.version_origin='published'
        and not eligible.is_import_only and eligible.archived_at is null
    )
  from public.survey_templates template
  join public.survey_template_drafts draft on draft.template_id=template.id
  left join lateral (
    select published.version_number,published.published_at
    from public.survey_template_versions published
    where published.template_id=template.id and published.version_origin='published'
    order by published.version_number desc limit 1
  ) version on true
  where template.organization_id=viewer.organization_id and not template.is_import_only
  order by template.survey_type,template.archived_at nulls first,draft.updated_at desc;
end;
$$;

do $$
declare organization_record record;
begin
  for organization_record in select organization.id from public.organizations organization loop
    perform public.seed_default_survey_templates(organization_record.id);
  end loop;
end;
$$;

revoke all on function public.survey_admin_templates() from public;
grant execute on function public.survey_admin_templates() to authenticated,service_role;

select pg_notify('pgrst','reload schema');
