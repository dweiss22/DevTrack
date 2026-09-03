import { AppShell } from "@/components/app-shell";
import { VideoDashboard, type VideoDashboardContributorRow, type VideoDashboardRow } from "@/components/video-dashboard";
import { requirePageCapability } from "@/lib/auth";
import { isAdministratorRole } from "@/lib/auth/roles";
import type { DashboardIdentity } from "@/lib/dashboards/domain";

export default async function VideoDashboardPage({ searchParams }: { searchParams: Promise<{ videographer?: string }> }) {
  const { profile, supabase } = await requirePageCapability("view_video_dashboard");
  const query = await searchParams;
  const requested = query.videographer ?? profile.wrike_user_id ?? undefined;
  const { data: identityRows, error: identitiesError } = await supabase.rpc("reporting_video_dashboard_identities");
  if (identitiesError) throw new Error("The Video Dashboard identity list could not be loaded.");
  const identities = (identityRows ?? []) as DashboardIdentity[];
  const selected = identities.find((identity) => identity.wrike_user_id === requested && identity.selectable) ?? null;
  const [{ data: rows, error: rowsError }, { data: contributorRows, error: contributorError }] = selected?.wrike_user_id
    ? await Promise.all([
      supabase.rpc("reporting_video_dashboard_rows", { target_wrike_user_id: selected.wrike_user_id }),
      supabase.rpc("reporting_video_dashboard_contributor_rows", { target_wrike_user_id: selected.wrike_user_id }),
    ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (rowsError || contributorError) throw new Error("The selected Video Dashboard could not be loaded.");
  const dashboardRows = (rows ?? []) as VideoDashboardRow[];
  const dashboardContributorRows = (contributorRows ?? []) as VideoDashboardContributorRow[];
  const mappingRequired = profile.access.operationalRoles.includes("videographer") && !profile.wrike_user_id;

  return <AppShell isAdmin={isAdministratorRole(profile.access)}>
    <header className="page-header"><div><p className="eyebrow">SINGLE VIDEO ASSIGNMENTS</p>
      <h1>Video Dashboard{selected ? ` — ${selected.display_name}` : ""}</h1>
      <p>Single Video course projects assigned through the Wrike Designer Assigned custom field.</p></div></header>
    <VideoDashboard identities={identities} selected={selected} rows={dashboardRows} contributorRows={dashboardContributorRows}
      mappingRequired={mappingRequired} />
  </AppShell>;
}
