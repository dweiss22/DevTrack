-- Resolve trusted course-development people from canonical Wrike identities and
-- keep ID-assigned courses visible while their SME identity needs attention.

create extension if not exists unaccent with schema extensions;

create or replace function public.normalize_course_development_person_name(value text)
returns text language sql immutable parallel safe set search_path=public,extensions as $$
  select lower(regexp_replace(extensions.unaccent(coalesce(btrim(value),'')),'\s+',' ','g'));
$$;

create or replace function public.course_development_person_tokens(values_to_split text[])
returns table(value text)
language sql immutable parallel safe set search_path=public as $$
  with raw_values as (
    select btrim(observed.value) raw_value
    from unnest(coalesce(values_to_split,'{}'::text[])) observed(value)
    where btrim(observed.value)<>''
  ), pieces as (
    select raw.raw_value,btrim(piece.value) value
    from raw_values raw
    cross join lateral regexp_split_to_table(raw.raw_value,'\s*[,;]\s*') piece(value)
    where btrim(piece.value)<>''
  ), decisions as (
    select raw_value,count(*)>1
      and bool_and(
        value ~ '\s'
        or value ~* '^[a-z0-9]{8}$'
        or value ~* '^[^@\s]+@[^@\s]+$'
      ) split_safely
    from pieces
    group by raw_value
  )
  select distinct case when decision.split_safely then piece.value else piece.raw_value end
  from pieces piece
  join decisions decision using(raw_value);
$$;

create or replace function public.course_development_person_assignments(
  target_organization_id uuid,target_role text
)
returns table(task_id uuid,wrike_user_id uuid,assignment_source text)
language sql stable security definer set search_path=public,extensions as $$
  with eligible as (
    select task.*
    from public.wrike_tasks task
    where task.organization_id=target_organization_id and not task.is_deleted
      and (task.workflow_id='IEACHQK7K4BHMLHM' or exists(
        select 1 from public.wrike_workflow_statuses status
        where status.organization_id=task.organization_id
          and status.wrike_id=task.custom_status_id
          and status.workflow_id='IEACHQK7K4BHMLHM' and not status.is_unresolved
      ))
  ), role_values as (
    select task.id task_id,task.wrike_id task_wrike_id,token.value
    from eligible task
    join public.wrike_task_normalized_custom_field_values field_value
      on field_value.task_id=task.id and not field_value.has_conflict
    join public.wrike_normalized_custom_fields field
      on field.id=field_value.normalized_field_id
    cross join lateral public.course_development_person_tokens(field_value.display_values) token
    where (target_role='sme' and field.normalized_key in (
      'sme','smes','subject matter expert','subject matter experts'
    )) or (target_role='id' and field.normalized_key in (
      'instructional designer','course owner','project owner','owner','id','id assigned'
    ))
  ), candidate_matches as (
    select role_value.task_id,role_value.value,identity.id wrike_user_id
    from role_values role_value
    join public.wrike_users identity
      on identity.organization_id=target_organization_id
      and identity.is_active and not identity.is_unresolved and identity.identity_verified
      and (
        lower(identity.wrike_id)=lower(btrim(role_value.value))
        or lower(coalesce(identity.email,''))=lower(btrim(role_value.value))
        or public.normalize_course_development_person_name(identity.display_name)
          =public.normalize_course_development_person_name(role_value.value)
        or exists(
          select 1
          from public.wrike_person_identities person
          where person.organization_id=target_organization_id and person.is_verified
            and person.wrike_contact_id=identity.wrike_id
            and role_value.task_wrike_id=any(person.source_task_ids)
            and (
              public.normalize_course_development_person_name(person.display_name)
                =public.normalize_course_development_person_name(role_value.value)
              or lower(coalesce(person.email,''))=lower(btrim(role_value.value))
            )
        )
      )
    group by role_value.task_id,role_value.value,identity.id
  ), blocked_tasks as (
    select distinct task.id
    from eligible task
    join public.wrike_task_normalized_custom_field_values field_value
      on field_value.task_id=task.id and field_value.has_conflict
    join public.wrike_normalized_custom_fields field
      on field.id=field_value.normalized_field_id
    where (target_role='sme' and field.normalized_key in (
      'sme','smes','subject matter expert','subject matter experts'
    )) or (target_role='id' and field.normalized_key in (
      'instructional designer','course owner','project owner','owner','id','id assigned'
    ))
  ), resolved as (
    select candidate.task_id,
      (array_agg(candidate.wrike_user_id order by candidate.wrike_user_id::text))[1] wrike_user_id
    from candidate_matches candidate
    group by candidate.task_id,candidate.value
    having count(distinct candidate.wrike_user_id)=1
  ), tasks_with_role_fields as (
    select distinct task.id
    from eligible task
    join public.wrike_task_normalized_custom_field_values field_value
      on field_value.task_id=task.id
    join public.wrike_normalized_custom_fields field
      on field.id=field_value.normalized_field_id
    where cardinality(field_value.display_values)>0 and (
      (target_role='sme' and field.normalized_key in (
        'sme','smes','subject matter expert','subject matter experts'
      )) or (target_role='id' and field.normalized_key in (
        'instructional designer','course owner','project owner','owner','id','id assigned'
      ))
    )
  ), mapped_fallback as (
    select task.id task_id,member.wrike_user_id
    from eligible task
    join public.wrike_task_assignees assignee on assignee.task_id=task.id
    join public.application_users member
      on member.organization_id=target_organization_id
      and member.account_state='active' and member.role=target_role
      and member.wrike_user_id=assignee.user_id
    join public.wrike_users identity on identity.id=member.wrike_user_id
      and identity.is_active and not identity.is_unresolved and identity.identity_verified
    where not exists(
      select 1 from tasks_with_role_fields present where present.id=task.id
    )
  )
  select distinct resolved.task_id,resolved.wrike_user_id,'normalized_field'::text
  from resolved
  where not exists(
    select 1 from blocked_tasks blocked where blocked.id=resolved.task_id
  )
  union
  select distinct fallback.task_id,fallback.wrike_user_id,'mapped_assignee'::text
  from mapped_fallback fallback;
