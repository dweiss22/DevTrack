-- Secondary, assignment-scoped ID persona for the fixed SuperAdmin.

create table public.application_user_operational_personas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  application_user_id uuid not null,
  operational_role text not null check (operational_role='id'),
  wrike_user_id uuid not null,
  is_active boolean not null default true,
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deactivated_at timestamptz,
  foreign key(application_user_id,organization_id)
    references public.application_users(id,organization_id) on delete cascade,
  foreign key(wrike_user_id,organization_id)
    references public.wrike_users(id,organization_id),
  foreign key(created_by,organization_id)
    references public.application_user_principals(id,organization_id),
  foreign key(updated_by,organization_id)
    references public.application_user_principals(id,organization_id),
  check ((is_active and deactivated_at is null) or (not is_active and deactivated_at is not null))
);
create unique index one_active_operational_role_per_user_idx
  on public.application_user_operational_personas(organization_id,application_user_id,operational_role)
  where is_active;
create unique index one_active_operational_role_per_wrike_identity_idx
  on public.application_user_operational_personas(organization_id,operational_role,wrike_user_id)
  where is_active;

create table public.application_user_operational_persona_audit (
  id bigint generated always as identity primary key,
  persona_id uuid references public.application_user_operational_personas(id) on delete set null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid not null,
  application_user_id uuid not null,
  event_type text not null check (event_type in ('assigned','reassigned','removed')),
  operational_role text not null check (operational_role='id'),
  previous_wrike_user_id uuid,
  new_wrike_user_id uuid,
  created_at timestamptz not null default now(),
  foreign key(actor_user_id,organization_id)
    references public.application_user_principals(id,organization_id),
  foreign key(application_user_id,organization_id)
    references public.application_user_principals(id,organization_id)
);
insert into public.application_user_deletion_manifest(relation_name,column_name,strategy,rationale) values
  ('application_user_operational_personas','application_user_id','delete','Remove operational access during offboarding.'),
  ('application_user_operational_personas','created_by','retain_principal','Retain persona creation attribution.'),
  ('application_user_operational_personas','updated_by','retain_principal','Retain persona update attribution.'),
  ('application_user_operational_persona_audit','actor_user_id','retain_principal','Retain persona administrator attribution.'),
  ('application_user_operational_persona_audit','application_user_id','retain_principal','Retain persona security history.'),
  ('survey_audit_log','authenticated_actor_id','retain_principal','Retain the authenticated actor separately from the effective user.'),
  ('project_finalized_course_draft_audit','authenticated_actor_id','retain_principal','Retain the authenticated actor separately from the effective user.')
on conflict (relation_name,column_name) do nothing;
create trigger application_user_operational_persona_audit_append_only
before update or delete on public.application_user_operational_persona_audit
for each row execute function public.guard_append_only_security_audit();

create or replace function public.current_id_operational_identity()
returns uuid language sql stable security definer set search_path=public as $$
  select case
    when application_user.role='id' then application_user.wrike_user_id
    when application_user.role='super_admin' then persona.wrike_user_id
    else null
  end
  from public.application_users application_user
  left join public.application_user_operational_personas persona
    on persona.application_user_id=application_user.id
    and persona.organization_id=application_user.organization_id
    and persona.operational_role='id' and persona.is_active
  left join public.wrike_users identity
    on identity.id=coalesce(
      case when application_user.role='id' then application_user.wrike_user_id end,
      persona.wrike_user_id
    )
    and identity.organization_id=application_user.organization_id
    and identity.is_active and not identity.is_unresolved and identity.identity_verified
  where application_user.id=public.current_effective_user_id()
    and application_user.account_state='active' and identity.id is not null
  limit 1;
$$;

create or replace function public.current_operational_persona_role()
returns text language sql stable security definer set search_path=public as $$
  select case when application_user.role='super_admin'
    and public.current_id_operational_identity() is not null then 'id' end
  from public.application_users application_user
  where application_user.id=public.current_effective_user_id();
$$;

