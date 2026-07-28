import { AppShell } from "@/components/app-shell";
import { SmeDashboard, type SmeDashboardRow } from "@/components/sme-dashboard";
import { requirePageCapability } from "@/lib/auth";
import { hasCapability, isAdministratorRole } from "@/lib/auth/roles";
import type { DashboardIdentity } from "@/lib/dashboards/domain";

export default async function SmeDashboardPage({ searchParams }: { searchParams: Promise<{ sme?: string; scope?: string }> }) {
  const { profile, supabase, user } = await requirePageCapability("view_sme_dashboard");
  const query = await searchParams;
  const requested = query.sme;
  const scope = query.scope === "all" ? "all" : "recent";
  const { data: identityRows, error: identitiesError } = await supabase.rpc("reporting_sme_dashboard_identities");
  if (identitiesError) throw new Error("The SME Dashboard identity list could not be loaded.");
  const identities = (identityRows ?? []) as DashboardIdentity[];
  const canSelect = hasCapability(profile.access, "select_sme_dashboard_user");
  const selected = canSelect
    ? identities.find((identity) => identity.wrike_user_id === requested && identity.selectable) ?? null
    : identities[0] ?? null;
  const { data: rows, error: rowsError } = selected?.wrike_user_id
    ? await supabase.rpc("reporting_sme_dashboard_rows", { target_wrike_user_id: selected.wrike_user_id })
    : { data: [], error: null };
  if (rowsError) throw new Error("The selected SME Dashboard could not be loaded.");
  const dashboardRows = (rows ?? []) as SmeDashboardRow[];
  const visibleRows = scope === "all" ? dashboardRows : dashboardRows.filter((row) => row.is_recent);
  const mappingRequired = profile.access.operationalRoles.includes("sme") && !canSelect && !selected;

  return <AppShell isAdmin={isAdministratorRole(profile.access)}>
    <header className="page-header"><div><p className="eyebrow">ASSIGNED COURSE DEVELOPMENT</p>
      <h1>SME Dashboard{selected ? ` — ${selected.display_name}` : ""}</h1>
      <p>Projects explicitly assigned through the Wrike SME custom field.</p></div></header>
    <SmeDashboard identities={identities} selected={selected} rows={visibleRows}
      canSelect={canSelect} canLaunchDebrief={profile.access.operationalRoles.includes("sme")
        && hasCapability(profile.access, "create_sme_debrief")}
      currentUserId={user.id}
      scope={scope} administrativeView={canSelect} mappingRequired={mappingRequired} />
  </AppShell>;
}
