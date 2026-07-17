import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Pagination } from "@/components/pagination";
import { ReportFilters } from "@/components/report-filters";
import { taskFolderLabels } from "@/components/task-metadata";
import { requireContext } from "@/lib/auth";
import { hours } from "@/lib/metrics";
import { loadTaskRows } from "@/lib/reporting/data";
import { parseReportingFilters } from "@/lib/reporting/filters";
import { loadCustomFieldOptions } from "@/lib/reporting/options";

export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filters = parseReportingFilters(await searchParams);
  const { supabase } = await requireContext();
  const [tasks, statusOptionsResult, customFields] = await Promise.all([
    loadTaskRows(supabase, filters),
    supabase.rpc("reporting_task_status_summary", { filters: {} }),
    loadCustomFieldOptions(supabase)
  ]);
  const statuses = ((statusOptionsResult.data ?? []) as { name: string }[]).map((row) => row.name).filter(Boolean).sort();
  const total = tasks[0]?.total_count ?? 0;

  return <AppShell>
    <header className="page-header"><div><p className="eyebrow">TASKS</p><h1>Imported Wrike tasks</h1><p>Folder IDs remain available internally while readable Wrike titles are shown here.</p></div></header>
    <ReportFilters filters={filters} statuses={statuses} customFields={customFields} taskOnly />
    {tasks.length ? <>
      <table><thead><tr><th>Task</th><th>Status</th><th>Assignees</th><th>Folders</th><th>Due</th><th>Planned</th><th>Last updated</th></tr></thead><tbody>{tasks.map((task) => <tr key={task.task_id}>
        <td><Link href={`/tasks/${task.task_id}`}>{task.title}</Link></td>
        <td>{task.status_name}</td>
        <td>{task.responsible_users.map((user) => user.fullName).join(", ") || "—"}</td>
        <td>{taskFolderLabels(task.locations.map((location) => ({ id: location.wrikeId, title: location.title, scope: location.scope, resolved: location.resolved }))).join(", ") || "—"}</td>
        <td>{task.due_date ?? "—"}</td>
        <td>{task.planned_minutes == null ? "—" : `${hours(task.planned_minutes)} h`}</td>
        <td>{task.updated_at_wrike ? new Date(task.updated_at_wrike).toLocaleDateString() : "—"}</td>
      </tr>)}</tbody></table>
      <Pagination filters={filters} total={total} />
    </> : <p className="card empty">No imported tasks match these filters. If no import has run, go to Administration and select Import folder tasks and timelogs.</p>}
  </AppShell>;
}
