-- Assignment-driven SME/ID dashboards and generalized application-to-Wrike identity mappings.

drop index if exists public.application_users_org_wrike_sme_idx;
create unique index if not exists application_users_org_wrike_identity_idx
  on public.application_users(organization_id,wrike_user_id) where wrike_user_id is not null;

create or replace function public.guard_application_user_authorization()
returns trigger language plpgsql security definer set search_path=public,auth as $$
declare target_email text; mapped_organization_id uuid; target_user_id uuid;
begin
  target_user_id:=case when tg_op='DELETE' then old.id else new.id end;
  select lower(btrim(email)) into target_email from auth.users where id=target_user_id;
  if tg_op='DELETE' then
    if old.role='super_admin' or target_email='dweiss@lexipol.com' then
      raise exception using errcode='23514',message='The required SuperAdmin account cannot be removed.';
    end if;
    return old;
  end if;
  if target_email='dweiss@lexipol.com' and new.role<>'super_admin' then
    raise exception using errcode='23514',message='The required SuperAdmin account cannot be demoted.';
  end if;
  if new.role='super_admin' and target_email is distinct from 'dweiss@lexipol.com' then
    raise exception using errcode='23514',message='Only the fixed SuperAdmin account may hold the SuperAdmin role.';
  end if;
  if tg_op='UPDATE' and old.role='super_admin'
    and (new.role is distinct from old.role or new.organization_id is distinct from old.organization_id) then
    raise exception using errcode='23514',message='The required SuperAdmin role and organization cannot be changed.';
  end if;
  if new.role not in ('id','sme') then new.wrike_user_id=null; end if;
  if new.wrike_user_id is not null then
    select organization_id into mapped_organization_id from public.wrike_users
      where id=new.wrike_user_id and is_active and not is_unresolved and identity_verified;
    if mapped_organization_id is distinct from new.organization_id then
      raise exception using errcode='23514',message='The Wrike identity must be verified and belong to the same organization.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.change_application_user_role(
  target_organization_id uuid,target_user_id uuid,target_role text,acting_user_id uuid
) returns void language plpgsql security definer set search_path=public,auth as $$
declare actor_role text; current_role text; target_email text;
begin
  if target_role not in ('super_admin','admin','id','sme') then
    raise exception using errcode='22023',message='Invalid application role.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text,0));
  select role into actor_role from public.application_users
    where id=acting_user_id and organization_id=target_organization_id;
  if actor_role not in ('super_admin','admin') then
    raise exception using errcode='42501',message='User management permission is required.';
  end if;
  select application_user.role,lower(btrim(auth_user.email)) into current_role,target_email
    from public.application_users application_user join auth.users auth_user on auth_user.id=application_user.id
    where application_user.id=target_user_id and application_user.organization_id=target_organization_id
    for update of application_user;
  if not found then raise exception using errcode='P0001',message='Organization member not found.'; end if;
  if current_role='super_admin' or target_email='dweiss@lexipol.com' then
    raise exception using errcode='23514',message='The required SuperAdmin account cannot be modified.';
  end if;
  if target_role='super_admin' then
    raise exception using errcode='42501',message='The SuperAdmin role cannot be assigned.';
  end if;
  update public.application_users set role=target_role,
    wrike_user_id=case when target_role in ('id','sme') then wrike_user_id else null end,updated_at=now()
    where id=target_user_id and organization_id=target_organization_id;
end;
$$;

create or replace function public.set_application_user_wrike_identity(
  target_organization_id uuid,target_user_id uuid,target_wrike_user_id uuid,acting_user_id uuid
) returns void language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.application_users where id=acting_user_id
    and organization_id=target_organization_id and role in ('super_admin','admin')) then
    raise exception using errcode='42501',message='User management permission is required.';
  end if;
  if not exists(select 1 from public.application_users where id=target_user_id
    and organization_id=target_organization_id and role in ('id','sme')) then
    raise exception using errcode='P0001',message='The selected application user cannot be mapped.';
  end if;
  if target_wrike_user_id is not null and not exists(select 1 from public.wrike_users
    where id=target_wrike_user_id and organization_id=target_organization_id
      and is_active and not is_unresolved and identity_verified) then
    raise exception using errcode='P0001',message='The selected synchronized identity is not eligible.';
  end if;
  update public.application_users set wrike_user_id=target_wrike_user_id,updated_at=now()
    where id=target_user_id and organization_id=target_organization_id;
end;
$$;

