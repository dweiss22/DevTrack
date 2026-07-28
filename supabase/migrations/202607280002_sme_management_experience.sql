-- Scope-aware SME dashboards, management oversight, and assignment-safe detail.

drop function if exists public.reporting_sme_dashboard_identities();
create function public.reporting_sme_dashboard_identities()
returns table(identity_key text,wrike_user_id uuid,application_user_id uuid,display_name text,email text,
  mapping_status text,identity_status text,selectable boolean)
language plpgsql stable security definer set search_path=public as $$
declare viewer public.application_users%rowtype; own_identity uuid;
begin
  select * into viewer from public.application_users where id=public.current_effective_user_id();
  if not found or not public.current_has_capability('view_sme_dashboard') then
    raise exception using errcode='42501',message='Dashboard is unavailable.';
  end if;
  own_identity:=public.current_operational_identity('sme');
  return query
  with assigned as (
    select distinct assignment.wrike_user_id
    from public.course_development_person_assignments(viewer.organization_id,'sme') assignment
  ), mapped as (
    select persona.application_user_id,persona.wrike_user_id
    from public.application_user_operational_personas persona
    where persona.organization_id=viewer.organization_id and persona.operational_role='sme' and persona.is_active
    union
    select member.id,member.wrike_user_id from public.application_users member
    where member.organization_id=viewer.organization_id and member.role='sme'
      and member.wrike_user_id is not null
  )
  select 'wrike:'||identity.id::text,identity.id,mapped.application_user_id,identity.display_name,identity.email,
    case when mapped.application_user_id is null then 'unmapped' else 'mapped' end,'verified',true
  from assigned
  join public.wrike_users identity on identity.id=assigned.wrike_user_id
  left join mapped on mapped.wrike_user_id=identity.id
  where public.current_has_capability('select_sme_dashboard_user') or identity.id=own_identity
  union all
  select unresolved.identity_key,null::uuid,null::uuid,unresolved.display_name,unresolved.email,
    'unmapped',unresolved.identity_status,false
  from public.course_development_unresolved_person_options(viewer.organization_id,'sme') unresolved
  where public.current_has_capability('select_sme_dashboard_user')
  order by 4;
end;
$$;

drop function if exists public.reporting_sme_dashboard_rows(uuid);
create function public.reporting_sme_dashboard_rows(target_wrike_user_id uuid default null)
returns table(task_id uuid,title text,status_name text,status_color text,status_classification text,reporting_year integer,
  start_date date,original_due_date date,due_date date,completed_at timestamptz,actual_minutes bigint,
  is_overdue boolean,subject_application_user_id uuid,submission_id uuid,survey_status text,
  survey_is_locked boolean,survey_can_edit boolean,is_recent boolean,
  submitted_billable_hours numeric,submitted_amount_billed numeric,submitted_at timestamptz)
