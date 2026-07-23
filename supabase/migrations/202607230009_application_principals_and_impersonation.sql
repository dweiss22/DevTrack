-- Stable historical principals and application-managed administrator impersonation.

create table public.application_user_principals (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  state text not null default 'active' check (state in ('active','deleted')),
  display_name text,
  primary_role_snapshot text not null check (primary_role_snapshot in ('super_admin','admin','id','sme')),
  normalized_email_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(id,organization_id),
  check (
    (state='active' and auth_user_id=id and deleted_at is null)
    or (state='deleted' and auth_user_id is null and display_name is null and deleted_at is not null)
  )
);

insert into public.application_user_principals(
  id,organization_id,auth_user_id,state,display_name,primary_role_snapshot,
  normalized_email_hash,created_at,updated_at
)
select application_user.id,application_user.organization_id,application_user.id,'active',
  application_user.display_name,application_user.role,
  encode(extensions.digest(lower(btrim(coalesce(auth_user.email,''))),'sha256'),'hex'),
  application_user.created_at,coalesce(application_user.updated_at,application_user.created_at)
from public.application_users application_user
join auth.users auth_user on auth_user.id=application_user.id
on conflict (id) do nothing;

alter table public.application_users
  add column if not exists account_state text not null default 'active'
    check (account_state in ('active','deletion_pending'));

create or replace function public.sync_application_user_principal()
returns trigger language plpgsql security definer set search_path=public,auth as $$
declare normalized_hash text;
begin
  if tg_op='DELETE' then
    update public.application_user_principals
    set auth_user_id=null,state='deleted',display_name=null,
      primary_role_snapshot=old.role,deleted_at=coalesce(deleted_at,now()),updated_at=now()
    where id=old.id;
    return old;
  end if;
  select encode(extensions.digest(lower(btrim(coalesce(email,''))),'sha256'),'hex')
    into normalized_hash from auth.users where id=new.id;
  insert into public.application_user_principals(
    id,organization_id,auth_user_id,state,display_name,primary_role_snapshot,
    normalized_email_hash,created_at,updated_at,deleted_at
  ) values (
    new.id,new.organization_id,new.id,'active',new.display_name,new.role,
    normalized_hash,new.created_at,coalesce(new.updated_at,now()),null
  )
  on conflict (id) do update set
    organization_id=excluded.organization_id,auth_user_id=excluded.auth_user_id,
    state='active',display_name=excluded.display_name,
    primary_role_snapshot=excluded.primary_role_snapshot,
    normalized_email_hash=excluded.normalized_email_hash,
    updated_at=excluded.updated_at,deleted_at=null;
  return new;
end;
$$;

drop trigger if exists sync_application_user_principal on public.application_users;
create trigger sync_application_user_principal
after insert or update or delete on public.application_users
for each row execute function public.sync_application_user_principal();

-- Historical records retain the original UUID, but now reference a non-login
-- principal so deleting auth.users/application_users cannot corrupt history.
do $$
declare constraint_row record;
begin
  for constraint_row in
    select conrelid::regclass relation_name,conname
    from pg_constraint
    where contype='f'
      and confrelid='public.application_users'::regclass
      and conrelid in (
        'public.survey_submissions'::regclass,
        'public.survey_attachments'::regclass,
        'public.survey_revisions'::regclass,
        'public.survey_audit_log'::regclass,
        'public.project_finalized_course_drafts'::regclass,
        'public.project_finalized_course_draft_audit'::regclass
      )
      and conname not like '%revision_assignee%'
  loop
    execute format('alter table %s drop constraint %I',constraint_row.relation_name,constraint_row.conname);
  end loop;
end $$;