create or replace function public.set_application_user_sme_identity(
  target_organization_id uuid,target_user_id uuid,target_wrike_user_id uuid,acting_user_id uuid
) returns void language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.application_users where id=target_user_id
    and organization_id=target_organization_id and role='sme') then
    raise exception using errcode='P0001',message='The selected application user is not an SME.';
  end if;
  perform public.set_application_user_wrike_identity(
    target_organization_id,target_user_id,target_wrike_user_id,acting_user_id
  );
end;
$$;

create index if not exists wrike_task_assignees_user_task_idx on public.wrike_task_assignees(user_id,task_id);
create index if not exists wrike_normalized_fields_role_idx
  on public.wrike_normalized_custom_fields(organization_id,normalized_key,id);
create index if not exists survey_submissions_reviewed_creator_idx
  on public.survey_submissions(organization_id,reviewed_wrike_user_id,created_by,updated_at desc);
create index if not exists survey_debrief_year_idx
  on public.course_development_debrief_responses(original_due_year,submission_id);
create index if not exists survey_review_filter_idx
  on public.id_sme_review_responses(vertical,publication_year,submission_id);

create or replace function public.course_development_person_assignments(target_organization_id uuid,target_role text)
returns table(task_id uuid,wrike_user_id uuid,assignment_source text)
language sql stable security definer set search_path=public as $$
  with eligible as (
    select task.*
    from public.wrike_tasks task
    where task.organization_id=target_organization_id and not task.is_deleted
      and (task.workflow_id='IEACHQK7K4BHMLHM' or exists(
        select 1 from public.wrike_workflow_statuses status
        where status.organization_id=task.organization_id and status.wrike_id=task.custom_status_id
          and status.workflow_id='IEACHQK7K4BHMLHM' and not status.is_unresolved
      ))
  ), role_values as (
    select task.id task_id,task.wrike_id task_wrike_id,observed.value
    from eligible task
    join public.wrike_task_normalized_custom_field_values value on value.task_id=task.id and not value.has_conflict
    join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
    cross join lateral unnest(value.display_values) observed(value)
    where (target_role='sme' and field.normalized_key in ('sme','smes','subject matter expert','subject matter experts'))
       or (target_role='id' and field.normalized_key in ('instructional designer','course owner','project owner','owner','id','id assigned'))
  ), candidate_matches as (
    select role_value.task_id,role_value.value,"user".id wrike_user_id
    from role_values role_value
    join public.wrike_users "user" on "user".organization_id=target_organization_id
      and "user".is_active and not "user".is_unresolved and "user".identity_verified
      and (
        lower("user".wrike_id)=lower(btrim(role_value.value))
        or exists(
          select 1 from public.wrike_person_identities identity
          where identity.organization_id=target_organization_id and identity.is_verified
            and identity.wrike_contact_id="user".wrike_id
            and role_value.task_wrike_id=any(identity.source_task_ids)
            and (identity.normalized_name=lower(regexp_replace(btrim(role_value.value),'\s+',' ','g'))
              or lower(coalesce(identity.email,''))=lower(btrim(role_value.value)))
        )
      )
    group by role_value.task_id,role_value.value,"user".id
  ), blocked_tasks as (
    select distinct task.id
    from eligible task
    join public.wrike_task_normalized_custom_field_values value on value.task_id=task.id and value.has_conflict
    join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
    where (target_role='sme' and field.normalized_key in ('sme','smes','subject matter expert','subject matter experts'))
       or (target_role='id' and field.normalized_key in ('instructional designer','course owner','project owner','owner','id','id assigned'))
  ), resolved as (
    select candidate.task_id,
      (array_agg(candidate.wrike_user_id order by candidate.wrike_user_id::text))[1] wrike_user_id
    from candidate_matches candidate
    group by candidate.task_id,candidate.value
    having count(distinct candidate.wrike_user_id)=1
  ), tasks_with_role_fields as (
    select distinct task.id
    from eligible task
    join public.wrike_task_normalized_custom_field_values value on value.task_id=task.id
    join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
    where cardinality(value.display_values)>0 and (
      (target_role='sme' and field.normalized_key in ('sme','smes','subject matter expert','subject matter experts'))
       or (target_role='id' and field.normalized_key in ('instructional designer','course owner','project owner','owner','id','id assigned')))
  ), mapped_fallback as (
    select task.id task_id,member.wrike_user_id
    from eligible task
    join public.wrike_task_assignees assignee on assignee.task_id=task.id
    join public.application_users member on member.organization_id=target_organization_id
      and member.role=target_role and member.wrike_user_id=assignee.user_id
    join public.wrike_users "user" on "user".id=member.wrike_user_id
      and "user".is_active and not "user".is_unresolved and "user".identity_verified
    where not exists(select 1 from tasks_with_role_fields present where present.id=task.id)
  )
  select distinct resolved.task_id,resolved.wrike_user_id,'normalized_field'::text from resolved
  where not exists(select 1 from blocked_tasks blocked where blocked.id=resolved.task_id)
  union
  select distinct mapped_fallback.task_id,mapped_fallback.wrike_user_id,'mapped_assignee'::text from mapped_fallback;
