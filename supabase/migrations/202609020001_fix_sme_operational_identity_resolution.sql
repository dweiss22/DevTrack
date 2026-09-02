-- current_organization_id() has never included 'sme' in its role allowlist
-- (only super_admin/admin/id/project_reviewer resolve an organization through
-- it). current_sme_dashboard_identity() and is_sme_identity_assigned() relied
-- on it anyway, so for every SME-role account current_organization_id()
-- returned null and both functions silently failed: an admin could link a
-- user's account to its project-field SME identity in User Management, but
-- the SME Dashboard still told the user their account "is not linked to a
-- project-field SME identity," and survey creation/editing for that identity
-- would have failed the same way. Resolve the organization from the caller's
-- own application_users row instead, matching the pattern already used by
-- reporting_sme_dashboard_identities() and reporting_sme_dashboard_rows_by_identity()
-- in this same migration family.
create or replace function public.current_sme_dashboard_identity()
returns uuid
language sql
stable
security definer
set search_path=public
as $$
  select identity.id
  from public.sme_dashboard_identities identity
  join public.application_users viewer
    on viewer.id=public.current_effective_user_id()
    and viewer.account_state='active'
    and viewer.organization_id=identity.organization_id
  where identity.application_user_id=public.current_effective_user_id()
  limit 1;
$$;

create or replace function public.is_sme_identity_assigned(
  target_task_id uuid,target_sme_identity_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select target_sme_identity_id is not null and exists(
    select 1
    from public.sme_dashboard_task_assignments assignment
    join public.sme_dashboard_identities identity
      on identity.id=assignment.sme_identity_id
    join public.application_users viewer
      on viewer.id=public.current_effective_user_id()
      and viewer.account_state='active'
      and viewer.organization_id=assignment.organization_id
    where assignment.task_id=target_task_id
      and assignment.sme_identity_id=target_sme_identity_id
      and not assignment.source_has_conflict
      and identity.resolution_status<>'ambiguous'
  );
$$;

-- sme_identity_assignment_conflict() (added 202609010001) has the same
-- current_organization_id() dependency and the same failure for every
-- SME-role caller. Fix it the same way.
create or replace function public.sme_identity_assignment_conflict(
  target_task_id uuid,target_sme_identity_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select target_sme_identity_id is not null and exists(
    select 1
    from public.sme_dashboard_task_assignments assignment
    join public.sme_dashboard_identities identity
      on identity.id=assignment.sme_identity_id
    join public.application_users viewer
      on viewer.id=public.current_effective_user_id()
      and viewer.account_state='active'
      and viewer.organization_id=assignment.organization_id
    where assignment.task_id=target_task_id
      and assignment.sme_identity_id=target_sme_identity_id
      and (assignment.source_has_conflict or identity.resolution_status='ambiguous')
  );
$$;

select pg_notify('pgrst','reload schema');