alter table public.survey_submissions
  add constraint survey_subject_principal_fkey foreign key(subject_application_user_id,organization_id)
    references public.application_user_principals(id,organization_id) on delete restrict,
  add constraint survey_creator_principal_fkey foreign key(created_by,organization_id)
    references public.application_user_principals(id,organization_id) on delete restrict,
  add constraint survey_locked_principal_fkey foreign key(locked_by,organization_id)
    references public.application_user_principals(id,organization_id) on delete set null,
  add constraint survey_unlocked_principal_fkey foreign key(unlocked_by,organization_id)
    references public.application_user_principals(id,organization_id) on delete set null,
  add constraint survey_editor_principal_fkey foreign key(last_edited_by,organization_id)
    references public.application_user_principals(id,organization_id) on delete restrict;
alter table public.survey_attachments
  add constraint survey_attachment_uploader_principal_fkey foreign key(uploaded_by,organization_id)
    references public.application_user_principals(id,organization_id) on delete restrict,
  add constraint survey_attachment_remover_principal_fkey foreign key(removed_by,organization_id)
    references public.application_user_principals(id,organization_id) on delete set null;
alter table public.survey_revisions
  add constraint survey_revision_submitter_principal_fkey foreign key(submitted_by,organization_id)
    references public.application_user_principals(id,organization_id) on delete restrict;
alter table public.survey_audit_log
  add constraint survey_audit_actor_principal_fkey foreign key(actor_id,organization_id)
    references public.application_user_principals(id,organization_id) on delete restrict;
alter table public.project_finalized_course_drafts
  add constraint finalized_draft_creator_principal_fkey foreign key(created_by,organization_id)
    references public.application_user_principals(id,organization_id),
  add constraint finalized_draft_updater_principal_fkey foreign key(updated_by,organization_id)
    references public.application_user_principals(id,organization_id),
  add constraint finalized_draft_remover_principal_fkey foreign key(removed_by,organization_id)
    references public.application_user_principals(id,organization_id);
alter table public.project_finalized_course_draft_audit
  add constraint finalized_draft_audit_actor_principal_fkey foreign key(actor_id,organization_id)
    references public.application_user_principals(id,organization_id);

create table public.administrator_impersonation_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid not null,
  effective_user_id uuid not null,
  actor_auth_session_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  reason text not null check (length(btrim(reason)) between 3 and 1000),
  status text not null default 'active' check (status in ('active','exited','expired','revoked')),
  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  absolute_expires_at timestamptz not null default (now()+interval '60 minutes'),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key(actor_user_id,organization_id)
    references public.application_user_principals(id,organization_id),
  foreign key(effective_user_id,organization_id)
    references public.application_user_principals(id,organization_id),
  check (actor_user_id<>effective_user_id),
  check ((status='active' and ended_at is null) or (status<>'active' and ended_at is not null))
);
create unique index administrator_one_active_impersonation_idx
  on public.administrator_impersonation_sessions(actor_user_id)
  where status='active';
create index administrator_impersonation_expiry_idx
  on public.administrator_impersonation_sessions(status,last_activity_at,absolute_expires_at);

create table public.administrator_impersonation_audit (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid references public.administrator_impersonation_sessions(id) on delete set null,
  event_type text not null check (event_type in ('started','exited','expired','revoked','denied','mutation')),
  actor_user_id uuid not null,
  effective_user_id uuid,
  actor_role text not null check (actor_role in ('super_admin','admin')),
  effective_role text check (effective_role in ('super_admin','admin','id','sme')),
  reason text,
  relation_name text,
  operation text,
  record_identifier text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key(actor_user_id,organization_id)
    references public.application_user_principals(id,organization_id),
  foreign key(effective_user_id,organization_id)
    references public.application_user_principals(id,organization_id)
);
create index administrator_impersonation_audit_actor_idx
  on public.administrator_impersonation_audit(organization_id,actor_user_id,created_at desc);

create or replace function public.guard_append_only_security_audit()
returns trigger language plpgsql set search_path=public as $$
begin
  raise exception using errcode='42501',message='Security audit records are append-only.';
end;
$$;
create trigger administrator_impersonation_audit_append_only
before update or delete on public.administrator_impersonation_audit
for each row execute function public.guard_append_only_security_audit();

