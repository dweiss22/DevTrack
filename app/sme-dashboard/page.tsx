import { AppShell } from "@/components/app-shell";
import { SmeDashboard, type SmeDashboardRow } from "@/components/sme-dashboard";
import { requirePageCapability } from "@/lib/auth";
import { hasCapability, isAdministratorRole } from "@/lib/auth/roles";
import type { DashboardIdentity } from "@/lib/dashboards/domain";

export default async function SmeDashboardPage({ searchParams }: { searchParams: Promise<{ sme?: string }> }) {
  const { profile, supabase } = await requirePageCapability("view_sme_dashboard");
  const requested = (await searchParams).sme;
  const { data: identityRows, error: identitiesError } = await supabase.rpc("reporting_sme_dashboard_identities");
  if (identitiesError) throw new Error("The SME Dashboard identity list could not be loaded.");
  const identities = (identityRows ?? []) as DashboardIdentity[];
  const canSelect = hasCapability(profile.role, "select_sme_dashboard_user");
  const selected = canSelect
    ? identities.find((identity) => identity.wrike_user_id === requested && identity.selectable) ?? null
    : identities[0] ?? null;
  const { data: rows, error: rowsError } = selected?.wrike_user_id
    ? await supabase.rpc("reporting_sme_dashboard_rows", { target_wrike_user_id: selected.wrike_user_id })
    : { data: [], error: null };
  if (rowsError) throw new Error("The selected SME Dashboard could not be loaded.");
  const mappingRequired = profile.role === "sme" && !selected;

  return <AppShell isAdmin={isAdministratorRole(profile.role)}>
    <header className="page-header"><div><p className="eyebrow">ASSIGNED COURSE DEVELOPMENT</p>
      <h1>SME Dashboard{selected ? ` — ${selected.display_name}` : ""}</h1>
      <p>Trusted course assignments, timing, and debrief status for one SME identity.</p></div></header>
    <SmeDashboard identities={identities} selected={selected} rows={(rows ?? []) as SmeDashboardRow[]}
      canSelect={canSelect} canViewProjects={hasCapability(profile.role, "view_standard_pages")}
      canLaunchDebrief={hasCapability(profile.role, "create_sme_debrief")} mappingRequired={mappingRequired} />
  </AppShell>;
}
