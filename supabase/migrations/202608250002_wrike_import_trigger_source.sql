alter table public.wrike_folder_task_import_runs
  add column trigger_source text not null default 'manual'
    check (trigger_source in ('manual', 'scheduled'));

comment on column public.wrike_folder_task_import_runs.trigger_source is 'Whether the import was started by an admin from the Data page ("manual") or by the daily cron job ("scheduled").';