create or replace function public.current_actor_user_id()
returns uuid language sql stable security definer set search_path=public as $$
  select application_user.id
  from public.application_users application_user
  where application_user.id=auth.uid() and application_user.account_state='active'
  limit 1;
$$;

create or replace function public.request_impersonation_token()
returns text language plpgsql stable security definer set search_path=public as $$
declare headers jsonb;
begin
  headers:=nullif(current_setting('request.headers',true),'')::jsonb;
  return nullif(headers->>'x-devtrack-impersonation','');
exception when others then return null;
end;
$$;

create or replace function public.current_impersonation_session_id()
returns uuid language sql stable security definer set search_path=public as $$
  select session.id
  from public.administrator_impersonation_sessions session
  join public.application_users actor on actor.id=session.actor_user_id
    and actor.organization_id=session.organization_id and actor.account_state='active'
  join public.application_users effective on effective.id=session.effective_user_id
    and effective.organization_id=session.organization_id and effective.account_state='active'
  where public.request_impersonation_token() is not null
    and session.token_hash=encode(extensions.digest(public.request_impersonation_token(),'sha256'),'hex')
    and session.actor_user_id=auth.uid()
    and session.actor_auth_session_id=nullif(auth.jwt()->>'session_id','')::uuid
    and session.status='active'
    and session.last_activity_at>now()-interval '15 minutes'
    and session.absolute_expires_at>now()
  limit 1;
$$;

create or replace function public.current_effective_user_id()
returns uuid language plpgsql stable security definer set search_path=public as $$
declare token text:=public.request_impersonation_token(); effective_id uuid;
begin
  if token is null then return public.current_actor_user_id(); end if;
  select session.effective_user_id into effective_id
  from public.administrator_impersonation_sessions session
  where session.id=public.current_impersonation_session_id();
  return effective_id;
end;
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
    'absoluteExpiresAt',session.absolute_expires_at
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