$$;

create or replace function public.course_development_unresolved_person_options(target_organization_id uuid,target_role text)
returns table(identity_key text,display_name text,email text,identity_status text)
language sql stable security definer set search_path=public as $$
  with eligible as (
    select task.id,task.wrike_id
    from public.wrike_tasks task
    where task.organization_id=target_organization_id and not task.is_deleted
      and (task.workflow_id='IEACHQK7K4BHMLHM' or exists(
        select 1 from public.wrike_workflow_statuses status where status.organization_id=task.organization_id
          and status.wrike_id=task.custom_status_id and status.workflow_id='IEACHQK7K4BHMLHM' and not status.is_unresolved
      ))
  ), observed as (
    select task.wrike_id task_wrike_id,value.has_conflict,person_value.value
    from eligible task
    join public.wrike_task_normalized_custom_field_values value on value.task_id=task.id
    join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
    cross join lateral unnest(value.display_values) person_value(value)
    where (target_role='sme' and field.normalized_key in ('sme','smes','subject matter expert','subject matter experts'))
       or (target_role='id' and field.normalized_key in ('instructional designer','course owner','project owner','owner','id','id assigned'))
  )
  select coalesce(identity.identity_key,'value:'||md5(lower(btrim(observed.value)))),
    coalesce(identity.display_name,observed.value),identity.email,
    case when bool_or(observed.has_conflict) or count(distinct identity.wrike_contact_id)>1
      or bool_or(identity.verification_status='ambiguous') then 'ambiguous' else 'unverified' end
  from observed
  left join public.wrike_person_identities identity on identity.organization_id=target_organization_id
    and observed.task_wrike_id=any(identity.source_task_ids)
    and (identity.normalized_name=lower(regexp_replace(btrim(observed.value),'\s+',' ','g'))
      or lower(coalesce(identity.email,''))=lower(btrim(observed.value)))
  where not exists(
    select 1 from public.wrike_users "user" where "user".organization_id=target_organization_id
      and "user".is_active and not "user".is_unresolved and "user".identity_verified
      and (lower("user".wrike_id)=lower(btrim(observed.value))
        or "user".wrike_id=identity.wrike_contact_id)
  )
  group by coalesce(identity.identity_key,'value:'||md5(lower(btrim(observed.value)))),
    coalesce(identity.display_name,observed.value),identity.email;
$$;

drop function if exists public.reporting_sme_dashboard_users();
drop function if exists public.reporting_sme_dashboard(uuid);

create or replace function public.reporting_sme_dashboard_identities()
returns table(identity_key text,wrike_user_id uuid,application_user_id uuid,display_name text,email text,
  mapping_status text,identity_status text,selectable boolean)
language plpgsql stable security definer set search_path=public as $$
declare viewer public.application_users%rowtype;
begin
  select * into viewer from public.application_users where id=auth.uid();
  if not found or viewer.role not in ('super_admin','admin','id','sme') then
    raise exception using errcode='42501',message='Dashboard is unavailable.';
  end if;
  return query
  with assigned as (
    select distinct assignment.wrike_user_id
    from public.course_development_person_assignments(viewer.organization_id,'sme') assignment
  )
  select 'wrike:'||identity.id::text,identity.id,member.id,identity.display_name,identity.email,
    case when member.id is null then 'unmapped' else 'mapped' end,'verified',true
  from assigned
  join public.wrike_users identity on identity.id=assigned.wrike_user_id
  left join public.application_users member on member.organization_id=viewer.organization_id
    and member.role='sme' and member.wrike_user_id=identity.id
  where viewer.role<>'sme' or member.id=viewer.id
  union all
  select unresolved.identity_key,null::uuid,null::uuid,unresolved.display_name,unresolved.email,
    'unmapped',unresolved.identity_status,false
  from public.course_development_unresolved_person_options(viewer.organization_id,'sme') unresolved
  where viewer.role<>'sme'
  order by 4;
end;
$$;

create or replace function public.reporting_sme_dashboard_rows(target_wrike_user_id uuid default null)
returns table(task_id uuid,title text,status_name text,status_classification text,reporting_year integer,
  original_due_date date,due_date date,completed_at timestamptz,actual_minutes bigint,folder_context text,
  updated_at_wrike timestamptz,is_overdue boolean,subject_application_user_id uuid,
  submission_id uuid,survey_status text,survey_is_locked boolean,survey_can_edit boolean)
