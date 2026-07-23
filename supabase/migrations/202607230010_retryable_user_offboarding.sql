-- Retryable administrator-controlled user offboarding.

create table public.administrator_user_deletions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid not null,
  target_user_id uuid not null,
  target_role text not null check (target_role in ('admin','id','sme')),
  normalized_email_hash text not null check (normalized_email_hash ~ '^[0-9a-f]{64}$'),
  reason text not null check (length(btrim(reason)) between 3 and 2000),
  stage text not null default 'requested' check (
    stage in ('requested','access_revoked','storage_cleaned','database_cleaned','auth_deleted','finalized','failed')
  ),
  resume_stage text check (
    resume_stage in ('requested','access_revoked','storage_cleaned','database_cleaned','auth_deleted')
  ),
  attempts integer not null default 0 check (attempts>=0),
  last_error text,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key(actor_user_id,organization_id)
    references public.application_user_principals(id,organization_id),
  foreign key(target_user_id,organization_id)
    references public.application_user_principals(id,organization_id),
  check ((stage='finalized' and completed_at is not null) or (stage<>'finalized' and completed_at is null))
);
create unique index administrator_one_open_user_deletion_idx
  on public.administrator_user_deletions(target_user_id)
  where stage<>'finalized';
create index administrator_user_deletions_actor_idx
  on public.administrator_user_deletions(organization_id,actor_user_id,updated_at desc);

create or replace function public.block_invitation_during_user_deletion()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if exists(
    select 1 from public.administrator_user_deletions deletion
    where deletion.organization_id=new.organization_id
      and deletion.normalized_email_hash=encode(
        digest(lower(btrim(coalesce(new.normalized_email,new.email))),'sha256'),'hex'
      )
      and deletion.stage<>'finalized'
  ) then
    raise exception using errcode='23505',
      message='This email has an unfinished deletion and cannot be invited yet.';
  end if;
  return new;
end;
$$;
create trigger block_invitation_during_user_deletion
before insert or update of normalized_email,email,status
on public.application_user_invitations for each row
execute function public.block_invitation_during_user_deletion();

