import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Pagination } from "@/components/pagination";
import { ReportFilters } from "@/components/report-filters";
import { requireContext } from "@/lib/auth";
import { loadTaskRows } from "@/lib/reporting/data";
import { parseReportingFilters } from "@/lib/reporting/filters";
import { hours } from "@/lib/metrics";

export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filters = parseReportingFilters(await searchParams);
  const { supabase, profile } = await requireContext();
  const [tasks, statusOptionsResult] = await Promise.all([
    loadTaskRows(supabase, filters),
    supabase.from("wrike_tasks").select("status").eq("organization_id", profile.organization_id).eq("is_deleted", false).limit(5000)
  ]);
  const taskIds = tasks.map((task) => task.task_id);
  const mappingResult = taskIds.length
    ? await supabase.from("wrike_folder_task_imports").select("task_id,folder_wrike_id").in("task_id", taskIds)
    : { data: [] as { task_id: string; folder_wrike_id: string }[] };
  const sourceIds = new Map<string, string[]>();
  for (const mapping of mappingResult.data ?? []) sourceIds.set(mapping.task_id, [...(sourceIds.get(mapping.task_id) ?? []), mapping.folder_wrike_id]);
  const statuses = [...new Set((statusOptionsResult.data ?? []).map((row) => row.status).filter(Boolean))].sort();
  const total = tasks[0]?.total_count ?? 0;

  return <AppShell>
    <header className="page-header"><div><p className="eyebrow">TASKS</p><h1>Imported Wrike tasks</h1><p>Each row was returned by at least one of the 13 configured folder endpoints.</p></div></header>
    <ReportFilters filters={filters} statuses={statuses} taskOnly />
    {tasks.length ? <>
      <table><thead><tr><th>Task</th><th>Status</th><th>Source folder ID</th><th>Due</th><th>Planned</th><th>Last updated</th></tr></thead><tbody>{tasks.map((task) => <tr key={task.task_id}>
        <td><Link href={`/tasks/${task.task_id}`}>{task.title}</Link></td>
        <td>{task.status}</td>
        <td>{(sourceIds.get(task.task_id) ?? []).join(", ") || "—"}</td>
        <td>{task.due_date ?? "—"}</td>
        <td>{task.planned_minutes == null ? "—" : `${hours(task.planned_minutes)} h`}</td>
        <td>{task.updated_at_wrike ? new Date(task.updated_at_wrike).toLocaleDateString() : "—"}</td>
      </tr>)}</tbody></table>
      <Pagination filters={filters} total={total} />
    </> : <p className="card empty">No imported tasks match these filters. If no import has run, go to Administration and select Reset and import folder tasks.</p>}
  </AppShell>;
}