language plpgsql stable security definer set search_path=public as $$
declare viewer public.application_users%rowtype; own_identity uuid;
begin
  select * into viewer from public.application_users where id=public.current_effective_user_id();
  if not found or not public.current_has_capability('view_sme_dashboard') then
    raise exception using errcode='42501',message='Dashboard is unavailable.';
  end if;
  own_identity:=public.current_operational_identity('sme');
  if not public.current_has_capability('select_sme_dashboard_user') then target_wrike_user_id:=own_identity; end if;
  if target_wrike_user_id is null or not exists(
    select 1 from public.course_development_person_assignments(viewer.organization_id,'sme') assignment
    where assignment.wrike_user_id=target_wrike_user_id
  ) then return; end if;
  return query
  with mapped as (
    select persona.application_user_id from public.application_user_operational_personas persona
    where persona.organization_id=viewer.organization_id and persona.operational_role='sme'
      and persona.wrike_user_id=target_wrike_user_id and persona.is_active
    union
    select member.id from public.application_users member
    where member.organization_id=viewer.organization_id and member.role='sme'
      and member.wrike_user_id=target_wrike_user_id
    limit 1
  )
  select task.id,task.title,coalesce(status.title,task.status),status.color,
    coalesce(status.dashboard_classification,'unclassified'),reporting.reporting_year,
    task.start_date,task.original_due_date,task.due_date,task.completed_at,
    coalesce((select sum(entry.minutes) from public.wrike_time_entries entry
      where entry.task_id=task.id and not entry.is_deleted),0)::bigint,
    task.completed_at is null and task.due_date<current_date,subject.application_user_id,
    survey.id,survey.status,survey.is_locked,
    case when survey.id is null then false else public.can_edit_survey(survey.id) end,
    case when task.completed_at is not null
      then task.completed_at::date>=current_date-interval '12 months'
      else task.due_date is not null and task.due_date>=current_date-interval '12 months' end,
    case when survey.status='submitted' and response.internal_employee=false then response.billable_hours end,
    case when survey.status='submitted' and response.internal_employee=false then response.amount_billed end,
    case when survey.status='submitted' then survey.latest_submitted_at end
  from public.course_development_person_assignments(viewer.organization_id,'sme') assignment
  join public.wrike_tasks task on task.id=assignment.task_id and not task.is_deleted
  left join public.wrike_workflow_statuses status on status.organization_id=task.organization_id
    and status.wrike_id=task.custom_status_id
  left join mapped subject on true
  left join lateral (
    select value.reporting_year from public.wrike_task_normalized_custom_field_values value
    join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
    where value.task_id=task.id and field.normalized_key in ('reporting','reporting year')
      and not value.has_conflict limit 1
  ) reporting on true
  left join public.survey_submissions survey on survey.organization_id=viewer.organization_id
    and survey.task_id=task.id and survey.survey_type='course_development_debrief'
    and survey.reviewed_wrike_user_id=target_wrike_user_id
  left join public.course_development_debrief_responses response on response.submission_id=survey.id
  where assignment.wrike_user_id=target_wrike_user_id
  order by task.completed_at nulls first,task.due_date nulls last,task.title;
end;
$$;