create or replace function public.current_request_identity()
returns jsonb language sql stable security definer set search_path=public as $$
  select case when actor.id is null or effective.id is null then null else jsonb_build_object(
    'actorUserId',actor.id,'actorRole',actor.role,'actorName',coalesce(actor.display_name,'Administrator'),
    'effectiveUserId',effective.id,'effectiveRole',effective.role,
    'effectiveName',coalesce(effective.display_name,'DevTrack user'),
    'effectiveEmail',effective_auth.email,
    'organizationId',effective.organization_id,
    'impersonationSessionId',session.id,
    'impersonating',session.id is not null,
    'lastActivityAt',session.last_activity_at,
    'absoluteExpiresAt',session.absolute_expires_at,
    'operationalPersonaRole',public.current_operational_persona_role()
  ) end
  from public.application_users actor
  join public.application_users effective
    on effective.id=public.current_effective_user_id() and effective.account_state='active'
  left join auth.users effective_auth on effective_auth.id=effective.id
  left join public.administrator_impersonation_sessions session
    on session.id=public.current_impersonation_session_id()
  where actor.id=public.current_actor_user_id()
    and actor.organization_id=effective.organization_id;
$$;

create or replace function public.set_superadmin_id_persona(target_wrike_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare actor public.application_users%rowtype; target_email text;
  existing public.application_user_operational_personas%rowtype;
  saved public.application_user_operational_personas%rowtype;
begin
  select * into actor from public.application_users
    where id=public.current_actor_user_id() and account_state='active';
  select lower(btrim(email)) into target_email from auth.users where id=actor.id;
  if public.current_impersonation_session_id() is not null or actor.role<>'super_admin'
    or target_email<>'dweiss@lexipol.com' then return jsonb_build_object('ok',false); end if;
  if not exists(select 1 from public.wrike_users
    where id=target_wrike_user_id and organization_id=actor.organization_id
      and is_active and not is_unresolved and identity_verified) then
    return jsonb_build_object('ok',false);
  end if;
  if exists(select 1 from public.application_users
    where organization_id=actor.organization_id and role='id'
      and wrike_user_id=target_wrike_user_id and id<>actor.id) then
    return jsonb_build_object('ok',false);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor.organization_id::text||':id-persona',0));
  select * into existing from public.application_user_operational_personas
    where organization_id=actor.organization_id and application_user_id=actor.id
      and operational_role='id' and is_active for update;
  if existing.id is not null and existing.wrike_user_id=target_wrike_user_id then
    return jsonb_build_object('ok',true,'id',existing.id,'idempotent',true);
  end if;
  if existing.id is not null then
    update public.application_user_operational_personas
    set is_active=false,deactivated_at=now(),updated_at=now(),updated_by=actor.id
    where id=existing.id;
  end if;
  insert into public.application_user_operational_personas(
    organization_id,application_user_id,operational_role,wrike_user_id,created_by,updated_by
  ) values (actor.organization_id,actor.id,'id',target_wrike_user_id,actor.id,actor.id)
  returning * into saved;
  insert into public.application_user_operational_persona_audit(
    persona_id,organization_id,actor_user_id,application_user_id,event_type,
    operational_role,previous_wrike_user_id,new_wrike_user_id
  ) values (
    saved.id,actor.organization_id,actor.id,actor.id,
    case when existing.id is null then 'assigned' else 'reassigned' end,
    'id',existing.wrike_user_id,target_wrike_user_id
  );
  return jsonb_build_object('ok',true,'id',saved.id,'idempotent',false);
exception when unique_violation then return jsonb_build_object('ok',false);
end;
$$;

create or replace function public.remove_superadmin_id_persona()
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare actor public.application_users%rowtype; target_email text;
  existing public.application_user_operational_personas%rowtype;
begin
  select * into actor from public.application_users
    where id=public.current_actor_user_id() and account_state='active';
  select lower(btrim(email)) into target_email from auth.users where id=actor.id;
  if public.current_impersonation_session_id() is not null or actor.role<>'super_admin'
    or target_email<>'dweiss@lexipol.com' then return jsonb_build_object('ok',false); end if;
  select * into existing from public.application_user_operational_personas
    where organization_id=actor.organization_id and application_user_id=actor.id
      and operational_role='id' and is_active for update;
  if existing.id is null then return jsonb_build_object('ok',true,'idempotent',true); end if;
  update public.application_user_operational_personas
  set is_active=false,deactivated_at=now(),updated_at=now(),updated_by=actor.id
  where id=existing.id;
  insert into public.application_user_operational_persona_audit(
    persona_id,organization_id,actor_user_id,application_user_id,event_type,
    operational_role,previous_wrike_user_id
  ) values (existing.id,actor.organization_id,actor.id,actor.id,'removed','id',existing.wrike_user_id);
  return jsonb_build_object('ok',true,'idempotent',false);
end;
$$;

