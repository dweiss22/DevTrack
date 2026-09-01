import { AppShell } from "@/components/app-shell";
import { IdDashboard, type IdDashboardRow } from "@/components/id-dashboard";
import { requirePageCapability } from "@/lib/auth";
import { hasCapability, isAdministratorRole } from "@/lib/auth/roles";
import type { DashboardIdentity } from "@/lib/dashboards/domain";
import { loadIdDashboardAnalytics } from "@/lib/dashboards/id-analytics";

type CurrentIdentity = { wrike_user_id: string | null; display_name: string | null; email: string | null; mapping_status: string };
type DraftStatusRow = { task_id: string; available: boolean; updated_at: string | null; updated_by_name: string | null };
type CourseStyleRow = { task_id: string; course_style: string | null };

export default async function IdDashboardPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { profile, supabase } = await requirePageCapability("view_id_dashboard");
  const requested = (await searchParams).id;
  const canSelect = hasCapability(profile.access, "select_id_dashboard_user");
  const [identityResult, personaResult] = await Promise.all([
    canSelect ? supabase.rpc("reporting_id_dashboard_identities") : supabase.rpc("reporting_current_id_identity"),
    profile.role === "super_admin" ? supabase.rpc("superadmin_id_persona") : Promise.resolve({ data: [], error: null }),
  ]);
  if (identityResult.error) throw new Error("The ID Dashboard identity could not be loaded.");
  const identities = canSelect ? (identityResult.data ?? []) as DashboardIdentity[] : [];
  const current = canSelect ? null : ((identityResult.data ?? [])[0] as CurrentIdentity | undefined) ?? null;
  const persona = ((personaResult.data ?? [])[0] as CurrentIdentity | undefined) ?? null;
  const selected: DashboardIdentity | null = canSelect
    ? identities.find((identity) => identity.wrike_user_id === (requested ?? persona?.wrike_user_id) && identity.selectable) ?? null
    : current?.wrike_user_id ? {
      identity_key: `wrike:${current.wrike_user_id}`, wrike_user_id: current.wrike_user_id,
      application_user_id: null, display_name: current.display_name ?? "Instructional Designer",
      email: current.email, mapping_status: "mapped", identity_status: "verified", selectable: true,
    } : null;
  const [rowsResult, analyticsResult, courseStylesResult] = selected?.wrike_user_id
    ? await Promise.all([
      supabase.rpc("reporting_id_dashboard_rows", { target_wrike_user_id: selected.wrike_user_id }),
      loadIdDashboardAnalytics(supabase, selected.wrike_user_id),
      supabase.rpc("reporting_id_dashboard_course_styles", { target_wrike_user_id: selected.wrike_user_id }),
    ])
    : [{ data: [], error: null }, { data: null, error: null }, { data: [], error: null }];
  if (rowsResult.error || courseStylesResult.error) {
    console.error("id_dashboard_data_failed", {
      rowsCode: rowsResult.error?.code ?? null,
      courseStylesCode: courseStylesResult.error?.code ?? null,
    });
    throw new Error("The selected ID Dashboard could not be loaded.");
  }
  const dashboardRows = (rowsResult.data ?? []) as IdDashboardRow[];
  const { data: draftStatuses } = dashboardRows.length
    ? await supabase.rpc("project_finalized_draft_statuses", { target_task_ids: [...new Set(dashboardRows.map((row) => row.task_id))] })
    : { data: [] };
  const finalizedByTask = new Map<string, NonNullable<IdDashboardRow["finalized_draft"]>>(((draftStatuses ?? []) as DraftStatusRow[]).map((item) => [item.task_id, {
    available: Boolean(item.available), updatedAt: item.updated_at, updatedBy: item.updated_by_name,
  }]));
  const courseStyleByTask = new Map(((courseStylesResult.data ?? []) as CourseStyleRow[])
    .map((item) => [item.task_id, item.course_style]));
  const enrichedRows = dashboardRows.map((row) => ({
    ...row, course_style: courseStyleByTask.get(row.task_id) ?? null,
    finalized_draft: finalizedByTask.get(row.task_id) ?? { available: false },
  }));

  const ownOperationalView = profile.role === "id"
    || (profile.role === "super_admin" && Boolean(persona?.wrike_user_id)
      && selected?.wrike_user_id === persona?.wrike_user_id);
  const surveyRequirements = ownOperationalView
    ? await supabase.rpc("survey_personal_requirements")
    : { data: null };
  const requirementCounts = surveyRequirements.data as { incompleteCount: number; completedCount: number } | null;
  return <AppShell isAdmin={isAdministratorRole(profile.access)}>
    <header className="page-header"><div><p className="eyebrow">INSTRUCTIONAL DESIGN ASSIGNMENTS</p>
      <h1>ID Dashboard{selected ? ` — ${selected.display_name}` : ""}</h1>
      <p>Online Learning projects explicitly assigned through the Wrike ID Assigned custom field.</p></div></header>
    {requirementCounts && <a className="card id-dashboard-survey-summary" href="/surveys">
      <span>Your assigned surveys</span>
      <span><strong>{requirementCounts.incompleteCount}</strong> incomplete</span>
      <span><strong>{requirementCounts.completedCount}</strong> completed</span>
    </a>}
    <IdDashboard identities={identities} selected={selected} rows={enrichedRows}
      canSelect={canSelect} canActAsAssignedId={ownOperationalView} mappingRequired={!canSelect && !selected}
      ownOperationalView={ownOperationalView} analytics={analyticsResult.data}
      analyticsError={analyticsResult.error} />
  </AppShell>;
}
