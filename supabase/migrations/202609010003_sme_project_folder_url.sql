-- SME project folder URL: a single SharePoint folder link per SME identity,
-- settable by an Admin, SME Coordinator, or any ID (from their view of an
-- SME's dashboard), and surfaced as a "Project Folder" button on the SME
-- Dashboard itself.

alter table public.sme_dashboard_identities
  add column if not exists project_folder_url text;

create or replace function public.set_sme_project_folder_url(
  target_sme_identity_id uuid,
  target_url text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  actor public.application_users%rowtype;
  identity public.sme_dashboard_identities%rowtype;
  normalized_url text;
begin
  select * into actor from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  if actor.id is null or not (
    public.current_has_management_role('admin')
    or public.current_has_management_role('super_admin')
    or public.current_has_management_role('sme_coordinator')
    or public.current_has_operational_role('id')
  ) then
    raise exception using errcode='42501',
      message='You do not have permission to set an SME project folder link.';
  end if;
  select * into identity from public.sme_dashboard_identities
  where id=target_sme_identity_id and organization_id=actor.organization_id;
  if identity.id is null then
    raise exception using errcode='23514',message='Select a valid SME identity.';
  end if;
  normalized_url:=nullif(trim(target_url),'');
  if normalized_url is not null and normalized_url !~* '^https?://' then
    raise exception using errcode='23514',
      message='Enter a full URL starting with http:// or https://.';
  end if;
  update public.sme_dashboard_identities
    set project_folder_url=normalized_url,updated_at=now()
    where id=target_sme_identity_id;
  return jsonb_build_object('ok',true,'projectFolderUrl',normalized_url);
end;
$$;

revoke all on function public.set_sme_project_folder_url(uuid,text) from public;
grant execute on function public.set_sme_project_folder_url(uuid,text)
  to authenticated,service_role;
comment on function public.set_sme_project_folder_url(uuid,text) is
  'Sets the SharePoint project folder URL for an SME identity. Admin, SME Coordinator, and ID roles may set it.';

select pg_notify('pgrst','reload schema');