language plpgsql stable security definer set search_path=public as $$
declare viewer public.application_users%rowtype;
begin
  select * into viewer from public.application_users where id=auth.uid();
  if not found then raise exception using errcode='42501',message='Dashboard is unavailable.'; end if;
  if viewer.role='sme' then target_wrike_user_id:=viewer.wrike_user_id;
  elsif viewer.role not in ('super_admin','admin','id') then
    raise exception using errcode='42501',message='Dashboard is unavailable.';
  end if;
  if target_wrike_user_id is null or not exists(
    select 1 from public.course_development_person_assignments(viewer.organization_id,'sme') assignment
    where assignment.wrike_user_id=target_wrike_user_id
  ) then return; end if;
  return query
  select task.id,task.title,coalesce(status.title,task.status),coalesce(status.dashboard_classification,'unclassified'),
    reporting.reporting_year,task.original_due_date,task.due_date,task.completed_at,
    coalesce((select sum(entry.minutes) from public.wrike_time_entries entry
      where entry.task_id=task.id and not entry.is_deleted),0)::bigint,
    coalesce((select string_agg(distinct folder.title,', ' order by folder.title)
      from public.wrike_task_locations location join public.wrike_folders folder on folder.id=location.folder_id
      where location.task_id=task.id),'—'),task.updated_at_wrike,
    task.completed_at is null and task.due_date<current_date,subject.id,
    survey.id,survey.status,survey.is_locked,
    case when survey.id is null then false else public.can_edit_survey(survey.id) end
  from public.course_development_person_assignments(viewer.organization_id,'sme') assignment
  join public.wrike_tasks task on task.id=assignment.task_id
  left join public.wrike_workflow_statuses status on status.organization_id=task.organization_id
    and status.wrike_id=task.custom_status_id
  left join public.application_users subject on subject.organization_id=viewer.organization_id
    and subject.role='sme' and subject.wrike_user_id=target_wrike_user_id
  left join lateral (
    select value.reporting_year from public.wrike_task_normalized_custom_field_values value
    join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
    where value.task_id=task.id and field.normalized_key in ('reporting','reporting year') and not value.has_conflict limit 1
  ) reporting on true
  left join public.survey_submissions survey on survey.organization_id=viewer.organization_id
    and survey.task_id=task.id and survey.survey_type='course_development_debrief'
    and survey.reviewed_wrike_user_id=target_wrike_user_id
  where assignment.wrike_user_id=target_wrike_user_id
  order by task.completed_at nulls first,task.due_date nulls last,task.title;
end;
$$;

create or replace function public.reporting_current_id_identity()
returns table(wrike_user_id uuid,display_name text,email text,mapping_status text)
language sql stable security definer set search_path=public as $$
  select identity.id,identity.display_name,identity.email,
    case when member.wrike_user_id is null then 'missing'
         when identity.id is null or not identity.identity_verified then 'ambiguous' else 'mapped' end
  from public.application_users member
  left join public.wrike_users identity on identity.id=member.wrike_user_id
    and identity.organization_id=member.organization_id and identity.is_active and not identity.is_unresolved
  where member.id=auth.uid() and member.role='id';
$$;

create or replace function public.reporting_id_dashboard_identities()
returns table(identity_key text,wrike_user_id uuid,application_user_id uuid,display_name text,email text,
  mapping_status text,identity_status text,selectable boolean)
language plpgsql stable security definer set search_path=public as $$
declare viewer public.application_users%rowtype;
begin
  select * into viewer from public.application_users where id=auth.uid();
  if not found or viewer.role not in ('super_admin','admin') then
    raise exception using errcode='42501',message='Dashboard is unavailable.';
  end if;
  return query
  with assigned as (
    select distinct assignment.wrike_user_id
    from public.course_development_person_assignments(viewer.organization_id,'id') assignment
  )
  select 'wrike:'||identity.id::text,identity.id,member.id,identity.display_name,identity.email,
    case when member.id is null then 'unmapped' else 'mapped' end,'verified',true
  from assigned join public.wrike_users identity on identity.id=assigned.wrike_user_id
  left join public.application_users member on member.organization_id=viewer.organization_id
    and member.role='id' and member.wrike_user_id=identity.id
  union all
  select unresolved.identity_key,null::uuid,null::uuid,unresolved.display_name,unresolved.email,
    'unmapped',unresolved.identity_status,false
  from public.course_development_unresolved_person_options(viewer.organization_id,'id') unresolved
  order by 4;
end;
$$;