create table public.administrator_user_deletion_audit (
  id bigint generated always as identity primary key,
  deletion_id uuid not null references public.administrator_user_deletions(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid not null,
  target_user_id uuid not null,
  event_type text not null check (event_type in ('started','stage_completed','stage_failed','finalized')),
  stage text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key(actor_user_id,organization_id)
    references public.application_user_principals(id,organization_id),
  foreign key(target_user_id,organization_id)
    references public.application_user_principals(id,organization_id)
);
create trigger administrator_user_deletion_audit_append_only
before update or delete on public.administrator_user_deletion_audit
for each row execute function public.guard_append_only_security_audit();

create table public.application_user_deletion_manifest (
  relation_name text not null,
  column_name text not null,
  strategy text not null check (strategy in ('delete','retain_principal','clear','shared_preserve')),
  rationale text not null,
  primary key(relation_name,column_name)
);
insert into public.application_user_deletion_manifest(relation_name,column_name,strategy,rationale) values
  ('application_users','id','delete','Remove membership, profile, role, mapping, and setup state.'),
  ('application_user_invitations','auth_user_id','delete','Delete every invitation for the normalized email.'),
  ('application_user_invitations','invited_by','clear','Preserve invitation history without an active-user dependency.'),
  ('reporting_group_members','application_user_id','delete','Remove access assignments.'),
  ('reporting_conversations','user_id','delete','Delete private conversations and cascading messages.'),
  ('reporting_messages','user_id','delete','Deleted with the owning conversation.'),
  ('survey_submissions','subject_application_user_id','retain_principal','Retain submitted debrief subject history.'),
  ('survey_submissions','created_by','retain_principal','Retain submitted authorship.'),
  ('survey_submissions','last_edited_by','retain_principal','Retain submitted edit history.'),
  ('survey_submissions','locked_by','retain_principal','Retain submitted lock attribution.'),
  ('survey_submissions','unlocked_by','retain_principal','Retain revision authorization history.'),
  ('survey_submissions','revision_assignee_id','clear','Remove active revision access.'),
  ('survey_attachments','uploaded_by','retain_principal','Retain submitted attachment provenance.'),
  ('survey_attachments','removed_by','retain_principal','Retain attachment removal provenance.'),
  ('survey_revisions','submitted_by','retain_principal','Retain immutable submission history.'),
  ('survey_audit_log','actor_id','retain_principal','Retain immutable survey audit history.'),
  ('project_finalized_course_drafts','created_by','retain_principal','Preserve shared project business data.'),
  ('project_finalized_course_drafts','updated_by','retain_principal','Preserve shared project business data.'),
  ('project_finalized_course_drafts','removed_by','retain_principal','Preserve shared project business data.'),
  ('project_finalized_course_draft_audit','actor_id','retain_principal','Preserve project audit history.'),
  ('administrator_impersonation_sessions','actor_user_id','retain_principal','Retain the authenticated administrator security trail.'),
  ('administrator_impersonation_sessions','effective_user_id','retain_principal','Retain the impersonated identity security trail.'),
  ('administrator_impersonation_audit','actor_user_id','retain_principal','Retain the authenticated administrator security trail.'),
  ('administrator_impersonation_audit','effective_user_id','retain_principal','Retain the effective-user security trail.'),
  ('administrator_user_deletions','actor_user_id','retain_principal','Retain the administrator offboarding trail.'),
  ('administrator_user_deletions','target_user_id','retain_principal','Retain the deleted-user offboarding trail.'),
  ('administrator_user_deletion_audit','actor_user_id','retain_principal','Retain the administrator offboarding audit.'),
  ('administrator_user_deletion_audit','target_user_id','retain_principal','Retain the deleted-user offboarding audit.'),
  ('wrike_connections','connected_by','clear','Preserve the organization connection without personal attribution.'),
  ('wrike_sync_scopes','created_by','clear','Preserve shared synchronization configuration.'),
  ('wrike_enabled_custom_fields','enabled_by','clear','Preserve shared field configuration.'),
  ('reporting_groups','created_by','clear','Preserve shared reporting configuration.'),
  ('wrike_workflow_statuses','classification_updated_by','clear','Preserve shared classification.'),
  ('wrike_manual_mappings','created_by','clear','Preserve shared normalization mapping.'),
  ('wrike_manual_mappings','updated_by','clear','Preserve shared normalization mapping.');

create or replace function public.assert_application_user_deletion_manifest_complete()
returns void language plpgsql security definer set search_path=public as $$
declare unclassified_reference text;
begin
  select string_agg(reference.relation_name||'.'||reference.column_name,', ' order by reference.relation_name,reference.column_name)
    into unclassified_reference
  from (
    select source_namespace.nspname||'.'||source_table.relname relation_qualified_name,
      source_table.relname relation_name,source_column.attname column_name
    from pg_constraint constraint_row
    join pg_class source_table on source_table.oid=constraint_row.conrelid
    join pg_namespace source_namespace on source_namespace.oid=source_table.relnamespace
    join pg_class target_table on target_table.oid=constraint_row.confrelid
    cross join lateral unnest(constraint_row.conkey,constraint_row.confkey)
      with ordinality as key_columns(source_number,target_number,position)
    join pg_attribute source_column on source_column.attrelid=source_table.oid
      and source_column.attnum=key_columns.source_number
    join pg_attribute target_column on target_column.attrelid=target_table.oid
      and target_column.attnum=key_columns.target_number
    where constraint_row.contype='f' and source_namespace.nspname='public'
      and target_table.relname in ('application_users','application_user_principals')
      and target_column.attname='id'
  ) reference
  where not exists(
    select 1 from public.application_user_deletion_manifest manifest
    where manifest.relation_name=reference.relation_name
      and manifest.column_name=reference.column_name
  );
  if unclassified_reference is not null then
    raise exception 'Unclassified application-user foreign key(s): %',unclassified_reference;
  end if;
end;
$$;

create or replace function public.user_deletion_preview(target_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,auth as $$
declare actor public.application_users%rowtype; target public.application_users%rowtype;
  normalized_target_email text;
begin
  select * into actor from public.application_users
    where id=public.current_actor_user_id() and account_state='active';
  if public.current_impersonation_session_id() is not null or actor.role not in ('super_admin','admin')
    then return null; end if;
  select * into target from public.application_users
    where id=target_user_id and organization_id=actor.organization_id and account_state='active';
  if target.id is null or target.id=actor.id or target.role='super_admin'
    or (actor.role='admin' and target.role='admin') then return null; end if;
  select lower(btrim(email)) into normalized_target_email from auth.users where id=target.id;
  return jsonb_build_object(
    'targetUserId',target.id,'displayName',coalesce(target.display_name,'DevTrack user'),
    'email',normalized_target_email,'role',target.role,
    'delete',jsonb_build_object(
      'conversations',(select count(*) from public.reporting_conversations where user_id=target.id),
      'reportingMemberships',(select count(*) from public.reporting_group_members where application_user_id=target.id),
      'invitations',(select count(*) from public.application_user_invitations invitation
        where invitation.normalized_email=normalized_target_email),
      'draftSurveys',(select count(*) from public.survey_submissions survey where survey.status='draft'
        and (survey.created_by=target.id or (survey.survey_type='course_development_debrief'
          and survey.subject_application_user_id=target.id))),
      'draftAttachments',(select count(*) from public.survey_attachments attachment
        join public.survey_submissions survey on survey.id=attachment.submission_id
        where survey.status='draft' and (survey.created_by=target.id
          or (survey.survey_type='course_development_debrief' and survey.subject_application_user_id=target.id)))
    ),
    'retain',jsonb_build_object(
      'submittedSurveys',(select count(*) from public.survey_submissions survey where survey.status='submitted'
        and (survey.created_by=target.id or survey.subject_application_user_id=target.id
          or survey.last_edited_by=target.id)),
      'surveyRevisions',(select count(*) from public.survey_revisions where submitted_by=target.id),
      'surveyAuditEvents',(select count(*) from public.survey_audit_log where actor_id=target.id),
      'historicalLabel','Deleted user'
    )
  );
end;
$$;

create or replace function public.begin_user_deletion(
  target_user_id uuid,deletion_reason text,confirmation_email text
)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare actor public.application_users%rowtype; target public.application_users%rowtype;
  normalized_email text; existing public.administrator_user_deletions%rowtype;
  created public.administrator_user_deletions%rowtype;
begin
  select * into actor from public.application_users
    where id=public.current_actor_user_id() and account_state='active';
  if public.current_impersonation_session_id() is not null or actor.role not in ('super_admin','admin')
    or length(btrim(coalesce(deletion_reason,'')))<3 then return jsonb_build_object('ok',false); end if;
  select * into target from public.application_users
    where id=target_user_id and organization_id=actor.organization_id
      and account_state in ('active','deletion_pending') for update;
  if target.id is null or target.id=actor.id or target.role='super_admin'
    or (actor.role='admin' and target.role='admin') then return jsonb_build_object('ok',false); end if;
  select lower(btrim(email)) into normalized_email from auth.users where id=target.id;
  if normalized_email is null or lower(btrim(coalesce(confirmation_email,'')))<>normalized_email
    then return jsonb_build_object('ok',false); end if;
  select * into existing from public.administrator_user_deletions
    where target_user_id=target.id and stage<>'finalized' order by started_at desc limit 1;
  if found then return jsonb_build_object('ok',true,'id',existing.id,'stage',existing.stage,'idempotent',true); end if;
  insert into public.administrator_user_deletions(
    organization_id,actor_user_id,target_user_id,target_role,normalized_email_hash,reason
  ) values (
    actor.organization_id,actor.id,target.id,target.role,
    encode(digest(normalized_email,'sha256'),'hex'),btrim(deletion_reason)
  ) returning * into created;
  update public.application_users set account_state='deletion_pending',updated_at=now() where id=target.id;
  update public.administrator_impersonation_sessions
    set status='revoked',ended_at=now()
    where status='active' and (actor_user_id=target.id or effective_user_id=target.id);
  insert into public.administrator_user_deletion_audit(
    deletion_id,organization_id,actor_user_id,target_user_id,event_type,stage
  ) values (created.id,created.organization_id,created.actor_user_id,created.target_user_id,'started','requested');
  return jsonb_build_object('ok',true,'id',created.id,'stage',created.stage,'idempotent',false);
end;
$$;

create or replace function public.user_deletion_status(target_deletion_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'id',deletion.id,'targetUserId',deletion.target_user_id,'stage',deletion.stage,
    'resumeStage',deletion.resume_stage,'attempts',deletion.attempts,
    'lastError',deletion.last_error,'startedAt',deletion.started_at,
    'updatedAt',deletion.updated_at,'completedAt',deletion.completed_at
  )
  from public.administrator_user_deletions deletion
  join public.application_users actor on actor.id=public.current_actor_user_id()
    and actor.organization_id=deletion.organization_id and actor.role in ('super_admin','admin')
  where deletion.id=target_deletion_id and (
    deletion.actor_user_id=actor.id or actor.role='super_admin'
  );
$$;

create or replace function public.user_deletion_storage_objects(target_deletion_id uuid)
returns table(attachment_id uuid,object_key text)
language sql stable security definer set search_path=public as $$
  select attachment.id,attachment.object_key
  from public.administrator_user_deletions deletion
  join public.application_users actor on actor.id=public.current_actor_user_id()
    and actor.organization_id=deletion.organization_id and actor.role in ('super_admin','admin')
  join public.survey_attachments attachment on attachment.organization_id=deletion.organization_id
  join public.survey_submissions survey on survey.id=attachment.submission_id
  where deletion.id=target_deletion_id and (
    (survey.status='draft' and (
      survey.created_by=deletion.target_user_id
      or (survey.survey_type='course_development_debrief'
        and survey.subject_application_user_id=deletion.target_user_id)
    ))
    or (
      survey.status='submitted' and not survey.is_locked
      and attachment.uploaded_by=deletion.target_user_id
      and not exists(
        select 1 from public.survey_revisions revision
        cross join lateral jsonb_array_elements(revision.attachment_snapshot) item
        where revision.submission_id=survey.id and item->>'id'=attachment.id::text
      )
    )
  );
$$;

create or replace function public.mark_user_deletion_stage(
  target_deletion_id uuid,expected_stage text,next_stage text,failure_message text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor public.application_users%rowtype; deletion public.administrator_user_deletions%rowtype;
  effective_expected text;
begin
  select * into actor from public.application_users
    where id=public.current_actor_user_id() and account_state='active';
  select * into deletion from public.administrator_user_deletions
    where id=target_deletion_id and organization_id=actor.organization_id for update;
  if deletion.id is null or actor.role not in ('super_admin','admin')
    or (deletion.actor_user_id<>actor.id and actor.role<>'super_admin') then return null; end if;
  effective_expected:=case when deletion.stage='failed' then deletion.resume_stage else deletion.stage end;
  if effective_expected<>expected_stage then
    return public.user_deletion_status(deletion.id);
  end if;
  if failure_message is not null then
    update public.administrator_user_deletions set stage='failed',resume_stage=expected_stage,
      attempts=attempts+1,last_error=left(failure_message,2000),updated_at=now()
    where id=deletion.id;
    insert into public.administrator_user_deletion_audit(
      deletion_id,organization_id,actor_user_id,target_user_id,event_type,stage,details
    ) values (deletion.id,deletion.organization_id,actor.id,deletion.target_user_id,
      'stage_failed',expected_stage,jsonb_build_object('error',left(failure_message,2000)));
  else
    update public.administrator_user_deletions set stage=next_stage,resume_stage=null,
      attempts=attempts+1,last_error=null,updated_at=now(),
      completed_at=case when next_stage='finalized' then now() else null end
    where id=deletion.id;
    insert into public.administrator_user_deletion_audit(
      deletion_id,organization_id,actor_user_id,target_user_id,event_type,stage
    ) values (deletion.id,deletion.organization_id,actor.id,deletion.target_user_id,
      case when next_stage='finalized' then 'finalized' else 'stage_completed' end,next_stage);
  end if;
  return public.user_deletion_status(deletion.id);
end;
$$;

create or replace function public.cleanup_user_deletion_database(target_deletion_id uuid)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare actor public.application_users%rowtype; deletion public.administrator_user_deletions%rowtype;
  target_normalized_email text; survey_row record;
begin
  select * into actor from public.application_users
    where id=public.current_actor_user_id() and account_state='active';
  select * into deletion from public.administrator_user_deletions
    where id=target_deletion_id and organization_id=actor.organization_id for update;
  if deletion.id is null or actor.role not in ('super_admin','admin')
    or (deletion.actor_user_id<>actor.id and actor.role<>'super_admin')
    or (case when deletion.stage='failed' then deletion.resume_stage else deletion.stage end)<>'storage_cleaned'
  then return null; end if;
  select lower(btrim(email)) into target_normalized_email from auth.users where id=deletion.target_user_id;

  for survey_row in
    select id from public.survey_submissions
    where status='submitted' and not is_locked and (
      created_by=deletion.target_user_id or subject_application_user_id=deletion.target_user_id
      or last_edited_by=deletion.target_user_id or revision_assignee_id=deletion.target_user_id
    )
  loop
    perform public.survey_relock(survey_row.id);
  end loop;

  delete from public.survey_attachments attachment
  using public.survey_submissions survey
  where attachment.submission_id=survey.id and survey.status='submitted'
    and attachment.uploaded_by=deletion.target_user_id
    and not exists(
      select 1 from public.survey_revisions revision
      cross join lateral jsonb_array_elements(revision.attachment_snapshot) item
      where revision.submission_id=survey.id and item->>'id'=attachment.id::text
    );
  delete from public.survey_submissions survey
    where survey.status='draft' and (
      survey.created_by=deletion.target_user_id
      or (survey.survey_type='course_development_debrief'
        and survey.subject_application_user_id=deletion.target_user_id)
    );
  update public.survey_submissions set revision_assignee_id=null
    where revision_assignee_id=deletion.target_user_id;
  delete from public.reporting_conversations where user_id=deletion.target_user_id;
  delete from public.reporting_group_members where application_user_id=deletion.target_user_id;
  if target_normalized_email is not null then
    delete from public.application_user_invitations invitation
    where invitation.organization_id=deletion.organization_id
      and invitation.normalized_email=target_normalized_email;
  end if;
  if to_regclass('public.application_user_operational_personas') is not null then
    execute 'delete from public.application_user_operational_personas where application_user_id=$1'
      using deletion.target_user_id;
  end if;
  delete from public.application_users where id=deletion.target_user_id;
  return public.mark_user_deletion_stage(deletion.id,'storage_cleaned','database_cleaned',null);
end;
$$;

alter table public.administrator_user_deletions enable row level security;
alter table public.administrator_user_deletion_audit enable row level security;
alter table public.application_user_deletion_manifest enable row level security;
revoke all on public.administrator_user_deletions,public.administrator_user_deletion_audit,
  public.application_user_deletion_manifest from anon,authenticated;
grant all on public.administrator_user_deletions,public.administrator_user_deletion_audit,
  public.application_user_deletion_manifest to service_role;

revoke all on function public.user_deletion_preview(uuid) from public;
revoke all on function public.begin_user_deletion(uuid,text,text) from public;
revoke all on function public.user_deletion_status(uuid) from public;
revoke all on function public.user_deletion_storage_objects(uuid) from public;
revoke all on function public.mark_user_deletion_stage(uuid,text,text,text) from public;
revoke all on function public.cleanup_user_deletion_database(uuid) from public;
grant execute on function public.user_deletion_preview(uuid),
  public.begin_user_deletion(uuid,text,text),public.user_deletion_status(uuid),
  public.user_deletion_storage_objects(uuid),public.mark_user_deletion_stage(uuid,text,text,text),
  public.cleanup_user_deletion_database(uuid) to authenticated,service_role;
revoke all on function public.assert_application_user_deletion_manifest_complete() from public;
grant execute on function public.assert_application_user_deletion_manifest_complete() to service_role;

select public.assert_application_user_deletion_manifest_complete();

select pg_notify('pgrst','reload schema');
