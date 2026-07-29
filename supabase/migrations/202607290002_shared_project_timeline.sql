-- Expose authoritative Wrike timeline custom fields through the restricted SME
-- detail boundary. Keep the prior authorization and survey-privacy implementation
-- as a private base, then remove the legal-reviewer value before returning JSON.

alter function public.sme_project_detail_by_identity(uuid,uuid)
  rename to sme_project_detail_by_identity_restricted_base;

revoke all on function
  public.sme_project_detail_by_identity_restricted_base(uuid,uuid)
from public,authenticated;

create function public.sme_project_detail_by_identity(
  target_task_id uuid,
  target_sme_identity_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  result jsonb;
  timeline_fields record;
begin
  result:=public.sme_project_detail_by_identity_restricted_base(
    target_task_id,
    target_sme_identity_id
  );

  -- Never serialize a Legal Reviewer name through the SME project endpoint,
  -- including when an Admin is viewing the SME-specific experience.
  result:=result-'legalReviewer';
  if result->>'state'<>'allowed' then
    return result;
  end if;

  select
    max(value.display_values[1]) filter(
      where field.normalized_key='project end date'
        and not value.has_conflict
        and cardinality(value.display_values)=1
    ) project_end_date,
    max(value.display_values[1]) filter(
      where field.normalized_key='published date'
        and not value.has_conflict
        and cardinality(value.display_values)=1
    ) published_date,
    case when count(distinct value.display_values[1]) filter(
        where field.normalized_key in (
          'lms publication date',
          'lms publication date [lct]'
        )
          and not value.has_conflict
          and cardinality(value.display_values)=1
      )=1
      and count(*) filter(
        where field.normalized_key in (
          'lms publication date',
          'lms publication date [lct]'
        ) and value.has_conflict
      )=0
    then max(value.display_values[1]) filter(
        where field.normalized_key in (
          'lms publication date',
          'lms publication date [lct]'
        )
          and not value.has_conflict
          and cardinality(value.display_values)=1
      )
    end lms_publication_date
  into timeline_fields
  from public.wrike_task_normalized_custom_field_values value
  join public.wrike_normalized_custom_fields field
    on field.id=value.normalized_field_id
  where value.task_id=target_task_id;

  result:=jsonb_set(
    result,
    '{timeline}',
    (coalesce(result->'timeline','{}'::jsonb)-'completedAt')
      || jsonb_build_object(
        'projectEndDate',timeline_fields.project_end_date,
        'publishedDate',timeline_fields.published_date,
        'lmsPublicationDate',timeline_fields.lms_publication_date
      ),
    true
  );
  return result;
end;
$$;

revoke all on function public.sme_project_detail_by_identity(uuid,uuid)
from public;
grant execute on function public.sme_project_detail_by_identity(uuid,uuid)
to authenticated,service_role;

comment on function public.sme_project_detail_by_identity(uuid,uuid) is
  'Authorized SME project detail with an SME-safe payload and timeline dates from Project End Date, Published Date, and LMS Publication Date [LCT] normalized custom fields.';
