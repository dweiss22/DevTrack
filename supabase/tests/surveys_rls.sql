begin;
select plan(76);
select has_table('public','survey_submissions','survey submissions exist');
select has_table('public','course_development_debrief_responses','debrief responses exist');
select has_table('public','id_sme_review_responses','ID review responses exist');
select has_table('public','survey_attachments','survey attachments exist');
select has_table('public','survey_revisions','survey revisions exist');
select has_table('public','survey_audit_log','survey audit exists');
select has_column('public','wrike_tasks','original_due_date','original due date is retained');
select has_index('public','survey_submissions','survey_debrief_identity_idx','debrief duplicate safeguard exists');
select has_index('public','survey_submissions','survey_id_review_identity_idx','ID review duplicate safeguard exists');
select has_function('public','survey_context_for_task',array['uuid','text'],'trusted context resolver exists');
select has_function('public','survey_create_or_resume',array['uuid','text','uuid'],'create/resume RPC exists');
select has_function('public','survey_create_or_resume',array['uuid','text','uuid','uuid'],'Wrike-subject create/resume RPC exists');
select has_function('public','survey_save',array['uuid','jsonb','boolean'],'save/submit RPC exists');
select has_function('public','survey_unlock',array['uuid','text','uuid'],'unlock RPC exists');
select has_function('public','survey_relock',array['uuid'],'relock RPC exists');
select ok((select not public from storage.buckets where id='survey-invoices'),'invoice bucket is private');
select is((select file_size_limit from storage.buckets where id='survey-invoices'),10485760::bigint,'invoice limit is 10 MB');
select has_function('public','reporting_sme_dashboard_identities',array[]::text[],'SME identity list RPC exists');
select has_function('public','reporting_sme_dashboard_rows',array['uuid'],'SME row RPC exists');
select has_function('public','reporting_current_id_identity',array[]::text[],'current ID mapping RPC exists');
select has_function('public','reporting_id_dashboard_identities',array[]::text[],'admin ID identity RPC exists');
select has_function('public','reporting_id_dashboard_rows',array['uuid'],'ID row RPC exists');
select has_function('public','reporting_id_dashboard_analytics',array['uuid'],'ID analytics RPC exists');
select has_function('public','reporting_id_dashboard_course_styles',array['uuid'],'ID Course Style RPC exists');
select has_function('public','normalize_course_development_person_name',array['text'],'canonical assignment-name normalizer exists');
select has_function('public','course_development_person_tokens',array['text[]'],'safe multi-person assignment tokenizer exists');
select has_function('public','survey_browse',array['jsonb','integer','integer'],'caller-aware survey browse RPC exists');
select has_function('public','set_application_user_wrike_identity',array['uuid','uuid','uuid','uuid'],'general identity mapping RPC exists');
select has_table('public','project_finalized_course_drafts','finalized course draft storage exists');
select has_table('public','project_finalized_course_draft_audit','finalized course draft audit exists');
select has_function('public','is_safe_finalized_course_draft_url',array['text'],'finalized URL validator exists');
select has_function('public','save_project_finalized_course_draft',array['uuid','text'],'assigned ID save RPC exists');
select has_function('public','remove_project_finalized_course_draft',array['uuid'],'assigned ID remove RPC exists');
select has_function('public','assigned_id_project_controls',array['uuid'],'assigned ID project controls exist');
select has_function('public','sme_project_detail',array['uuid'],'restricted SME project detail exists');
select has_table('public','survey_templates','survey templates exist');
select has_table('public','survey_template_drafts','survey template drafts exist');
select has_table('public','survey_template_versions','immutable survey versions exist');
select has_table('public','survey_template_audit_log','template audit log exists');
select has_column('public','survey_submissions','survey_version_id','submissions pin a survey version');
select has_column('public','survey_submissions','survey_version_number','submissions expose their pinned version number');
select has_column('public','survey_submissions','definition_snapshot','submissions retain a definition snapshot');
select has_column('public','survey_submissions','answers','submissions use generic answers');
select has_column('public','survey_revisions','definition_snapshot','revisions retain definition snapshots');
select has_column('public','survey_revisions','answers_snapshot','revisions retain normalized answer snapshots');
select has_column('public','survey_attachments','question_id','attachments bind to stable question ids');
select has_function('public','survey_admin_templates',array[]::text[],'admin template browser exists');
select has_function('public','survey_personal_requirements',array[]::text[],'personal assignment list exists');
select has_function('public','survey_personal_create_or_resume',array['uuid','uuid'],'assignment-bound personal start exists');
select has_function('public','survey_save_versioned',array['uuid','jsonb','boolean'],'version-aware save exists');
select has_column('public','id_sme_review_responses','reporting_year','ID compatibility rows retain Reporting Year');
select has_function('public','survey_sme_availability_at',array['uuid','timestamp with time zone'],'deterministic SME availability helper exists');
select has_function('public','survey_sme_availability',array['uuid'],'current-time SME availability wrapper exists');
select has_table('public','survey_historical_import_batches','historical survey import batches exist');
select has_table('public','survey_historical_import_upload_attempts','historical upload attempts exist');
select has_table('public','survey_historical_import_column_mappings','historical column mappings exist');
select has_table('public','survey_historical_import_rows','historical staged rows exist');
select has_table('public','survey_historical_import_issues','historical row issues exist');
select has_table('public','survey_historical_import_resolution_audit','historical resolution audit exists');
select has_table('public','survey_historical_import_integrations','historical canonical links exist');
select has_column('public','application_user_principals','historical_wrike_user_id','historical principals retain verified Wrike identity');
select has_column('public','survey_templates','is_import_only','survey templates distinguish import-only definitions');
select has_column('public','survey_template_versions','version_origin','survey versions retain their origin');
select has_function('public','integrate_historical_survey_import_batch',array['uuid'],'historical batch integration RPC exists');
select has_function('public','rollback_historical_survey_import_batch',array['uuid'],'protected historical rollback RPC exists');

