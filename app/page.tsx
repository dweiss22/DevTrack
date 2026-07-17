import { AppShell } from "@/components/app-shell";
import { DashboardCharts, type DashboardStatusDatum } from "@/components/dashboard-charts";
import { ReportFilters } from "@/components/report-filters";
import { requireContext } from "@/lib/auth";
import { hours } from "@/lib/metrics";
import { filtersForRpc, parseReportingFilters } from "@/lib/reporting/filters";
import { loadCustomFieldOptions } from "@/lib/reporting/options";

function Metric({ label, value }: { label: string; value: string | number }) {
  return <article className="card metric"><p>{label}</p><strong>{value}</strong></article>;
}

type OnlineLearningMetrics = {
  totalProjects: number;
  activeProjects: number;
  completedProjects: number;
  stalledOrCanceledProjects: number;
  unresolvedStatusProjects: number;
  overdueProjects: number;
  plannedMinutes: number;
};

const emptyMetrics: OnlineLearningMetrics = { totalProjects: 0, activeProjects: 0, completedProjects: 0, stalledOrCanceledProjects: 0, unresolvedStatusProjects: 0, overdueProjects: 0, plannedMinutes: 0 };

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filters = parseReportingFilters(await searchParams);
  const { supabase, profile } = await requireContext();
  const rpcFilters = filtersForRpc(filters);
  const [metricsResult, statusResult, lastRunResult, customFields] = await Promise.all([
    supabase.rpc("reporting_online_learning_dashboard", { filters: rpcFilters }),
    supabase.rpc("reporting_online_learning_status_summary", { filters: rpcFilters }),
    supabase.from("wrike_folder_task_import_runs").select("created_at").eq("organization_id", profile.organization_id).eq("status", "succeeded").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    loadCustomFieldOptions(supabase)
  ]);
  const totals = (metricsResult.data ?? emptyMetrics) as OnlineLearningMetrics;
  const statusData = (statusResult.data ?? []) as DashboardStatusDatum[];
  const statuses = statusData.map((status) => ({ id: status.status_id ?? status.name, name: status.name, color: status.color, resolved: status.resolved }));
  const classifiedTotal = totals.activeProjects + totals.completedProjects + totals.stalledOrCanceledProjects + totals.unresolvedStatusProjects;

  return <AppShell lastSynced={lastRunResult.data?.created_at}>
    <header className="page-header"><div><p className="eyebrow">ONLINE LEARNING OVERVIEW</p><h1>Wrike projects at a glance</h1><p>Workflow membership and status classifications use synchronized Wrike IDs, names, and colors.</p></div><a className="button" href="/admin">Import tasks and timelogs</a></header>
    <ReportFilters filters={filters} statuses={statuses} customFields={customFields} taskOnly />
    {totals.unresolvedStatusProjects > 0 && <p className="notice error">{totals.unresolvedStatusProjects} Online Learning project{totals.unresolvedStatusProjects === 1 ? " has" : "s have"} an unresolved or unclassified status. These projects are included in Total Projects but are not silently counted as active or completed.</p>}
    <section className="metric-grid">
      <Metric label="Total Projects" value={totals.totalProjects} />
      <Metric label="Active Projects" value={totals.activeProjects} />
      <Metric label="Completed Projects" value={totals.completedProjects} />
      <Metric label="Stalled or Canceled" value={totals.stalledOrCanceledProjects} />
      <Metric label="Unresolved Status" value={totals.unresolvedStatusProjects} />
      <Metric label="Overdue Active" value={totals.overdueProjects} />
      <Metric label="Total planned hours" value={hours(totals.plannedMinutes)} />
    </section>
    {totals.totalProjects !== classifiedTotal && <p className="notice error">Dashboard classification totals are inconsistent. Run the combined import and review unresolved references in Administration.</p>}
    <DashboardCharts statusData={statusData} />
    <section className="card"><h2>Current import scope</h2><p>Tasks, timelogs, people, workflows, statuses, spaces, folders, categories, and custom fields are resolved during import. When Wrike metadata is unavailable, the original ID and value remain preserved and are clearly marked until a later import or administrator mapping resolves them.</p></section>
  </AppShell>;
}