create or replace function public.reporting_id_dashboard_rows(target_wrike_user_id uuid default null)
returns table(task_id uuid,title text,status_name text,status_classification text,reviewed_wrike_user_id uuid,
  reviewed_sme_name text,reviewed_sme_email text,reviewed_sme_application_user_id uuid,sme_mapping_status text,
  vertical text,publication_date date,publication_year integer,reporting_year integer,original_due_date date,
  due_date date,completed_at timestamptz,folder_context text,updated_at_wrike timestamptz,
  own_review jsonb,colleague_reviews jsonb)
language plpgsql stable security definer set search_path=public as $$
declare viewer public.application_users%rowtype;
begin
  select * into viewer from public.application_users where id=auth.uid();
  if not found then raise exception using errcode='42501',message='Dashboard is unavailable.'; end if;
  if viewer.role='id' then target_wrike_user_id:=viewer.wrike_user_id;
  elsif viewer.role not in ('super_admin','admin') then
    raise exception using errcode='42501',message='Dashboard is unavailable.';
  end if;
  if target_wrike_user_id is null or not exists(
    select 1 from public.course_development_person_assignments(viewer.organization_id,'id') assignment
    where assignment.wrike_user_id=target_wrike_user_id
  ) then return; end if;
  return query
  select task.id,task.title,coalesce(status.title,task.status),coalesce(status.dashboard_classification,'unclassified'),
    sme_identity.id,sme_identity.display_name,sme_identity.email,sme_member.id,
    case when sme_member.id is null then 'unmapped' else 'mapped' end,
    vertical.vertical,publication.publication_date,extract(year from publication.publication_date)::integer,
    reporting.reporting_year,task.original_due_date,task.due_date,task.completed_at,
    coalesce((select string_agg(distinct folder.title,', ' order by folder.title)
      from public.wrike_task_locations location join public.wrike_folders folder on folder.id=location.folder_id
      where location.task_id=task.id),'—'),task.updated_at_wrike,
    (select jsonb_build_object('id',survey.id,'status',survey.status,'isLocked',survey.is_locked,
      'canEdit',public.can_edit_survey(survey.id),'revisionNumber',survey.revision_number)
      from public.survey_submissions survey where survey.organization_id=viewer.organization_id
        and survey.task_id=task.id and survey.survey_type='id_sme_review'
        and survey.reviewed_wrike_user_id=sme_identity.id and survey.created_by=viewer.id limit 1),
    coalesce((select jsonb_agg(jsonb_build_object('id',survey.id,'status',survey.status,
      'isLocked',survey.is_locked,'revisionNumber',survey.revision_number,
      'creatorName',coalesce(creator.display_name,'Unnamed reviewer')) order by survey.updated_at desc)
      from public.survey_submissions survey join public.application_users creator on creator.id=survey.created_by
      where survey.organization_id=viewer.organization_id and survey.task_id=task.id
        and survey.survey_type='id_sme_review' and survey.reviewed_wrike_user_id=sme_identity.id
        and survey.created_by<>viewer.id),'[]'::jsonb)
  from public.course_development_person_assignments(viewer.organization_id,'id') owner_assignment
  join public.wrike_tasks task on task.id=owner_assignment.task_id
  join public.course_development_person_assignments(viewer.organization_id,'sme') sme_assignment
    on sme_assignment.task_id=task.id
  join public.wrike_users sme_identity on sme_identity.id=sme_assignment.wrike_user_id
  left join public.application_users sme_member on sme_member.organization_id=viewer.organization_id
    and sme_member.role='sme' and sme_member.wrike_user_id=sme_identity.id
  left join public.wrike_workflow_statuses status on status.organization_id=task.organization_id
    and status.wrike_id=task.custom_status_id
  left join lateral (
    select value.vertical_reporting_category vertical
    from public.wrike_task_normalized_custom_field_values value
    join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
    where value.task_id=task.id and field.normalized_key='vertical' and not value.has_conflict limit 1
  ) vertical on true
  left join lateral (
    select observed.value::date publication_date
    from public.wrike_task_normalized_custom_field_values value
    join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
    cross join lateral unnest(value.display_values) observed(value)
    where value.task_id=task.id and field.normalized_key in ('publication','publication date','publish date')
      and not value.has_conflict and observed.value ~ '^\d{4}-\d{2}-\d{2}$' limit 1
  ) publication on true
  left join lateral (
    select value.reporting_year from public.wrike_task_normalized_custom_field_values value
    join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
    where value.task_id=task.id and field.normalized_key in ('reporting','reporting year') and not value.has_conflict limit 1
  ) reporting on true
  where owner_assignment.wrike_user_id=target_wrike_user_id
  order by task.completed_at nulls first,task.due_date nulls last,task.title,sme_identity.display_name;
end;
$$;

