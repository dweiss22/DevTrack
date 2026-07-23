import { AppShell } from "@/components/app-shell";
import { IdDashboard, type IdDashboardRow } from "@/components/id-dashboard";
import { requirePageCapability } from "@/lib/auth";
import { hasCapability, isAdministratorRole } from "@/lib/auth/roles";
import type { DashboardIdentity } from "@/lib/dashboards/domain";

type CurrentIdentity = { wrike_user_id: string | null; display_name: string | null; email: string | null; mapping_status: string };
type DraftStatusRow = { task_id: string; available: boolean; updated_at: string | null; updated_by_name: string | null };

export default async function IdDashboardPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { profile, supabase } = await requirePageCapability("view_id_dashboard");
  const requested = (await searchParams).id;
  const canSelect = hasCapability(profile.role, "select_id_dashboard_user");
  const identityResult = canSelect
    ? await supabase.rpc("reporting_id_dashboard_identities")
    : await supabase.rpc("reporting_current_id_identity");
  if (identityResult.error) throw new Error("The ID Dashboard identity could not be loaded.");
  const identities = canSelect ? (identityResult.data ?? []) as DashboardIdentity[] : [];
  const current = canSelect ? null : ((identityResult.data ?? [])[0] as CurrentIdentity | undefined) ?? null;
  const selected: DashboardIdentity | null = canSelect
    ? identities.find((identity) => identity.wrike_user_id === requested && identity.selectable) ?? null
    : current?.wrike_user_id ? {
      identity_key: `wrike:${current.wrike_user_id}`, wrike_user_id: current.wrike_user_id,
      application_user_id: null, display_name: current.display_name ?? "Instructional Designer",
      email: current.email, mapping_status: "mapped", identity_status: "verified", selectable: true,
    } : null;
  const rowsResult = selected?.wrike_user_id
    ? await supabase.rpc("reporting_id_dashboard_rows", { target_wrike_user_id: selected.wrike_user_id })
    : { data: [], error: null };
  if (rowsResult.error) throw new Error("The selected ID Dashboard could not be loaded.");
  const dashboardRows = (rowsResult.data ?? []) as IdDashboardRow[];
  const { data: draftStatuses } = dashboardRows.length
    ? await supabase.rpc("project_finalized_draft_statuses", { target_task_ids: [...new Set(dashboardRows.map((row) => row.task_id))] })
    : { data: [] };
  const finalizedByTask = new Map<string, NonNullable<IdDashboardRow["finalized_draft"]>>(((draftStatuses ?? []) as DraftStatusRow[]).map((item) => [item.task_id, {
    available: Boolean(item.available), updatedAt: item.updated_at, updatedBy: item.updated_by_name,
  }]));
  const enrichedRows = dashboardRows.map((row) => ({
    ...row, finalized_draft: finalizedByTask.get(row.task_id) ?? { available: false },
  }));

  return <AppShell isAdmin={isAdministratorRole(profile.role)}>
    <header className="page-header"><div><p className="eyebrow">INSTRUCTIONAL DESIGN ASSIGNMENTS</p>
      <h1>ID Dashboard{selected ? ` — ${selected.display_name}` : ""}</h1>
      <p>Trusted course assignments and SME-review status for one instructional designer identity.</p></div></header>
    <IdDashboard identities={identities} selected={selected} rows={enrichedRows}
      canSelect={canSelect} canActAsAssignedId={profile.role === "id"} mappingRequired={!canSelect && !selected} />
  </AppShell>;
}
