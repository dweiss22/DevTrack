-- Surface the SME project folder URL alongside the identity list so the SME
-- Dashboard can show a "Project Folder" button, and so an ID viewing an SME's
-- dashboard can see and edit the current value.

drop function if exists public.reporting_sme_dashboard_identities();
create function public.reporting_sme_dashboard_identities()
returns table(
  identity_key text,sme_identity_id uuid,wrike_user_id uuid,
  application_user_id uuid,display_name text,email text,
  mapping_status text,identity_status text,selectable boolean,
  project_folder_url text
)
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  viewer public.application_users%rowtype;
  own_identity uuid;
begin
  select * into viewer from public.application_users
  where id=public.current_effective_user_id() and account_state='active';
  if viewer.id is null or not public.current_has_capability('view_sme_dashboard') then
    raise exception using errcode='42501',message='Dashboard is unavailable.';
  end if;
  own_identity:=public.current_sme_dashboard_identity();
  return query
  select 'sme:'||identity.id::text,identity.id,identity.wrike_user_id,
    identity.application_user_id,identity.display_name,wrike.email,
    case when identity.application_user_id is null then 'unmapped' else 'mapped' end,
    identity.resolution_status,
    identity.resolution_status<>'ambiguous',
    identity.project_folder_url
  from public.sme_dashboard_identities identity
  left join public.wrike_users wrike on wrike.id=identity.wrike_user_id
  where identity.organization_id=viewer.organization_id
    and exists(
      select 1 from public.sme_dashboard_task_assignments assignment
      where assignment.sme_identity_id=identity.id
    )
    and (
      public.current_has_capability('select_sme_dashboard_user')
      or public.current_has_operational_role('id')
      or identity.id=own_identity
    )
  order by identity.display_name,identity.id;
end;
$$;

revoke all on function public.reporting_sme_dashboard_identities() from public;
grant execute on function public.reporting_sme_dashboard_identities()
  to authenticated,service_role;

select pg_notify('pgrst','reload schema');
