import { AppShell } from "@/components/app-shell";
import { DashboardCharts } from "@/components/dashboard-charts";
import { ReportFilters } from "@/components/report-filters";
import { requireContext } from "@/lib/auth";
import { filtersForRpc, parseReportingFilters } from "@/lib/reporting/filters";
import { hours } from "@/lib/metrics";
import { loadCustomFieldOptions } from "@/lib/reporting/options";

function Metric({ label, value }: { label: string; value: string | number }) {
  return <article className="card metric"><p>{label}</p><strong>{value}</strong></article>;
}

type Metrics = {
  trackedTasks: number;
  completedTasks: number;
  cancelledTasks: number;
  openTasks: number;
  overdueTasks: number;
  plannedMinutes: number;
};

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filters = parseReportingFilters(await searchParams);
  const { supabase, profile } = await requireContext();
  const rpcFilters = filtersForRpc(filters);
  const [metricsResult, statusResult, lastRunResult, customFields] = await Promise.all([
    supabase.rpc("reporting_task_metrics", { filters: rpcFilters }),
    supabase.rpc("reporting_task_status_summary", { filters: rpcFilters }),
    supabase.from("wrike_folder_task_import_runs").select("created_at").eq("organization_id", profile.organization_id).eq("status", "succeeded").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    loadCustomFieldOptions(supabase)
  ]);
  const totals = (metricsResult.data ?? { trackedTasks: 0, completedTasks: 0, cancelledTasks: 0, openTasks: 0, overdueTasks: 0, plannedMinutes: 0 }) as Metrics;
  const statusData = (statusResult.data ?? []) as { name: string; tasks: number }[];
  const statuses = statusData.map((row) => row.name).filter(Boolean).sort();

  return <AppShell lastSynced={lastRunResult.data?.created_at}>
    <header className="page-header"><div><p className="eyebrow">TASK IMPORT OVERVIEW</p><h1>Wrike tasks at a glance</h1><p>These results combine configured task and timelog endpoints with readable people, workflow statuses, categories, folder titles, and LCT metadata.</p></div><a className="button" href="/admin">Import tasks and timelogs</a></header>
    <ReportFilters filters={filters} statuses={statuses} customFields={customFields} taskOnly />
    <section className="metric-grid">
      <Metric label="Imported tasks" value={totals.trackedTasks} />
      <Metric label="Completed" value={totals.completedTasks} />
      <Metric label="Open" value={totals.openTasks} />
      <Metric label="Cancelled" value={totals.cancelledTasks} />
      <Metric label="Overdue" value={totals.overdueTasks} />
      <Metric label="Total planned hours" value={hours(totals.plannedMinutes)} />
    </section>
    <DashboardCharts statusData={statusData} />
    <section className="card"><h2>Current import scope</h2><p>Task details, effort, responsible-user IDs, readable assignees, workflow statuses, folder/project hierarchy, LCT custom-field values, folder-based timelogs, authors, and timelog categories are synchronized. Raw Wrike IDs remain available when a readable reference cannot be resolved.</p></section>
  </AppShell>;
}