create or replace function public.survey_browse(filters jsonb default '{}'::jsonb,page_number integer default 1,page_size integer default 50)
returns table(total_count bigint,id uuid,survey_type text,status text,is_locked boolean,revision_number integer,
  updated_at timestamptz,task_id uuid,project_title text,sme_name text,creator_id uuid,creator_name text,
  vertical text,reporting_year integer,publication_year integer)
language plpgsql stable security definer set search_path=public as $$
declare viewer public.application_users%rowtype; safe_page integer:=greatest(page_number,1); safe_size integer:=least(greatest(page_size,1),100);
begin
  select * into viewer from public.application_users where id=auth.uid();
  if not found then raise exception using errcode='42501',message='Surveys are unavailable.'; end if;
  return query
  with visible as (
    select survey.*,coalesce(survey.context_snapshot#>>'{subject,name}',reviewed.display_name,'Unavailable') resolved_sme,
      coalesce(creator.display_name,'Unnamed reviewer') resolved_creator,
      coalesce(review.vertical,survey.context_snapshot->>'vertical') resolved_vertical,
      coalesce(debrief.original_due_year,case when survey.context_snapshot->>'reportingYear' ~ '^\d{4}$'
        then (survey.context_snapshot->>'reportingYear')::integer end) resolved_reporting_year,
      coalesce(review.publication_year,case when survey.context_snapshot->>'publicationYear' ~ '^\d{4}$'
        then (survey.context_snapshot->>'publicationYear')::integer end) resolved_publication_year,
      coalesce(survey.context_snapshot->>'projectTitle',survey.context_snapshot->>'taskTitle','Unavailable') resolved_project
    from public.survey_submissions survey
    join public.application_users creator on creator.id=survey.created_by
    left join public.wrike_users reviewed on reviewed.id=survey.reviewed_wrike_user_id
    left join public.course_development_debrief_responses debrief on debrief.submission_id=survey.id
    left join public.id_sme_review_responses review on review.submission_id=survey.id
    where survey.organization_id=viewer.organization_id
      and (viewer.role in ('super_admin','admin')
        or (viewer.role='id' and survey.survey_type='id_sme_review')
        or (viewer.role='sme' and survey.survey_type='course_development_debrief'
          and survey.subject_application_user_id=viewer.id))
  ), filtered as (
    select * from visible
    where (coalesce(filters->>'surveyType','')='' or visible.survey_type=filters->>'surveyType')
      and (coalesce(filters->>'status','')='' or visible.status=filters->>'status')
      and (coalesce(filters->>'lockState','')='' or
        (filters->>'lockState' in ('true','false') and visible.is_locked=(filters->>'lockState')::boolean))
      and (coalesce(filters->>'project','')='' or visible.task_id::text=filters->>'project')
      and (coalesce(filters->>'sme','')='' or visible.reviewed_wrike_user_id::text=filters->>'sme')
      and (coalesce(filters->>'creator','')='' or visible.created_by::text=filters->>'creator')
      and (coalesce(filters->>'vertical','')='' or visible.resolved_vertical=filters->>'vertical')
      and (coalesce(filters->>'reportingYear','')='' or
        (filters->>'reportingYear' ~ '^\d{4}$' and visible.resolved_reporting_year=(filters->>'reportingYear')::integer))
      and (coalesce(filters->>'publicationYear','')='' or
        (filters->>'publicationYear' ~ '^\d{4}$' and visible.resolved_publication_year=(filters->>'publicationYear')::integer))
  )
  select count(*) over(),filtered.id,filtered.survey_type,filtered.status,filtered.is_locked,
    filtered.revision_number,filtered.updated_at,filtered.task_id,filtered.resolved_project,
    filtered.resolved_sme,filtered.created_by,filtered.resolved_creator,filtered.resolved_vertical,
    filtered.resolved_reporting_year,filtered.resolved_publication_year
  from filtered order by filtered.updated_at desc
  limit safe_size offset (safe_page-1)*safe_size;
end;
$$;

create or replace function public.survey_context_for_task(target_task_id uuid,requested_type text)
returns jsonb language plpgsql stable security definer set search_path=public,auth as $$
declare viewer public.application_users%rowtype; task public.wrike_tasks%rowtype; reporting_year integer;
  vertical_value text; publication_date date; assigned_smes jsonb; viewer_email text;
  target_project_id uuid; project_count integer;
begin
  select * into viewer from public.application_users where id=auth.uid();
  if not found or requested_type not in ('course_development_debrief','id_sme_review') then
    raise exception using errcode='42501',message='Survey context is unavailable.';
  end if;
  select * into task from public.wrike_tasks where id=target_task_id
    and organization_id=viewer.organization_id and not is_deleted;
  if not found or not exists(select 1 from public.course_development_person_assignments(viewer.organization_id,'sme') a
    where a.task_id=task.id) then raise exception using errcode='42501',message='Survey context is unavailable.'; end if;
  if requested_type='id_sme_review' and viewer.role not in ('super_admin','admin','id') then
    raise exception using errcode='42501',message='Survey context is unavailable.';
  end if;
  if requested_type='course_development_debrief' and viewer.role not in ('super_admin','admin','sme') then
    raise exception using errcode='42501',message='Survey context is unavailable.';
  end if;
  if viewer.role='sme' and not exists(select 1 from public.course_development_person_assignments(viewer.organization_id,'sme') a
    where a.task_id=task.id and a.wrike_user_id=viewer.wrike_user_id) then
    raise exception using errcode='42501',message='Survey context is unavailable.';
  end if;
  select count(*),(array_agg(project.id order by project.id::text))[1]
    into project_count,target_project_id
  from (
    select distinct project.id
    from public.wrike_task_locations location
    join public.wrike_projects project on project.id=location.project_id
      and project.organization_id=viewer.organization_id
    where location.task_id=task.id and project.deleted_at is null
  ) project;
  if project_count<>1 then target_project_id:=null; end if;
  select value.reporting_year into reporting_year from public.wrike_task_normalized_custom_field_values value
    join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
    where value.task_id=task.id and field.normalized_key in ('reporting','reporting year') and not value.has_conflict limit 1;
  select value.vertical_reporting_category into vertical_value from public.wrike_task_normalized_custom_field_values value
    join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
    where value.task_id=task.id and field.normalized_key='vertical' and not value.has_conflict limit 1;
  select observed.value::date into publication_date from public.wrike_task_normalized_custom_field_values value
    join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
    cross join lateral unnest(value.display_values) observed(value)
    where value.task_id=task.id and field.normalized_key in ('publication','publication date','publish date')
      and not value.has_conflict and observed.value ~ '^\d{4}-\d{2}-\d{2}$' limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('applicationUserId',member.id,'wrikeUserId',identity.id,
    'wrikeId',identity.wrike_id,'name',identity.display_name,'email',identity.email,
    'mappingStatus',case when member.id is null then 'unmapped' else 'mapped' end,
    'identityStatus','verified') order by identity.display_name),'[]'::jsonb) into assigned_smes
  from public.course_development_person_assignments(viewer.organization_id,'sme') assignment
  join public.wrike_users identity on identity.id=assignment.wrike_user_id
  left join public.application_users member on member.organization_id=viewer.organization_id
    and member.role='sme' and member.wrike_user_id=identity.id
  where assignment.task_id=task.id;
  select email into viewer_email from auth.users where id=viewer.id;
  return jsonb_build_object('organizationId',viewer.organization_id,'taskId',task.id,'taskWrikeId',task.wrike_id,
    'taskTitle',task.title,'projectId',target_project_id,'projectTitle',
    (select title from public.wrike_projects where id=target_project_id),'originalDueDate',task.original_due_date,
    'originalDueYear',extract(year from task.original_due_date)::integer,'reportingYear',reporting_year,
    'status',task.status,'vertical',vertical_value,'publicationDate',publication_date,
    'publicationYear',extract(year from publication_date)::integer,'assignedSmes',assigned_smes,
    'viewer',jsonb_build_object('id',viewer.id,'name',viewer.display_name,'email',viewer_email,'role',viewer.role));
