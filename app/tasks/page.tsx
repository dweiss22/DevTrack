import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Pagination } from "@/components/pagination";
import { ReportFilters } from "@/components/report-filters";
import { requireContext } from "@/lib/auth";
import { loadTaskRows } from "@/lib/reporting/data";
import { parseReportingFilters } from "@/lib/reporting/filters";
import { loadReportingOptions } from "@/lib/reporting/options";
import { hours } from "@/lib/metrics";

export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const values = await searchParams; const filters = parseReportingFilters(values); const { supabase, profile } = await requireContext();
  const [tasks, options] = await Promise.all([
    loadTaskRows(supabase, filters),
    loadReportingOptions(supabase, profile.organization_id)
  ]);
  const total = tasks[0]?.total_count ?? 0;
  return <AppShell><header className="page-header"><div><p className="eyebrow">TASKS</p><h1>Tracked work</h1><p>Filters and totals are restricted by your reporting groups.</p></div></header><ReportFilters filters={filters} {...options} />{tasks.length ? <><table><thead><tr><th>Task</th><th>Status</th><th>Assignees</th><th>Due</th><th>Planned</th><th>Actual</th><th>Last updated</th></tr></thead><tbody>{tasks.map((task) => <tr key={task.task_id}><td><Link href={`/tasks/${task.task_id}`}>{task.title}</Link></td><td>{task.status}</td><td>{task.assignees.map((item) => item.name).join(", ") || "Unassigned"}</td><td>{task.due_date ?? "—"}</td><td>{task.planned_minutes == null ? "—" : `${hours(task.planned_minutes)} h`}</td><td>{hours(task.actual_minutes)} h</td><td>{task.updated_at_wrike ? new Date(task.updated_at_wrike).toLocaleDateString() : "—"}</td></tr>)}</tbody></table><Pagination filters={filters} total={total} /></> : <p className="card empty">No visible tasks match these filters.</p>}</AppShell>;
}
