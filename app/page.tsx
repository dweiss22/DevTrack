import { AppShell } from "@/components/app-shell";
import { DashboardCharts } from "@/components/dashboard-charts";
import { requireContext } from "@/lib/auth";
import { hours, overview, type ReportingTask } from "@/lib/metrics";

function Metric({ label, value, note }: { label: string; value: string | number; note?: string }) { return <article className="card metric"><p>{label}</p><strong>{value}</strong>{note && <small>{note}</small>}</article>; }
export default async function Dashboard() {
  const { supabase, profile } = await requireContext();
  const [{ data: rawTasks }, { data: lastRun }] = await Promise.all([
    supabase.from("wrike_tasks").select("id,status,due_date,completed_at,planned_minutes,wrike_time_entries(minutes),wrike_task_assignees(user_id)").eq("organization_id", profile.organization_id).eq("is_deleted", false),
    supabase.from("wrike_sync_runs").select("completed_at").eq("organization_id", profile.organization_id).eq("status", "succeeded").order("completed_at", { ascending: false }).limit(1).maybeSingle()
  ]);
  const tasks = ((rawTasks ?? []) as unknown as { id: string; status: string; due_date: string | null; completed_at: string | null; planned_minutes: number | null; wrike_time_entries: { minutes: number }[]; wrike_task_assignees: { user_id: string }[] }[]).map((task): ReportingTask => ({ id: task.id, status: task.status, dueDate: task.due_date, completedAt: task.completed_at, plannedMinutes: task.planned_minutes, actualMinutes: task.wrike_time_entries.reduce((sum, entry) => sum + entry.minutes, 0), assignees: task.wrike_task_assignees.map((assignee) => assignee.user_id) }));
  const totals = overview(tasks); const statusData = Object.entries(tasks.reduce<Record<string, number>>((groups, task) => ({ ...groups, [task.status]: (groups[task.status] ?? 0) + 1 }), {})).map(([name, tasks]) => ({ name, tasks }));
  return <AppShell lastSynced={lastRun?.completed_at}><header className="page-header"><div><p className="eyebrow">REPORTING OVERVIEW</p><h1>Team delivery at a glance</h1><p>Tasks are counted once, even when shared; recorded time follows the time-entry date.</p></div><a className="button" href="/admin">Sync Wrike data</a></header><section className="metric-grid"><Metric label="Tracked tasks" value={totals.trackedTasks} /><Metric label="Completed" value={totals.completedTasks} /><Metric label="Active" value={totals.activeTasks} /><Metric label="Overdue" value={totals.overdueTasks} /><Metric label="Recorded hours" value={hours(totals.totalMinutes)} /><Metric label="Planned vs actual" value={`${hours(totals.plannedMinutes)} / ${hours(totals.totalMinutes)} h`} /><Metric label="No recorded time" value={totals.noTimeTasks} /><Metric label="Over estimate" value={totals.overPlanTasks} /></section><DashboardCharts statusData={statusData} memberData={[]} /><section className="card"><h2>Metric definitions</h2><p>Active tasks are non-completed tasks. Overdue tasks are active tasks with a due date before today. Planned effort uses Wrike’s available effort allocation; actual effort is the sum of synchronized time entries.</p></section></AppShell>;
}