drop function if exists public.sme_project_detail(uuid);
create function public.sme_project_detail(target_task_id uuid,target_sme_wrike_user_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare viewer public.application_users%rowtype; selected_identity uuid; task public.wrike_tasks%rowtype;
  subject_id uuid; status_name text; status_color text; reporting_year integer; vertical_value text;
  course_length text; legal_reviewer text; assigned_ids jsonb; debrief jsonb; finalized_draft jsonb;
  category_time jsonb;
begin
  select * into viewer from public.application_users where id=public.current_effective_user_id();
  if not found or not public.current_has_capability('view_sme_dashboard') then return null; end if;
  selected_identity:=case when public.current_has_capability('select_sme_dashboard_user')
    then coalesce(target_sme_wrike_user_id,public.current_operational_identity('sme'))
    else public.current_operational_identity('sme') end;
  if selected_identity is null or not exists(
    select 1 from public.course_development_person_assignments(viewer.organization_id,'sme') assignment
    where assignment.task_id=target_task_id and assignment.wrike_user_id=selected_identity
  ) then return null; end if;
  select * into task from public.wrike_tasks where id=target_task_id
    and organization_id=viewer.organization_id and not is_deleted;
  if not found then return null; end if;
  select coalesce(status.title,task.status),status.color into status_name,status_color
    from (select 1) seed left join public.wrike_workflow_statuses status
      on status.organization_id=viewer.organization_id and status.wrike_id=task.custom_status_id;
  select coalesce(
    (select persona.application_user_id from public.application_user_operational_personas persona
      where persona.organization_id=viewer.organization_id and persona.operational_role='sme'
        and persona.wrike_user_id=selected_identity and persona.is_active limit 1),
    (select member.id from public.application_users member where member.organization_id=viewer.organization_id
      and member.role='sme' and member.wrike_user_id=selected_identity limit 1)
  ) into subject_id;
  select value.reporting_year into reporting_year
    from public.wrike_task_normalized_custom_field_values value join public.wrike_normalized_custom_fields field
      on field.id=value.normalized_field_id
    where value.task_id=target_task_id and field.normalized_key in ('reporting','reporting year')
      and not value.has_conflict limit 1;
  select value.vertical_reporting_category into vertical_value
    from public.wrike_task_normalized_custom_field_values value join public.wrike_normalized_custom_fields field
      on field.id=value.normalized_field_id
    where value.task_id=target_task_id and field.normalized_key='vertical'
      and not value.has_conflict and not value.has_unresolved_vertical limit 1;
  select array_to_string(value.display_values,', ') into course_length
    from public.wrike_task_normalized_custom_field_values value join public.wrike_normalized_custom_fields field
      on field.id=value.normalized_field_id
    where value.task_id=target_task_id and field.normalized_key in ('course length','course duration','estimated course length')
      and not value.has_conflict limit 1;
  select array_to_string(value.display_values,', ') into legal_reviewer
    from public.wrike_task_normalized_custom_field_values value join public.wrike_normalized_custom_fields field
      on field.id=value.normalized_field_id
    where value.task_id=target_task_id and field.normalized_key='legal reviewer'
      and not value.has_conflict limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('wrikeUserId',identity.id,'name',identity.display_name)
    order by identity.display_name),'[]'::jsonb) into assigned_ids
    from public.course_development_person_assignments(viewer.organization_id,'id') assignment
    join public.wrike_users identity on identity.id=assignment.wrike_user_id
    where assignment.task_id=target_task_id;
  select jsonb_build_object(
    'id',survey.id,'status',survey.status,'isLocked',survey.is_locked,
    'canEdit',public.can_edit_survey(survey.id),'revisionNumber',survey.revision_number,
    'firstSubmittedAt',survey.first_submitted_at,'latestSubmittedAt',survey.latest_submitted_at,
    'response',jsonb_build_object(
      'internalEmployee',response.internal_employee,
      'billableHours',case when survey.status='submitted' then response.billable_hours end,
      'amountBilled',case when survey.status='submitted' then response.amount_billed end,
      'workStartedOn',response.work_started_on,'workFinishedOn',response.work_finished_on,
      'ratings',jsonb_build_array(response.rating_01,response.rating_02,response.rating_03,response.rating_04,response.rating_05,
        response.rating_06,response.rating_07,response.rating_08,response.rating_09,response.rating_10),
      'comments',response.comments
    ),
    'attachments',coalesce((select jsonb_agg(jsonb_build_object(
      'id',attachment.id,'filename',attachment.original_filename,'sizeBytes',attachment.size_bytes,
      'uploadedAt',attachment.uploaded_at) order by attachment.uploaded_at desc)
      from public.survey_attachments attachment where attachment.submission_id=survey.id and attachment.is_active),'[]'::jsonb)
  ) into debrief
  from public.survey_submissions survey
  join public.course_development_debrief_responses response on response.submission_id=survey.id
  where survey.organization_id=viewer.organization_id and survey.task_id=target_task_id
    and survey.survey_type='course_development_debrief'
    and survey.reviewed_wrike_user_id=selected_identity;
  select coalesce(jsonb_agg(jsonb_build_object('category',grouped.category_name,'minutes',grouped.minutes)
    order by grouped.minutes desc,grouped.category_name),'[]'::jsonb) into category_time
  from (
    select coalesce(category.title,'Uncategorized') category_name,sum(entry.minutes)::bigint minutes
    from public.wrike_time_entries entry
    left join public.wrike_timelog_categories category on category.organization_id=viewer.organization_id
      and category.wrike_id=entry.category
    where entry.task_id=target_task_id and not entry.is_deleted
    group by coalesce(category.title,'Uncategorized')
  ) grouped;
  select jsonb_build_object('available',draft.url is not null,'url',draft.url,'updatedAt',draft.updated_at)
    into finalized_draft from public.project_finalized_course_drafts draft
    where draft.organization_id=viewer.organization_id and draft.task_id=target_task_id;
  return jsonb_build_object(
    'taskId',task.id,'title',task.title,'status',status_name,'statusColor',status_color,
    'reportingYear',reporting_year,'assignedIds',assigned_ids,'vertical',vertical_value,
    'courseLength',course_length,'legalReviewer',legal_reviewer,'debrief',debrief,
    'finalizedDraft',coalesce(finalized_draft,jsonb_build_object('available',false)),
    'timeline',jsonb_build_object('startDate',task.start_date,'originalDueDate',task.original_due_date,
      'dueDate',task.due_date,'completedAt',task.completed_at),
    'categoryTime',category_time,
    'subjectApplicationUserId',subject_id,
    'isRecent',case when task.completed_at is not null
      then task.completed_at::date>=current_date-interval '12 months'
      else task.due_date is not null and task.due_date>=current_date-interval '12 months' end,
    'selectedSmeWrikeUserId',selected_identity
  );
