import { AppShell } from "@/components/app-shell";
import { DashboardCharts } from "@/components/dashboard-charts";
import { ReportFilters } from "@/components/report-filters";
import { requireContext } from "@/lib/auth";
import { filtersForRpc, parseReportingFilters } from "@/lib/reporting/filters";
import { hours } from "@/lib/metrics";

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
  const [metricsResult, statusResult, statusOptionsResult, lastRunResult] = await Promise.all([
    supabase.rpc("reporting_task_metrics", { filters: rpcFilters }),
    supabase.rpc("reporting_task_status_summary", { filters: rpcFilters }),
    supabase.from("wrike_tasks").select("status").eq("organization_id", profile.organization_id).eq("is_deleted", false).limit(5000),
    supabase.from("wrike_folder_task_import_runs").select("created_at").eq("organization_id", profile.organization_id).eq("status", "succeeded").order("created_at", { ascending: false }).limit(1).maybeSingle()
  ]);
  const totals = (metricsResult.data ?? { trackedTasks: 0, completedTasks: 0, cancelledTasks: 0, openTasks: 0, overdueTasks: 0, plannedMinutes: 0 }) as Metrics;
  const statuses = [...new Set((statusOptionsResult.data ?? []).map((row) => row.status).filter(Boolean))].sort();

  return <AppShell lastSynced={lastRunResult.data?.created_at}>
    <header className="page-header"><div><p className="eyebrow">TASK IMPORT OVERVIEW</p><h1>Wrike tasks at a glance</h1><p>These results come only from the configured folder task API.</p></div><a className="button" href="/admin">Import folder tasks</a></header>
    <ReportFilters filters={filters} statuses={statuses} taskOnly />
    <section className="metric-grid">
      <Metric label="Imported tasks" value={totals.trackedTasks} />
      <Metric label="Completed" value={totals.completedTasks} />
      <Metric label="Open" value={totals.openTasks} />
      <Metric label="Cancelled" value={totals.cancelledTasks} />
      <Metric label="Overdue" value={totals.overdueTasks} />
      <Metric label="Total planned hours" value={hours(totals.plannedMinutes)} />
    </section>
    <DashboardCharts statusData={(statusResult.data ?? []) as { name: string; tasks: number }[]} />
    <section className="card"><h2>Current import scope</h2><p>Task title, status, dates, description, parent IDs, assignee IDs, custom values, and effort are stored. People, timelogs, workflow definitions, and folder names will remain unavailable until their APIs are added in later steps.</p></section>
  </AppShell>;
}