$$;

create or replace function public.course_development_unresolved_person_options(
  target_organization_id uuid,target_role text
)
returns table(identity_key text,display_name text,email text,identity_status text)
language sql stable security definer set search_path=public,extensions as $$
  with eligible as (
    select task.id,task.wrike_id
    from public.wrike_tasks task
    where task.organization_id=target_organization_id and not task.is_deleted
      and (task.workflow_id='IEACHQK7K4BHMLHM' or exists(
        select 1 from public.wrike_workflow_statuses status
        where status.organization_id=task.organization_id
          and status.wrike_id=task.custom_status_id
          and status.workflow_id='IEACHQK7K4BHMLHM' and not status.is_unresolved
      ))
  ), observed as (
    select task.id task_id,task.wrike_id task_wrike_id,
      field_value.has_conflict,token.value
    from eligible task
    join public.wrike_task_normalized_custom_field_values field_value
      on field_value.task_id=task.id
    join public.wrike_normalized_custom_fields field
      on field.id=field_value.normalized_field_id
    cross join lateral public.course_development_person_tokens(field_value.display_values) token
    where (target_role='sme' and field.normalized_key in (
      'sme','smes','subject matter expert','subject matter experts'
    )) or (target_role='id' and field.normalized_key in (
      'instructional designer','course owner','project owner','owner','id','id assigned'
    ))
  ), candidate_matches as (
    select observed.task_id,observed.value,identity.id wrike_user_id
    from observed
    join public.wrike_users identity
      on identity.organization_id=target_organization_id
      and identity.is_active and not identity.is_unresolved and identity.identity_verified
      and (
        lower(identity.wrike_id)=lower(btrim(observed.value))
        or lower(coalesce(identity.email,''))=lower(btrim(observed.value))
        or public.normalize_course_development_person_name(identity.display_name)
          =public.normalize_course_development_person_name(observed.value)
        or exists(
          select 1
          from public.wrike_person_identities person
          where person.organization_id=target_organization_id and person.is_verified
            and person.wrike_contact_id=identity.wrike_id
            and observed.task_wrike_id=any(person.source_task_ids)
            and (
              public.normalize_course_development_person_name(person.display_name)
                =public.normalize_course_development_person_name(observed.value)
              or lower(coalesce(person.email,''))=lower(btrim(observed.value))
            )
        )
      )
    group by observed.task_id,observed.value,identity.id
  ), match_counts as (
    select observed.task_id,observed.value,observed.has_conflict,
      count(distinct candidate.wrike_user_id) match_count
    from observed
    left join candidate_matches candidate
      on candidate.task_id=observed.task_id and candidate.value=observed.value
    group by observed.task_id,observed.value,observed.has_conflict
  )
  select 'value:'||md5(public.normalize_course_development_person_name(value)),
    min(value),null::text,
    case when bool_or(has_conflict) or max(match_count)>1
      then 'ambiguous' else 'unverified' end
  from match_counts
  where has_conflict or match_count<>1
  group by public.normalize_course_development_person_name(value)
  order by 2;