end;
$$;

create or replace function public.sme_management_rows()
returns table(wrike_user_id uuid,application_user_id uuid,display_name text,email text,mapping_status text,
  coordinator boolean,assigned_projects bigint,active_projects bigint,completed_projects bigint,
  stalled_projects bigint,submitted_surveys bigint,billable_hours numeric,invoiced_amount numeric)
language plpgsql stable security definer set search_path=public as $$
declare viewer public.application_users%rowtype;
begin
  select * into viewer from public.application_users where id=public.current_effective_user_id();
  if not found or not public.current_has_capability('manage_smes') then
    raise exception using errcode='42501',message='SME Management is unavailable.';
  end if;
  return query
  with assignments as (
    select assignment.task_id,assignment.wrike_user_id
    from public.course_development_person_assignments(viewer.organization_id,'sme') assignment
  ), identities as (
    select distinct assignment.wrike_user_id from assignments assignment
    union
    select persona.wrike_user_id from public.application_user_operational_personas persona
      where persona.organization_id=viewer.organization_id and persona.operational_role='sme'
        and persona.is_active and persona.wrike_user_id is not null
  ), mapped as (
    select persona.application_user_id,persona.wrike_user_id
    from public.application_user_operational_personas persona
    where persona.organization_id=viewer.organization_id and persona.operational_role='sme' and persona.is_active
    union
    select member.id,member.wrike_user_id from public.application_users member
    where member.organization_id=viewer.organization_id and member.role='sme' and member.wrike_user_id is not null
  )
  select identity.id,mapped.application_user_id,identity.display_name,identity.email,
    case when mapped.application_user_id is null then 'unmapped' else 'mapped' end,
    exists(select 1 from public.application_user_management_roles grant_row
      where grant_row.application_user_id=mapped.application_user_id
        and grant_row.management_role='sme_coordinator' and grant_row.is_active),
    count(distinct assignment.task_id),
    count(distinct assignment.task_id) filter(where status.dashboard_classification='active'),
    count(distinct assignment.task_id) filter(where status.dashboard_classification='completed'),
    count(distinct assignment.task_id) filter(where status.dashboard_classification='stalled_or_canceled'),
    count(distinct survey.id) filter(where survey.status='submitted'),
    coalesce(sum(response.billable_hours) filter(where survey.status='submitted' and response.internal_employee=false),0),
    coalesce(sum(response.amount_billed) filter(where survey.status='submitted' and response.internal_employee=false),0)
  from identities source
  join public.wrike_users identity on identity.id=source.wrike_user_id
  left join mapped on mapped.wrike_user_id=identity.id
  left join assignments assignment on assignment.wrike_user_id=identity.id
  left join public.wrike_tasks task on task.id=assignment.task_id
  left join public.wrike_workflow_statuses status on status.organization_id=viewer.organization_id
    and status.wrike_id=task.custom_status_id
  left join public.survey_submissions survey on survey.organization_id=viewer.organization_id
    and survey.task_id=assignment.task_id and survey.reviewed_wrike_user_id=identity.id
    and survey.survey_type='course_development_debrief'
  left join public.course_development_debrief_responses response on response.submission_id=survey.id
  group by identity.id,mapped.application_user_id,identity.display_name,identity.email;
end;
$$;

revoke all on function public.reporting_sme_dashboard_identities(),public.reporting_sme_dashboard_rows(uuid),
  public.sme_project_detail(uuid,uuid),public.sme_management_rows() from public;
grant execute on function public.reporting_sme_dashboard_identities(),public.reporting_sme_dashboard_rows(uuid),
  public.sme_project_detail(uuid,uuid),public.sme_management_rows() to authenticated,service_role;