insert into public.organizations(id,name,timezone) values
  ('90000000-0000-4000-8000-000000000001','Survey boundary Chicago','America/Chicago'),
  ('90000000-0000-4000-8000-000000000002','Survey boundary Pacific','America/Los_Angeles'),
  ('90000000-0000-4000-8000-000000000003','Survey boundary UTC','UTC');
insert into public.wrike_workflow_statuses(
  organization_id,wrike_id,workflow_id,title,dashboard_classification
) values
  ('90000000-0000-4000-8000-000000000001','completed','workflow','Completed','completed'),
  ('90000000-0000-4000-8000-000000000001','active','workflow','Completed','active'),
  ('90000000-0000-4000-8000-000000000002','completed','workflow','Completed','completed'),
  ('90000000-0000-4000-8000-000000000003','completed','workflow','Completed','completed');
insert into public.wrike_tasks(
  id,organization_id,wrike_id,title,status,custom_status_id,completed_at
) values
  ('91000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001','JAN31','January month end','Completed','completed','2024-01-31T18:00:00Z'),
  ('91000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000001','DST','DST boundary','Completed','completed','2024-03-10T18:00:00Z'),
  ('91000000-0000-4000-8000-000000000003','90000000-0000-4000-8000-000000000002','AUG31','August month end','Completed','completed','2025-08-31T19:00:00Z'),
  ('91000000-0000-4000-8000-000000000004','90000000-0000-4000-8000-000000000003','LEAP','Leap day','Completed','completed','2024-02-29T12:00:00Z'),
  ('91000000-0000-4000-8000-000000000005','90000000-0000-4000-8000-000000000001','ACTIVE','Status title is not authoritative','Completed','active','2024-01-31T18:00:00Z'),
  ('91000000-0000-4000-8000-000000000006','90000000-0000-4000-8000-000000000001','NO_DATE','Missing completion date','Completed','completed',null);

select is(
  public.survey_sme_availability_at(
    '91000000-0000-4000-8000-000000000001','2024-07-31T12:00:00Z'
  )->>'completedOn','2024-01-31','completion is converted to the organization calendar date'
);
select is(
  public.survey_sme_availability_at(
    '91000000-0000-4000-8000-000000000001','2024-07-31T12:00:00Z'
  )->>'availableThrough','2024-07-31','January 31 uses calendar-month arithmetic'
);
select is(
  (public.survey_sme_availability_at(
    '91000000-0000-4000-8000-000000000001','2024-08-01T04:59:59.999Z'
  )->>'available')::boolean,true,'SME availability includes the final local millisecond'
);
select is(
  public.survey_sme_availability_at(
    '91000000-0000-4000-8000-000000000001','2024-08-01T05:00:00Z'
  )->>'code','expired','SME availability expires at the next local midnight'
);
select is(
  public.survey_sme_availability_at(
    '91000000-0000-4000-8000-000000000001','2024-08-01T05:00:01Z'
  )->>'code','expired','SME availability stays expired after cutoff'
);
select is(
  public.survey_sme_availability_at(
    '91000000-0000-4000-8000-000000000003','2026-02-01T00:00:00Z'
  )->>'availableThrough','2026-02-28','August 31 clamps to the last February date'
);
select is(
  public.survey_sme_availability_at(
    '91000000-0000-4000-8000-000000000004','2024-08-01T00:00:00Z'
  )->>'availableThrough','2024-08-29','leap-day completion retains calendar-month semantics'
);
select is(
  public.survey_sme_availability_at(
    '91000000-0000-4000-8000-000000000005','2024-02-01T00:00:00Z'
  )->>'code','not_completed','a completed-looking title cannot replace authoritative classification'
);
select is(
  public.survey_sme_availability_at(
    '91000000-0000-4000-8000-000000000006','2024-02-01T00:00:00Z'
  )->>'code','completion_date_missing','completed classification also requires completed_at'
);
select is(
  (public.survey_sme_availability_at(
    '91000000-0000-4000-8000-000000000002','2024-09-11T04:59:59.999Z'
  )->>'available')::boolean,true,'DST-season cutoff uses the organization timezone'
);
select is(
  public.survey_sme_availability_at(
    '91000000-0000-4000-8000-000000000002','2024-09-11T05:00:00Z'
  )->>'code','expired','DST-season cutoff changes at local midnight'
);
select * from finish();
rollback;