create or replace function public.begin_administrator_impersonation(
  target_user_id uuid,impersonation_reason text,target_token_hash text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor public.application_users%rowtype; target public.application_users%rowtype;
  auth_session uuid; created public.administrator_impersonation_sessions%rowtype;
begin
  select * into actor from public.application_users
    where id=auth.uid() and account_state='active';
  auth_session:=nullif(auth.jwt()->>'session_id','')::uuid;
  if actor.id is null or actor.role not in ('super_admin','admin')
    or public.request_impersonation_token() is not null
    or auth_session is null or btrim(coalesce(impersonation_reason,''))=''
    or target_token_hash !~ '^[0-9a-f]{64}$'
  then
    return jsonb_build_object('ok',false);
  end if;
  select * into target from public.application_users
    where id=target_user_id and organization_id=actor.organization_id
      and account_state='active' and profile_completed;
  if target.id is null or target.id=actor.id or target.role='super_admin'
    or (actor.role='admin' and target.role='admin')
  then
    insert into public.administrator_impersonation_audit(
      organization_id,event_type,actor_user_id,actor_role,reason,metadata
    ) values (
      actor.organization_id,'denied',actor.id,actor.role,btrim(impersonation_reason),
      jsonb_build_object('requestedTargetHash',md5(coalesce(target_user_id::text,'')))
    );
    return jsonb_build_object('ok',false);
  end if;
  update public.administrator_impersonation_sessions
    set status='revoked',ended_at=now()
    where actor_user_id=actor.id and status='active';
  insert into public.administrator_impersonation_sessions(
    organization_id,actor_user_id,effective_user_id,actor_auth_session_id,token_hash,reason
  ) values (
    actor.organization_id,actor.id,target.id,auth_session,target_token_hash,btrim(impersonation_reason)
  ) returning * into created;
  insert into public.administrator_impersonation_audit(
    organization_id,session_id,event_type,actor_user_id,effective_user_id,
    actor_role,effective_role,reason
  ) values (
    actor.organization_id,created.id,'started',actor.id,target.id,actor.role,target.role,created.reason
  );
  return jsonb_build_object('ok',true,'sessionId',created.id,'effectiveName',coalesce(target.display_name,'DevTrack user'));
end;
$$;

create or replace function public.touch_administrator_impersonation()
returns jsonb language plpgsql security definer set search_path=public as $$
declare session_id uuid:=public.current_impersonation_session_id(); touched timestamptz;
begin
  if session_id is null then return jsonb_build_object('ok',false); end if;
  update public.administrator_impersonation_sessions
  set last_activity_at=now()
  where id=session_id and last_activity_at<=now()-interval '30 seconds'
  returning last_activity_at into touched;
  if touched is null then
    select last_activity_at into touched
    from public.administrator_impersonation_sessions where id=session_id;
  end if;
  return jsonb_build_object('ok',true,'lastActivityAt',touched);
end;
$$;

create or replace function public.end_administrator_impersonation()
returns jsonb language plpgsql security definer set search_path=public as $$
declare session_row public.administrator_impersonation_sessions%rowtype;
  actor public.application_users%rowtype; event_name text;
begin
  select * into session_row
  from public.administrator_impersonation_sessions
  where token_hash=encode(extensions.digest(coalesce(public.request_impersonation_token(),''),'sha256'),'hex')
    and actor_user_id=auth.uid() and status='active'
  for update;
  if not found then
    select * into actor from public.application_users
      where id=auth.uid() and account_state='active' and role in ('super_admin','admin');
    if actor.id is not null and public.request_impersonation_token() is not null then
      insert into public.administrator_impersonation_audit(
        organization_id,event_type,actor_user_id,actor_role,reason,metadata
      ) values (
        actor.organization_id,'denied',actor.id,actor.role,'Invalid or replayed impersonation token.',
        jsonb_build_object('tokenHashPrefix',left(
          encode(extensions.digest(public.request_impersonation_token(),'sha256'),'hex'),12
        ))
      );
    end if;
    return jsonb_build_object('ok',false);
  end if;
  event_name:=case when session_row.last_activity_at<=now()-interval '15 minutes'
    or session_row.absolute_expires_at<=now() then 'expired' else 'exited' end;
  update public.administrator_impersonation_sessions
  set status=event_name,ended_at=now() where id=session_row.id;
  insert into public.administrator_impersonation_audit(
    organization_id,session_id,event_type,actor_user_id,effective_user_id,
    actor_role,effective_role,reason
  )
  select session_row.organization_id,session_row.id,event_name,session_row.actor_user_id,
    session_row.effective_user_id,actor.role,effective.role,session_row.reason
  from public.application_users actor,public.application_users effective
  where actor.id=session_row.actor_user_id and effective.id=session_row.effective_user_id;
  return jsonb_build_object('ok',true,'event',event_name);
end;
$$;

create or replace function public.audit_impersonated_mutation()
returns trigger language plpgsql security definer set search_path=public as $$
declare session_row public.administrator_impersonation_sessions%rowtype;
  record_json jsonb:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  select * into session_row from public.administrator_impersonation_sessions
    where id=public.current_impersonation_session_id();
  if found then
    insert into public.administrator_impersonation_audit(
      organization_id,session_id,event_type,actor_user_id,effective_user_id,
      actor_role,effective_role,relation_name,operation,record_identifier
    )
    select session_row.organization_id,session_row.id,'mutation',session_row.actor_user_id,
      session_row.effective_user_id,actor.role,effective.role,tg_table_schema||'.'||tg_table_name,
      tg_op,coalesce(record_json->>'id',record_json->>'submission_id',record_json->>'conversation_id')
    from public.application_users actor,public.application_users effective
    where actor.id=session_row.actor_user_id and effective.id=session_row.effective_user_id;
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;

create or replace function public.record_impersonated_external_mutation(
  target_relation_name text,target_operation text,target_record_identifier text
)
returns void language plpgsql security definer set search_path=public as $$
declare session_row public.administrator_impersonation_sessions%rowtype;
begin
  if target_relation_name not in ('public.survey_attachments','storage.objects')
    or upper(target_operation) not in ('INSERT','UPDATE','DELETE') then
    raise exception using errcode='22023',message='External mutation audit is unavailable.';
  end if;
  select * into session_row from public.administrator_impersonation_sessions
    where id=public.current_impersonation_session_id();
  if session_row.id is null then return; end if;
  insert into public.administrator_impersonation_audit(
    organization_id,session_id,event_type,actor_user_id,effective_user_id,
    actor_role,effective_role,relation_name,operation,record_identifier
  )
  select session_row.organization_id,session_row.id,'mutation',session_row.actor_user_id,
    session_row.effective_user_id,actor.role,effective.role,target_relation_name,
    upper(target_operation),target_record_identifier
  from public.application_users actor,public.application_users effective
  where actor.id=session_row.actor_user_id and effective.id=session_row.effective_user_id;
end;
$$;

create or replace function public.update_current_profile(target_display_name text)
returns void language plpgsql security definer set search_path=public as $$
declare effective_id uuid:=public.current_effective_user_id();
begin
  if effective_id is null or length(btrim(coalesce(target_display_name,''))) not between 2 and 100 then
    raise exception using errcode='22023',message='Profile update is unavailable.';
  end if;
  update public.application_users
  set display_name=btrim(target_display_name),updated_at=now()
  where id=effective_id and account_state='active';
  if not found then raise exception using errcode='42501',message='Profile update is unavailable.'; end if;
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'application_users','reporting_conversations','reporting_messages',
    'survey_submissions','course_development_debrief_responses','id_sme_review_responses',
    'survey_attachments','survey_revisions','project_finalized_course_drafts'
  ] loop
    execute format('drop trigger if exists audit_impersonated_mutation on public.%I',table_name);
    execute format(
      'create trigger audit_impersonated_mutation after insert or update or delete on public.%I for each row execute function public.audit_impersonated_mutation()',
      table_name
    );
  end loop;