create or replace function public.superadmin_id_persona()
returns table(wrike_user_id uuid,display_name text,email text,is_active boolean)
language sql stable security definer set search_path=public as $$
  select persona.wrike_user_id,identity.display_name,identity.email,
    persona.is_active and identity.is_active and not identity.is_unresolved and identity.identity_verified
  from public.application_user_operational_personas persona
  join public.application_users actor on actor.id=public.current_actor_user_id()
    and actor.id=persona.application_user_id and actor.organization_id=persona.organization_id
    and actor.role='super_admin'
  join public.wrike_users identity on identity.id=persona.wrike_user_id
  where persona.operational_role='id' and persona.is_active
  limit 1;
$$;

-- Preserve the established trusted-field assignment resolver and add only the
-- persona-backed mapped-assignee fallback when no ID role field is present.
create or replace function public.course_development_person_assignments_with_personas(
  target_organization_id uuid,target_role text
)
returns table(task_id uuid,wrike_user_id uuid,assignment_source text)
language sql stable security definer set search_path=public as $$
  select assignment.task_id,assignment.wrike_user_id,assignment.assignment_source
  from public.course_development_person_assignments(target_organization_id,target_role) assignment
  union
  select task.id,persona.wrike_user_id,'operational_persona_assignee'::text
  from public.wrike_tasks task
  join public.application_user_operational_personas persona
    on persona.organization_id=task.organization_id and persona.operational_role='id'
    and persona.is_active and target_role='id'
  join public.wrike_users identity on identity.id=persona.wrike_user_id
    and identity.is_active and not identity.is_unresolved and identity.identity_verified
  join public.wrike_task_assignees assignee
    on assignee.task_id=task.id and assignee.user_id=persona.wrike_user_id
  where task.organization_id=target_organization_id and not task.is_deleted
    and (task.workflow_id='IEACHQK7K4BHMLHM' or exists(
      select 1 from public.wrike_workflow_statuses status
      where status.organization_id=task.organization_id
        and status.wrike_id=task.custom_status_id
        and status.workflow_id='IEACHQK7K4BHMLHM' and not status.is_unresolved
    ))
    and not exists(
      select 1
      from public.wrike_task_normalized_custom_field_values value
      join public.wrike_normalized_custom_fields field on field.id=value.normalized_field_id
      where value.task_id=task.id and cardinality(value.display_values)>0
        and field.normalized_key in (
          'instructional designer','course owner','project owner','owner','id','id assigned'
        )
    );
$$;

-- Point installed dashboard/survey/project functions at the augmented resolver.
do $$
declare function_row record; definition text;
begin
  for function_row in
    select procedure.oid,procedure.proname,pg_get_functiondef(procedure.oid) definition
    from pg_proc procedure join pg_namespace namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname='public' and procedure.prokind='f'
      and pg_get_functiondef(procedure.oid) like '%public.course_development_person_assignments(%'
      and procedure.proname not in (
        'course_development_person_assignments','course_development_person_assignments_with_personas'
      )
  loop
    definition:=replace(function_row.definition,
      'public.course_development_person_assignments(',
      'public.course_development_person_assignments_with_personas(');
    execute definition;
  end loop;
end $$;

create or replace function public.can_act_as_assigned_id(target_task_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1
    from public.application_users viewer
    join public.course_development_person_assignments_with_personas(
      viewer.organization_id,'id'
    ) assignment on assignment.task_id=target_task_id
      and assignment.wrike_user_id=public.current_id_operational_identity()
    where viewer.id=public.current_effective_user_id()
      and viewer.account_state='active'
      and public.current_id_operational_identity() is not null
  );
$$;

-- Wrap survey creation so Admin dashboard selection can never create review
-- credit. Primary IDs and the fixed SuperAdmin persona remain assignment-bound.
alter function public.survey_create_or_resume(uuid,text,uuid,uuid)
  rename to survey_create_or_resume_without_operational_guard;
create or replace function public.survey_create_or_resume(
  target_task_id uuid,requested_type text,target_sme_application_user_id uuid default null,
  target_reviewed_wrike_user_id uuid default null
) returns uuid language plpgsql security definer set search_path=public as $$
begin
  if requested_type='id_sme_review' and not public.can_act_as_assigned_id(target_task_id) then
    raise exception using errcode='42501',message='Survey context is unavailable.';
  end if;
  return public.survey_create_or_resume_without_operational_guard(
    target_task_id,requested_type,target_sme_application_user_id,target_reviewed_wrike_user_id
  );
end;
$$;
revoke all on function public.survey_create_or_resume_without_operational_guard(uuid,text,uuid,uuid) from public;
revoke all on function public.survey_create_or_resume_without_operational_guard(uuid,text,uuid,uuid) from anon,authenticated;

