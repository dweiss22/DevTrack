import { AppShell } from "@/components/app-shell";
import { VideoDashboard, type VideoDashboardRow } from "@/components/video-dashboard";
import { requirePageCapability } from "@/lib/auth";
import { hasCapability, isAdministratorRole } from "@/lib/auth/roles";
import type { DashboardIdentity } from "@/lib/dashboards/domain";

type CurrentIdentity = { wrike_user_id: string | null; display_name: string | null; email: string | null; mapping_status: string };

export default async function VideoDashboardPage({ searchParams }: { searchParams: Promise<{ videographer?: string }> }) {
  const { profile, supabase } = await requirePageCapability("view_video_dashboard");
  const query = await searchParams;
  const requested = query.videographer;
  const canSelect = hasCapability(profile.access, "select_video_dashboard_user");
  const identityResult = canSelect
    ? await supabase.rpc("reporting_video_dashboard_identities")
    : await supabase.rpc("reporting_current_video_identity");
  if (identityResult.error) throw new Error("The Video Dashboard identity could not be loaded.");
  const identities = canSelect ? (identityResult.data ?? []) as DashboardIdentity[] : [];
  const current = canSelect ? null : ((identityResult.data ?? [])[0] as CurrentIdentity | undefined) ?? null;
  const selected: DashboardIdentity | null = canSelect
    ? identities.find((identity) => identity.wrike_user_id === requested && identity.selectable) ?? null
    : current?.wrike_user_id ? {
      identity_key: `wrike:${current.wrike_user_id}`, wrike_user_id: current.wrike_user_id,
      application_user_id: null, display_name: current.display_name ?? "Videographer",
      email: current.email, mapping_status: "mapped", identity_status: "verified", selectable: true,
    } : null;
  const { data: rows, error: rowsError } = selected?.wrike_user_id
    ? await supabase.rpc("reporting_video_dashboard_rows", { target_wrike_user_id: selected.wrike_user_id })
    : { data: [], error: null };
  if (rowsError) throw new Error("The selected Video Dashboard could not be loaded.");
  const dashboardRows = (rows ?? []) as VideoDashboardRow[];
  const mappingRequired = profile.access.operationalRoles.includes("videographer") && !canSelect && !selected;

  return <AppShell isAdmin={isAdministratorRole(profile.access)}>
    <header className="page-header"><div><p className="eyebrow">SINGLE VIDEO ASSIGNMENTS</p>
      <h1>Video Dashboard{selected ? ` — ${selected.display_name}` : ""}</h1>
      <p>Single Video course projects assigned through the Wrike Designer Assigned custom field.</p></div></header>
    <VideoDashboard identities={identities} selected={selected} rows={dashboardRows}
      canSelect={canSelect} mappingRequired={mappingRequired} />
  </AppShell>;
}
