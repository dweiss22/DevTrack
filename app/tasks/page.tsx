import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Pagination } from "@/components/pagination";
import { ReportFilters } from "@/components/report-filters";
import { StatusBadge, UnresolvedReferenceLabel } from "@/components/wrike-reference";
import { requireContext } from "@/lib/auth";
import { hours } from "@/lib/metrics";
import { loadTaskRows } from "@/lib/reporting/data";
import { parseReportingFilters } from "@/lib/reporting/filters";
import { loadCustomFieldOptions, loadStatusOptions } from "@/lib/reporting/options";

export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filters = parseReportingFilters(await searchParams);
  const { supabase, profile } = await requireContext();
  const [tasks, statuses, customFields] = await Promise.all([
    loadTaskRows(supabase, filters),
    loadStatusOptions(supabase, profile.organization_id),
    loadCustomFieldOptions(supabase)
  ]);
  const total = tasks[0]?.total_count ?? 0;

  return <AppShell>
    <header className="page-header"><div><p className="eyebrow">TASKS</p><h1>Imported Wrike tasks</h1><p>Wrike references are resolved locally; unresolved IDs are clearly identified until a later import or administrator correction resolves them.</p></div></header>
    <ReportFilters filters={filters} statuses={statuses} customFields={customFields} taskOnly />
    {tasks.length ? <>
      <table><thead><tr><th>Task</th><th>Status</th><th>Assignees</th><th>Folders</th><th>Due</th><th>Planned</th><th>Last updated</th></tr></thead><tbody>{tasks.map((task) => <tr key={task.task_id}>
        <td><Link href={`/tasks/${task.task_id}`}>{task.title}</Link></td>
        <td><StatusBadge name={task.status_name} id={task.custom_status_id} color={task.status_reference.color} resolved={task.status_reference.resolved} /></td>
        <td>{task.responsible_users.length ? task.responsible_users.map((user, index) => <span key={user.wrikeUserId}>{index > 0 && ", "}{user.resolved ? user.fullName : <UnresolvedReferenceLabel id={user.wrikeUserId} type="user" />}</span>) : "—"}</td>
        <td>{task.locations.length ? task.locations.map((location, index) => <span key={location.wrikeId}>{index > 0 && ", "}{location.resolved ? location.title : <UnresolvedReferenceLabel id={location.wrikeId} type="folder" />}</span>) : "—"}</td>
        <td>{task.due_date ?? "—"}</td>
        <td>{task.planned_minutes == null ? "—" : `${hours(task.planned_minutes)} h`}</td>
        <td>{task.updated_at_wrike ? new Date(task.updated_at_wrike).toLocaleDateString() : "—"}</td>
      </tr>)}</tbody></table>
      <Pagination filters={filters} total={total} />
    </> : <p className="card empty">No imported tasks match these filters. If no import has run, go to Administration and select Import folder tasks and timelogs.</p>}
  </AppShell>;
}