end;
$$;

create or replace function public.survey_create_or_resume(
  target_task_id uuid,requested_type text,target_sme_application_user_id uuid default null,
  target_reviewed_wrike_user_id uuid default null
) returns uuid language plpgsql security definer set search_path=public,auth as $$
declare viewer public.application_users%rowtype; subject public.application_users%rowtype; identity public.wrike_users%rowtype;
  context jsonb; existing_id uuid; created_id uuid; subject_email text;
begin
  select * into viewer from public.application_users where id=auth.uid();
  if not found then raise exception using errcode='42501',message='Survey context is unavailable.'; end if;
  context:=public.survey_context_for_task(target_task_id,requested_type);
  if requested_type='course_development_debrief' then
    target_sme_application_user_id:=case when viewer.role='sme' then viewer.id else target_sme_application_user_id end;
    select * into subject from public.application_users where id=target_sme_application_user_id
      and organization_id=viewer.organization_id and role='sme';
    if not found or subject.wrike_user_id is null then
      raise exception using errcode='42501',message='Survey context is unavailable.';
    end if;
    target_reviewed_wrike_user_id:=subject.wrike_user_id;
  elsif viewer.role not in ('super_admin','admin','id') then
    raise exception using errcode='42501',message='Survey context is unavailable.';
  end if;
  if target_reviewed_wrike_user_id is null or not exists(
    select 1 from public.course_development_person_assignments(viewer.organization_id,'sme') assignment
    where assignment.task_id=target_task_id and assignment.wrike_user_id=target_reviewed_wrike_user_id
  ) then raise exception using errcode='42501',message='Survey context is unavailable.'; end if;
  select * into identity from public.wrike_users where id=target_reviewed_wrike_user_id
    and organization_id=viewer.organization_id and is_active and not is_unresolved and identity_verified;
  if not found then raise exception using errcode='42501',message='Survey context is unavailable.'; end if;
  if requested_type='id_sme_review' then
    select * into subject from public.application_users where organization_id=viewer.organization_id
      and role='sme' and wrike_user_id=identity.id limit 1;
  end if;
  select email into subject_email from auth.users where id=subject.id;
  if requested_type='course_development_debrief' then
    select id into existing_id from public.survey_submissions where organization_id=viewer.organization_id
      and task_id=target_task_id and subject_application_user_id=subject.id and survey_type=requested_type;
  else
    select id into existing_id from public.survey_submissions where organization_id=viewer.organization_id
      and task_id=target_task_id and reviewed_wrike_user_id=identity.id and created_by=viewer.id
      and survey_type=requested_type;
  end if;
  if existing_id is not null then return existing_id; end if;
  insert into public.survey_submissions(organization_id,survey_type,task_id,project_id,task_wrike_id,
    subject_application_user_id,reviewed_wrike_user_id,created_by,last_edited_by,context_snapshot)
  values(viewer.organization_id,requested_type,target_task_id,(context->>'projectId')::uuid,context->>'taskWrikeId',
    subject.id,identity.id,viewer.id,viewer.id,context||jsonb_build_object('subject',jsonb_build_object(
      'applicationUserId',subject.id,'wrikeUserId',identity.id,'name',identity.display_name,'email',
      coalesce(subject_email,identity.email),'createdOnBehalf',
      requested_type='course_development_debrief' and viewer.id is distinct from subject.id)))
  returning id into created_id;
  if requested_type='course_development_debrief' then
    insert into public.course_development_debrief_responses(submission_id,original_due_year)
      values(created_id,(context->>'originalDueYear')::integer);
  else
    insert into public.id_sme_review_responses(submission_id,publication_year,vertical)
      values(created_id,(context->>'publicationYear')::integer,context->>'vertical');
  end if;
  insert into public.survey_audit_log(submission_id,organization_id,event_type,actor_id,actor_role,new_values)
    values(created_id,viewer.organization_id,'draft_created',viewer.id,viewer.role,
      jsonb_build_object('createdOnBehalf',
        requested_type='course_development_debrief' and viewer.id is distinct from subject.id));
  return created_id;