end $$;

-- Rebuild every currently installed caller-aware function around the effective
-- identity. Actor/session functions above remain deliberately tied to auth.uid().
do $$
declare function_row record; definition text;
begin
  for function_row in
    select procedure.oid,procedure.proname,pg_get_functiondef(procedure.oid) definition
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname='public'
      and procedure.prokind='f'
      and pg_get_functiondef(procedure.oid) like '%auth.uid()%'
      and procedure.proname not in (
        'current_actor_user_id','current_effective_user_id','current_impersonation_session_id',
        'begin_administrator_impersonation','end_administrator_impersonation'
      )
  loop
    definition:=replace(function_row.definition,'auth.uid()','public.current_effective_user_id()');
    execute definition;
  end loop;
end $$;

-- Submitted surveys remain browseable after their creator is offboarded.
do $$
declare function_row record; definition text;
begin
  for function_row in
    select procedure.oid,pg_get_functiondef(procedure.oid) definition
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname='public' and procedure.prokind='f'
      and pg_get_functiondef(procedure.oid)
        like '%join public.application_users creator on creator.id=survey.created_by%'
  loop
    definition:=replace(
      function_row.definition,
      'join public.application_users creator on creator.id=survey.created_by',
      'join public.application_user_principals creator on creator.id=survey.created_by'
    );
    definition:=replace(
      definition,
      'coalesce(creator.display_name,''Unnamed reviewer'')',
      'case when creator.state=''deleted'' then ''Deleted user'' else coalesce(creator.display_name,''Unnamed reviewer'') end'
    );
    execute definition;
  end loop;
end $$;

create or replace function public.current_application_role()
returns text language sql stable security definer set search_path=public as $$
  select role from public.application_users
  where id=public.current_effective_user_id() and account_state='active' limit 1;
$$;
create or replace function public.current_organization_id()
returns uuid language sql stable security definer set search_path=public as $$
  select organization_id from public.application_users
  where id=public.current_effective_user_id() and account_state='active'
    and role in ('super_admin','admin','id') limit 1;
