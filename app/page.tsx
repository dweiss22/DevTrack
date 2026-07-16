import { AppShell } from "@/components/app-shell";
import { DashboardCharts } from "@/components/dashboard-charts";
import { ReportFilters } from "@/components/report-filters";
import { requireContext } from "@/lib/auth";
import { filtersForRpc, parseReportingFilters } from "@/lib/reporting/filters";
import { loadTimeSummary } from "@/lib/reporting/data";
import { loadReportingOptions } from "@/lib/reporting/options";
import { hours } from "@/lib/metrics";

function Metric({ label, value }: { label: string; value: string | number }) { return <article className="card metric"><p>{label}</p><strong>{value}</strong></article>; }
type Metrics = { trackedTasks: number; completedTasks: number; cancelledTasks: number; openTasks: number; overdueTasks: number; totalMinutes: number; plannedMinutes: number; noTimeTasks: number; overPlanTasks: number };
export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filters = parseReportingFilters(await searchParams); const { supabase, profile } = await requireContext(); const rpcFilters = filtersForRpc(filters);
  const [metricsResult, statusResult, memberSummary, options, lastRunResult] = await Promise.all([
    supabase.rpc("reporting_task_metrics", { filters: rpcFilters }),
    supabase.rpc("reporting_task_status_summary", { filters: rpcFilters }),
    loadTimeSummary(supabase, filters, "person"),
    loadReportingOptions(supabase, profile.organization_id),
    supabase.from("wrike_sync_runs").select("completed_at").eq("organization_id", profile.organization_id).in("status", ["succeeded", "partial"]).order("completed_at", { ascending: false }).limit(1).maybeSingle()
  ]);
  const totals = (metricsResult.data ?? { trackedTasks: 0, completedTasks: 0, cancelledTasks: 0, openTasks: 0, overdueTasks: 0, totalMinutes: 0, plannedMinutes: 0, noTimeTasks: 0, overPlanTasks: 0 }) as Metrics;
  return <AppShell lastSynced={lastRunResult.data?.completed_at}><header className="page-header"><div><p className="eyebrow">REPORTING OVERVIEW</p><h1>Team delivery at a glance</h1><p>All metrics reflect your reporting groups and the active filters.</p></div><a className="button" href="/admin">Sync Wrike data</a></header><ReportFilters filters={filters} {...options} /><section className="metric-grid"><Metric label="Tracked tasks" value={totals.trackedTasks} /><Metric label="Completed" value={totals.completedTasks} /><Metric label="Open" value={totals.openTasks} /><Metric label="Cancelled" value={totals.cancelledTasks} /><Metric label="Overdue" value={totals.overdueTasks} /><Metric label="Recorded hours" value={hours(totals.totalMinutes)} /><Metric label="Planned vs actual" value={`${hours(totals.plannedMinutes)} / ${hours(totals.totalMinutes)} h`} /><Metric label="No recorded time" value={totals.noTimeTasks} /><Metric label="Over estimate" value={totals.overPlanTasks} /></section><DashboardCharts statusData={(statusResult.data ?? []) as { name: string; tasks: number }[]} memberData={memberSummary.slice(0, 20).map((row) => ({ name: row.label, hours: hours(row.minutes) }))} /><section className="card"><h2>Metric definitions</h2><p>Open tasks use Wrike’s Active or Deferred status groups. Overdue tasks are open with a due date before today. Actual effort is visible timelog time by tracked date; planned effort is Wrike total effort.</p></section></AppShell>;
}