-- Finalized-draft mutations are similarly limited to the current operational ID.
do $$
declare function_name text; function_oid oid; definition text;
begin
  foreach function_name in array array[
    'save_project_finalized_course_draft','remove_project_finalized_course_draft',
    'assigned_id_project_controls'
  ] loop
    select procedure.oid into function_oid
    from pg_proc procedure join pg_namespace namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname='public' and procedure.proname=function_name
    order by procedure.oid desc limit 1;
    definition:=pg_get_functiondef(function_oid);
    definition:=replace(definition,
      'viewer.role<>''id'' or viewer.wrike_user_id is null',
      'public.current_id_operational_identity() is null');
    definition:=replace(definition,'viewer.wrike_user_id','public.current_id_operational_identity()');
    execute definition;
  end loop;
end $$;

create or replace function public.reporting_current_id_identity()
returns table(wrike_user_id uuid,display_name text,email text,mapping_status text)
language sql stable security definer set search_path=public as $$
  select identity.id,identity.display_name,identity.email,
    case when identity.id is null then 'missing' else 'mapped' end
  from public.application_users member
  left join public.wrike_users identity
    on identity.id=public.current_id_operational_identity()
    and identity.organization_id=member.organization_id and identity.is_active
    and not identity.is_unresolved and identity.identity_verified
  where member.id=public.current_effective_user_id()
    and member.role in ('id','super_admin');
$$;

alter table public.survey_audit_log
  add column if not exists authenticated_actor_id uuid,
  add column if not exists operational_persona_role text check (operational_persona_role in ('id') or operational_persona_role is null);
update public.survey_audit_log set authenticated_actor_id=actor_id where authenticated_actor_id is null;
alter table public.survey_audit_log
  add constraint survey_audit_authenticated_actor_principal_fkey
  foreign key(authenticated_actor_id,organization_id)
  references public.application_user_principals(id,organization_id);
alter table public.project_finalized_course_draft_audit
  add column if not exists authenticated_actor_id uuid,
  add column if not exists operational_persona_role text check (operational_persona_role in ('id') or operational_persona_role is null);
update public.project_finalized_course_draft_audit set authenticated_actor_id=actor_id
  where authenticated_actor_id is null;
alter table public.project_finalized_course_draft_audit
  add constraint finalized_audit_authenticated_actor_principal_fkey
  foreign key(authenticated_actor_id,organization_id)
  references public.application_user_principals(id,organization_id);

create or replace function public.populate_request_actor_audit_context()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  new.authenticated_actor_id:=coalesce(new.authenticated_actor_id,public.current_actor_user_id(),new.actor_id);
  new.operational_persona_role:=coalesce(new.operational_persona_role,public.current_operational_persona_role());
  return new;
end;
$$;
create trigger populate_survey_actor_audit_context
before insert on public.survey_audit_log for each row
execute function public.populate_request_actor_audit_context();
create trigger populate_finalized_actor_audit_context
before insert on public.project_finalized_course_draft_audit for each row
execute function public.populate_request_actor_audit_context();

alter table public.application_user_operational_personas enable row level security;
alter table public.application_user_operational_persona_audit enable row level security;
revoke all on public.application_user_operational_personas,
  public.application_user_operational_persona_audit from anon,authenticated;
grant all on public.application_user_operational_personas,
  public.application_user_operational_persona_audit to service_role;
revoke all on function public.current_id_operational_identity() from public;
revoke all on function public.current_operational_persona_role() from public;
revoke all on function public.set_superadmin_id_persona(uuid) from public;
revoke all on function public.remove_superadmin_id_persona() from public;
revoke all on function public.superadmin_id_persona() from public;
revoke all on function public.course_development_person_assignments_with_personas(uuid,text) from public;
revoke all on function public.can_act_as_assigned_id(uuid) from public;
revoke all on function public.survey_create_or_resume(uuid,text,uuid,uuid) from public;
grant execute on function public.current_id_operational_identity(),
  public.current_operational_persona_role(),public.set_superadmin_id_persona(uuid),
  public.remove_superadmin_id_persona(),public.superadmin_id_persona(),
  public.course_development_person_assignments_with_personas(uuid,text),
  public.can_act_as_assigned_id(uuid),public.survey_create_or_resume(uuid,text,uuid,uuid)
  to authenticated,service_role;

select public.assert_application_user_deletion_manifest_complete();

select pg_notify('pgrst','reload schema');
