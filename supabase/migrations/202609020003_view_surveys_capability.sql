-- current_has_capability() had no 'view_surveys' branch, so it fell through
-- to `else false` for every role. survey_results_by_sme() (202609010005)
-- gates on current_has_capability('view_surveys') and therefore always
-- raised 42501, making /survey-results always show "Survey results could
-- not be loaded." for everyone. The TS-side matrix (lib/auth/roles.ts)
-- already grants view_surveys to id/sme/project_reviewer operational roles
-- and sme_coordinator/admin/super_admin management roles -- mirror that.

create or replace function public.current_has_capability(target_capability text)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select case target_capability
    when 'manage_data' then public.current_has_management_role('admin')
      or public.current_has_management_role('super_admin')
    when 'manage_smes' then public.current_has_management_role('sme_coordinator')
      or public.current_has_management_role('admin') or public.current_has_management_role('super_admin')
    when 'view_sme_survey_details' then public.current_has_management_role('sme_coordinator')
      or public.current_has_management_role('admin') or public.current_has_management_role('super_admin')
    when 'select_sme_dashboard_user' then public.current_has_operational_role('id')
      or public.current_has_management_role('sme_coordinator')
      or public.current_has_management_role('admin') or public.current_has_management_role('super_admin')
    when 'manage_users' then public.current_has_management_role('admin')
      or public.current_has_management_role('super_admin')
    when 'manage_surveys' then public.current_has_management_role('admin')
      or public.current_has_management_role('super_admin')
    when 'view_sme_dashboard' then public.current_has_operational_role('sme')
      or public.current_has_operational_role('id')
      or public.current_has_management_role('sme_coordinator')
      or public.current_has_management_role('admin') or public.current_has_management_role('super_admin')
    when 'view_personal_survey_index' then public.current_has_operational_role('id')
    when 'view_personal_surveys' then public.current_has_operational_role('id')
      or public.current_has_operational_role('sme')
    when 'view_surveys' then public.current_has_operational_role('id')
      or public.current_has_operational_role('sme')
      or public.current_has_operational_role('project_reviewer')
      or public.current_has_management_role('sme_coordinator')
      or public.current_has_management_role('admin') or public.current_has_management_role('super_admin')
    else false
  end;
$$;

select pg_notify('pgrst','reload schema');
