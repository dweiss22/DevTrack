-- Keep the database capability matrix aligned with the application matrix so
-- composed Admin/SuperAdmin grants can use Data-page RPCs and RLS policies.

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
    else false
  end;
$$;

select pg_notify('pgrst','reload schema');
