-- Admins had no way to establish an SME identity for a brand-new external SME
-- who has never appeared in a synced Wrike task's SME field: sme_dashboard_identities
-- rows are only ever created by refresh_sme_dashboard_identities() scanning already-
-- synced Wrike data (202607290001_field_derived_sme_dashboard_identities.sql), and
-- link_application_user_sme_identity() rejects any identity id that doesn't already
-- exist. This lets an admin reserve a name up front; because the id is computed with
-- the same stable_sme_dashboard_identity_id() hash refresh_sme_dashboard_identities()
-- uses, a later real Wrike-field occurrence of the same (normalized) name reconciles
-- onto this same row via its existing ON CONFLICT (organization_id, normalized_name)
-- upsert, preserving the application_user_id link (that column isn't in its SET list).

create or replace function public.ensure_sme_dashboard_identity(
  target_organization_id uuid,
  target_display_name text
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  actor public.application_users%rowtype;
  normalized_name text;
  identity_id uuid;
  trimmed_name text;
begin
  select * into actor from public.application_users
  where id=public.current_effective_user_id()
    and organization_id=target_organization_id and account_state='active';
  if actor.id is null or not (
    actor.role in ('admin','super_admin')
    or exists(
      select 1 from public.application_user_management_roles role_grant
      where role_grant.application_user_id=actor.id
        and role_grant.organization_id=actor.organization_id
        and role_grant.management_role in ('admin','super_admin')
        and role_grant.is_active
    )
  ) then
    raise exception using errcode='42501',
      message='SME identity reservation is unavailable.';
  end if;
  trimmed_name:=btrim(target_display_name);
  normalized_name:=public.normalize_project_assignment_name(trimmed_name);
  if normalized_name='' then
    raise exception using errcode='23514',
      message='Enter the SME''s name as it will appear in the Wrike SME field.';
  end if;
  identity_id:=public.stable_sme_dashboard_identity_id(target_organization_id,normalized_name);
  insert into public.sme_dashboard_identities(
    id,organization_id,normalized_name,display_name,observed_names,
    resolution_status,updated_at
  ) values (
    identity_id,target_organization_id,normalized_name,trimmed_name,
    array[trimmed_name],'resolved',now()
  )
  on conflict (organization_id,normalized_name) do nothing;
  return identity_id;
end;
$$;

revoke all on function public.ensure_sme_dashboard_identity(uuid,text) from public;
grant execute on function public.ensure_sme_dashboard_identity(uuid,text)
  to authenticated,service_role;
comment on function public.ensure_sme_dashboard_identity(uuid,text) is
  'Reserves an sme_dashboard_identities row for a name not yet discovered from Wrike, using the same deterministic id refresh_sme_dashboard_identities() would assign so a later real Wrike-field occurrence reconciles onto the same row.';

select pg_notify('pgrst','reload schema');
