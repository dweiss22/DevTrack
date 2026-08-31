-- 202607280001 (additive_management_roles) repointed the "Verified Wrike
-- Identity" assignment UI (set_application_user_operational_access) to write
-- id/sme/project_reviewer mappings into application_user_operational_personas
-- instead of the legacy application_users.wrike_user_id column. But
-- current_id_operational_identity() -- the function reporting_current_id_identity()
-- and reporting_id_dashboard_rows() rely on to resolve an 'id'-role user's own
-- Wrike identity -- was never updated to consult that table for role='id'; it
-- only ever checked application_users.wrike_user_id directly (a path that only
-- the fixed SuperAdmin persona and pre-migration accounts still populate).
-- Result: an admin who assigns the Verified Wrike Identity through User
-- Management (the only mapping control that still exists in the UI) has the
-- mapping recorded, but the logged-in 'id' user is told their account "is not
-- mapped to a verified Wrike identity" because the read path never looked at
-- the persona table. Make the 'id' role fall back through the persona
-- assignment the same way the super_admin persona already does.
create or replace function public.current_id_operational_identity()
returns uuid language sql stable security definer set search_path=public as $$
  select case
    when application_user.role='id' then coalesce(persona.wrike_user_id,application_user.wrike_user_id)
    when application_user.role='super_admin' then persona.wrike_user_id
    else null
  end
  from public.application_users application_user
  left join public.application_user_operational_personas persona
    on persona.application_user_id=application_user.id
    and persona.organization_id=application_user.organization_id
    and persona.operational_role='id' and persona.is_active
  left join public.wrike_users identity
    on identity.id=coalesce(
      case when application_user.role='id' then coalesce(persona.wrike_user_id,application_user.wrike_user_id) end,
      persona.wrike_user_id
    )
    and identity.organization_id=application_user.organization_id
    and identity.is_active and not identity.is_unresolved and identity.identity_verified
  where application_user.id=public.current_effective_user_id()
    and application_user.account_state='active' and identity.id is not null
  limit 1;
$$;

-- reporting_id_dashboard_rows hardcoded viewer.wrike_user_id (the same legacy
-- column) when resolving which tasks an 'id'-role viewer may see. Repoint it
-- at current_id_operational_identity() so a persona-backed mapping actually
-- surfaces the assigned dashboard rows once reporting_current_id_identity()
-- reports the account as mapped.
do $$
declare definition text;
begin
  select pg_get_functiondef(procedure.oid) into definition
  from pg_proc procedure join pg_namespace namespace on namespace.oid=procedure.pronamespace
  where namespace.nspname='public' and procedure.proname='reporting_id_dashboard_rows';
  if definition is null or definition not like '%if viewer.role=''id'' then target_wrike_user_id:=viewer.wrike_user_id;%' then
    raise exception 'reporting_id_dashboard_rows definition not found or shape changed unexpectedly';
  end if;
  definition:=replace(definition,
    'if viewer.role=''id'' then target_wrike_user_id:=viewer.wrike_user_id;',
    'if viewer.role=''id'' then target_wrike_user_id:=public.current_id_operational_identity();');
  execute definition;
end $$;

-- reporting_id_dashboard_identities() drives the Admin/SuperAdmin "Instructional
-- Designer" picker's mapped/unmapped label. It only matched against the legacy
-- application_users.wrike_user_id column, so a persona-mapped user showed as
-- "unmapped" there too even though the assignment is live. Match against the
-- active persona as well.
do $$
declare definition text;
begin
  select pg_get_functiondef(procedure.oid) into definition
  from pg_proc procedure join pg_namespace namespace on namespace.oid=procedure.pronamespace
  where namespace.nspname='public' and procedure.proname='reporting_id_dashboard_identities';
  if definition is null or definition not like
    '%left join public.application_users member on member.organization_id=viewer.organization_id%and member.role=''id'' and member.wrike_user_id=identity.id%' then
    raise exception 'reporting_id_dashboard_identities definition not found or shape changed unexpectedly';
  end if;
  definition:=replace(definition,
    'from assigned join public.wrike_users identity on identity.id=assigned.wrike_user_id
  left join public.application_users member on member.organization_id=viewer.organization_id
    and member.role=''id'' and member.wrike_user_id=identity.id',
    'from assigned join public.wrike_users identity on identity.id=assigned.wrike_user_id
  left join public.application_user_operational_personas persona on persona.organization_id=viewer.organization_id
    and persona.operational_role=''id'' and persona.is_active and persona.wrike_user_id=identity.id
  left join public.application_users member on member.organization_id=viewer.organization_id
    and member.role=''id'' and (member.wrike_user_id=identity.id or member.id=persona.application_user_id)');
  execute definition;
end $$;

select pg_notify('pgrst','reload schema');
