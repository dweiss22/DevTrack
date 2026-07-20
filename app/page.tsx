import { AppShell } from "@/components/app-shell";
import { DashboardCharts } from "@/components/dashboard-charts";
import { ReportFilters } from "@/components/report-filters";
import { requireContext } from "@/lib/auth";
import { loadDashboardAnalyticsResult, type DashboardAnalytics } from "@/lib/reporting/dashboard";
import { parseReportingFilters } from "@/lib/reporting/filters";
import { loadCustomFieldOptions, loadStatusOptions } from "@/lib/reporting/options";

function Metric({ label, value, detail }: { label: string; value: number; detail: string }) {
  return <article className="dashboard-stat"><p>{label}</p><strong>{value.toLocaleString()}</strong><small>{detail}</small></article>;
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filters = parseReportingFilters(await searchParams);
  const { supabase, profile } = await requireContext();
  const [analyticsResult, statusOptionsResult, customFieldOptionsResult, lastRunResult] = await Promise.all([
    loadDashboardAnalyticsResult(supabase, filters),
    loadStatusOptions(supabase, profile.organization_id).then((data) => ({ data, failed: false as const })).catch(() => ({ data: [], failed: true as const })),
    loadCustomFieldOptions(supabase).then((data) => ({ data, failed: false as const })).catch(() => ({ data: [], failed: true as const })),
    supabase.from("wrike_folder_task_import_runs").select("created_at").eq("organization_id", profile.organization_id).eq("status", "succeeded").order("created_at", { ascending: false }).limit(1).maybeSingle()
  ]);
  const analytics = analyticsResult.data;
  const statuses = statusOptionsResult.data;
  const customFields = customFieldOptionsResult.data;
  const filterOptionsUnavailable = statusOptionsResult.failed || customFieldOptionsResult.failed;

  return <AppShell isAdmin={profile.role === "admin"} lastSynced={lastRunResult.data?.created_at}>
    <header className="page-header dashboard-header"><div><p className="eyebrow">ONLINE LEARNING</p><h1>Dashboard</h1><p>A high-level view of synchronized projects assigned to Wrike workflow IEACHQK7K4BHMLHM.</p></div></header>
    {analyticsResult.error ? <section className="card dashboard-query-error" role="alert">
      <p className="eyebrow">DASHBOARD SETUP</p>
      <h2>{analyticsResult.error.title}</h2>
      <p>{analyticsResult.error.message}</p>
      {analyticsResult.error.diagnosticCode && <p><strong>Diagnostic code:</strong> <code>{analyticsResult.error.diagnosticCode}</code></p>}
      <a className="button secondary" href="/">Retry Dashboard</a>
    </section> : analytics && <DashboardContent analytics={analytics} filters={filters} statuses={statuses} customFields={customFields} filterOptionsUnavailable={filterOptionsUnavailable} />}
  </AppShell>;
}

function DashboardContent({ analytics, filters, statuses, customFields, filterOptionsUnavailable }: { analytics: DashboardAnalytics; filters: ReturnType<typeof parseReportingFilters>; statuses: Awaited<ReturnType<typeof loadStatusOptions>>; customFields: Awaited<ReturnType<typeof loadCustomFieldOptions>>; filterOptionsUnavailable: boolean }) {
  const metrics = analytics.metrics;
  return <>
    <section className="dashboard-stat-bar" aria-label="Current project statistics">
      <Metric label="Total Projects" value={metrics.totalProjects} detail="Online Learning workflow" />
      <Metric label="Active Projects" value={metrics.activeProjects} detail="Active or in progress" />
      <Metric label="Completed" value={metrics.completedProjects} detail="Explicit completed classification" />
    </section>
    {filterOptionsUnavailable && <p className="notice error" role="status">Dashboard analytics loaded, but one or more filter option lists are temporarily unavailable. Reload to retry those options.</p>}
    <ReportFilters filters={filters} statuses={statuses} customFields={customFields} taskOnly />
    {metrics.unresolvedStatusProjects > 0 && <p className="notice error">{metrics.unresolvedStatusProjects} project{metrics.unresolvedStatusProjects === 1 ? " has" : "s have"} an unclassified or unresolved Wrike status. Review status classifications in Data administration.</p>}
    {metrics.customFieldConflictProjects > 0 && <p className="notice error">{metrics.customFieldConflictProjects} project{metrics.customFieldConflictProjects === 1 ? " has" : "s have"} conflicting Dashboard custom-field sources. Preserved values are visible for administrative review.</p>}
    <DashboardCharts analytics={analytics} filters={filters} />
  </>;
}