$$;
create or replace function public.is_org_admin()
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.application_users
    where id=public.current_effective_user_id() and account_state='active'
      and role in ('super_admin','admin'));
$$;
create or replace function public.is_org_admin_for(target_organization_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.application_users
    where id=public.current_effective_user_id() and organization_id=target_organization_id
      and account_state='active' and role in ('super_admin','admin'));
$$;

drop policy if exists "organization membership read" on public.application_users;
create policy "organization membership read" on public.application_users for select using (
  account_state='active' and (
    id=public.current_effective_user_id() or (
      organization_id=public.current_organization_id()
      and public.current_application_role() in ('super_admin','admin','id')
    )
  )
);
drop policy if exists "conversation owner or admin read" on public.reporting_conversations;
drop policy if exists "conversation owner insert" on public.reporting_conversations;
drop policy if exists "conversation owner update" on public.reporting_conversations;
drop policy if exists "conversation owner or admin delete" on public.reporting_conversations;
create policy "conversation owner or admin read" on public.reporting_conversations for select using (
  user_id=public.current_effective_user_id() or public.is_org_admin_for(organization_id));
create policy "conversation owner insert" on public.reporting_conversations for insert with check (
  user_id=public.current_effective_user_id() and organization_id=public.current_organization_id());
create policy "conversation owner update" on public.reporting_conversations for update
  using (user_id=public.current_effective_user_id()) with check (user_id=public.current_effective_user_id());
create policy "conversation owner or admin delete" on public.reporting_conversations for delete using (
  user_id=public.current_effective_user_id() or public.is_org_admin_for(organization_id));
drop policy if exists "message owner or admin read" on public.reporting_messages;
drop policy if exists "message owner insert" on public.reporting_messages;
drop policy if exists "message owner or admin delete" on public.reporting_messages;
create policy "message owner or admin read" on public.reporting_messages for select using (
  user_id=public.current_effective_user_id() or public.is_org_admin_for(organization_id));
create policy "message owner insert" on public.reporting_messages for insert with check (
  user_id=public.current_effective_user_id() and organization_id=public.current_organization_id()
  and exists(select 1 from public.reporting_conversations conversation
    where conversation.id=conversation_id and conversation.user_id=public.current_effective_user_id()));
create policy "message owner or admin delete" on public.reporting_messages for delete using (
  user_id=public.current_effective_user_id() or public.is_org_admin_for(organization_id));

alter table public.application_user_principals enable row level security;
alter table public.administrator_impersonation_sessions enable row level security;
alter table public.administrator_impersonation_audit enable row level security;
revoke all on public.application_user_principals from anon,authenticated;
revoke all on public.administrator_impersonation_sessions from anon,authenticated;
revoke all on public.administrator_impersonation_audit from anon,authenticated;
grant all on public.application_user_principals,public.administrator_impersonation_sessions,
  public.administrator_impersonation_audit to service_role;

revoke all on function public.current_actor_user_id() from public;
revoke all on function public.request_impersonation_token() from public;
revoke all on function public.current_impersonation_session_id() from public;
revoke all on function public.current_effective_user_id() from public;
revoke all on function public.current_request_identity() from public;
revoke all on function public.begin_administrator_impersonation(uuid,text,text) from public;
revoke all on function public.touch_administrator_impersonation() from public;
revoke all on function public.end_administrator_impersonation() from public;
revoke all on function public.update_current_profile(text) from public;
revoke all on function public.record_impersonated_external_mutation(text,text,text) from public;
grant execute on function public.current_actor_user_id(),public.request_impersonation_token(),
  public.current_impersonation_session_id(),public.current_effective_user_id(),
  public.current_request_identity(),public.begin_administrator_impersonation(uuid,text,text),
  public.touch_administrator_impersonation(),public.end_administrator_impersonation(),
  public.update_current_profile(text),
  public.record_impersonated_external_mutation(text,text,text)
  to authenticated,service_role;

select pg_notify('pgrst','reload schema');