exception when unique_violation then
  if requested_type='course_development_debrief' then
    select id into existing_id from public.survey_submissions where organization_id=viewer.organization_id
      and task_id=target_task_id and subject_application_user_id=subject.id and survey_type=requested_type;
  else
    select id into existing_id from public.survey_submissions where organization_id=viewer.organization_id
      and task_id=target_task_id and reviewed_wrike_user_id=identity.id and created_by=viewer.id
      and survey_type=requested_type;
  end if;
  return existing_id;
end;
$$;

revoke all on function public.set_application_user_wrike_identity(uuid,uuid,uuid,uuid) from public;
revoke all on function public.course_development_person_assignments(uuid,text) from public;
revoke all on function public.course_development_unresolved_person_options(uuid,text) from public;
revoke all on function public.reporting_sme_dashboard_identities() from public;
revoke all on function public.reporting_sme_dashboard_rows(uuid) from public;
revoke all on function public.reporting_current_id_identity() from public;
revoke all on function public.reporting_id_dashboard_identities() from public;
revoke all on function public.reporting_id_dashboard_rows(uuid) from public;
revoke all on function public.survey_browse(jsonb,integer,integer) from public;
revoke all on function public.survey_create_or_resume(uuid,text,uuid,uuid) from public;
grant execute on function public.set_application_user_wrike_identity(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.course_development_person_assignments(uuid,text) to authenticated,service_role;
grant execute on function public.reporting_sme_dashboard_identities(),public.reporting_sme_dashboard_rows(uuid),
  public.reporting_current_id_identity(),public.reporting_id_dashboard_identities(),
  public.reporting_id_dashboard_rows(uuid),public.survey_browse(jsonb,integer,integer),
  public.survey_create_or_resume(uuid,text,uuid,uuid) to authenticated,service_role;

select pg_notify('pgrst','reload schema');