$$;

drop function if exists public.reporting_id_dashboard_rows(uuid);
create function public.reporting_id_dashboard_rows(target_wrike_user_id uuid default null)
returns table(
  task_id uuid,title text,status_name text,status_classification text,
  reviewed_wrike_user_id uuid,reviewed_sme_name text,reviewed_sme_email text,
  reviewed_sme_application_user_id uuid,sme_mapping_status text,
  sme_identity_status text,sme_assignment_values text[],
  vertical text,publication_date date,publication_year integer,reporting_year integer,
  original_due_date date,due_date date,completed_at timestamptz,folder_context text,
  updated_at_wrike timestamptz,own_review jsonb,colleague_reviews jsonb
)
language plpgsql stable security definer set search_path=public,extensions as $$
declare viewer public.application_users%rowtype;
begin
  select * into viewer
  from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  if not found then
    raise exception using errcode='42501',message='Dashboard is unavailable.';
  end if;
  if viewer.role='id' then
    target_wrike_user_id:=viewer.wrike_user_id;
  elsif viewer.role not in ('super_admin','admin') then
    raise exception using errcode='42501',message='Dashboard is unavailable.';
  end if;
  if target_wrike_user_id is null or not exists(
    select 1
    from public.course_development_person_assignments_with_personas(
      viewer.organization_id,'id'
    ) assignment
    where assignment.wrike_user_id=target_wrike_user_id
  ) then return; end if;

  return query
  select task.id,task.title,coalesce(status.title,task.status),
    coalesce(status.dashboard_classification,'unclassified'),
    sme_identity.id,sme_identity.display_name,sme_identity.email,sme_member.id,
    case when sme_identity.id is null then null
      when sme_member.id is null then 'unmapped' else 'mapped' end,
    case
      when sme_identity.id is not null then 'verified'
      when sme_evidence.has_conflict then 'conflict'
      when cardinality(sme_evidence.assignment_values)>0 then 'unresolved'
      else 'missing'
    end,
    coalesce(sme_evidence.assignment_values,'{}'::text[]),
    vertical.vertical,publication.publication_date,
    extract(year from publication.publication_date)::integer,
    reporting.reporting_year,task.original_due_date,task.due_date,task.completed_at,
    coalesce((
      select string_agg(distinct folder.title,', ' order by folder.title)
      from public.wrike_task_locations location
      join public.wrike_folders folder on folder.id=location.folder_id
      where location.task_id=task.id
    ),'—'),task.updated_at_wrike,
    (
      select jsonb_build_object(
        'id',survey.id,'status',survey.status,'isLocked',survey.is_locked,
        'canEdit',public.can_edit_survey(survey.id),
        'revisionNumber',survey.revision_number
      )
      from public.survey_submissions survey
      where sme_identity.id is not null
        and survey.organization_id=viewer.organization_id
        and survey.task_id=task.id and survey.survey_type='id_sme_review'
        and survey.reviewed_wrike_user_id=sme_identity.id
        and survey.created_by=viewer.id
      limit 1
    ),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',survey.id,'status',survey.status,'isLocked',survey.is_locked,
        'revisionNumber',survey.revision_number,
        'creatorName',case when creator.state='deleted' then 'Deleted user'
          else coalesce(creator.display_name,'Unnamed reviewer') end
      ) order by survey.updated_at desc)
      from public.survey_submissions survey
      join public.application_user_principals creator on creator.id=survey.created_by
      where sme_identity.id is not null
        and survey.organization_id=viewer.organization_id
        and survey.task_id=task.id and survey.survey_type='id_sme_review'
        and survey.reviewed_wrike_user_id=sme_identity.id
        and survey.created_by<>viewer.id
    ),'[]'::jsonb)
  from public.course_development_person_assignments_with_personas(
    viewer.organization_id,'id'
  ) owner_assignment
  join public.wrike_tasks task on task.id=owner_assignment.task_id
  left join public.course_development_person_assignments_with_personas(
    viewer.organization_id,'sme'
  ) sme_assignment on sme_assignment.task_id=task.id
  left join public.wrike_users sme_identity on sme_identity.id=sme_assignment.wrike_user_id
  left join public.application_users sme_member
    on sme_member.organization_id=viewer.organization_id
    and sme_member.account_state='active' and sme_member.role='sme'
    and sme_member.wrike_user_id=sme_identity.id
  left join public.wrike_workflow_statuses status
    on status.organization_id=task.organization_id
    and status.wrike_id=task.custom_status_id
  left join lateral (
    select coalesce(bool_or(field_value.has_conflict),false) has_conflict,
      coalesce(array_agg(distinct token.value order by token.value)
        filter (where token.value is not null),'{}'::text[]) assignment_values
    from public.wrike_task_normalized_custom_field_values field_value
    join public.wrike_normalized_custom_fields field
      on field.id=field_value.normalized_field_id
    left join lateral public.course_development_person_tokens(
      field_value.display_values
    ) token on true
    where field_value.task_id=task.id and field.normalized_key in (
      'sme','smes','subject matter expert','subject matter experts'
    )
  ) sme_evidence on true
  left join lateral (
    select field_value.vertical_reporting_category vertical
    from public.wrike_task_normalized_custom_field_values field_value
    join public.wrike_normalized_custom_fields field
      on field.id=field_value.normalized_field_id
    where field_value.task_id=task.id and field.normalized_key='vertical'
      and not field_value.has_conflict limit 1
  ) vertical on true
  left join lateral (
    select observed.value::date publication_date
    from public.wrike_task_normalized_custom_field_values field_value
    join public.wrike_normalized_custom_fields field
      on field.id=field_value.normalized_field_id
    cross join lateral unnest(field_value.display_values) observed(value)
    where field_value.task_id=task.id
      and field.normalized_key in ('publication','publication date','publish date')
      and not field_value.has_conflict
      and observed.value ~ '^\d{4}-\d{2}-\d{2}$'
    limit 1
  ) publication on true
  left join lateral (
    select field_value.reporting_year
    from public.wrike_task_normalized_custom_field_values field_value
    join public.wrike_normalized_custom_fields field
      on field.id=field_value.normalized_field_id
    where field_value.task_id=task.id
      and field.normalized_key in ('reporting','reporting year')
      and not field_value.has_conflict limit 1
  ) reporting on true
  where owner_assignment.wrike_user_id=target_wrike_user_id
  order by task.completed_at nulls first,task.due_date nulls last,
    task.title,sme_identity.display_name nulls last;
end;
$$;

revoke all on function public.normalize_course_development_person_name(text) from public;
revoke all on function public.course_development_person_tokens(text[]) from public;
revoke all on function public.course_development_person_assignments(uuid,text) from public;
revoke all on function public.course_development_unresolved_person_options(uuid,text) from public;
revoke all on function public.reporting_id_dashboard_rows(uuid) from public;
grant execute on function public.normalize_course_development_person_name(text) to authenticated,service_role;
grant execute on function public.course_development_person_tokens(text[]) to authenticated,service_role;
grant execute on function public.course_development_person_assignments(uuid,text) to authenticated,service_role;
grant execute on function public.course_development_unresolved_person_options(uuid,text) to authenticated,service_role;
grant execute on function public.reporting_id_dashboard_rows(uuid) to authenticated,service_role;

select pg_notify('pgrst','reload schema');
