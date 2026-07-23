import Link from "next/link";
import { StatusBadge } from "@/components/wrike-reference";

export type SmeDashboardUser = {
  application_user_id: string;
  display_name: string;
  wrike_user_id: string | null;
  wrike_display_name: string | null;
  mapping_status: "mapped" | "missing" | "ambiguous";
};
export type SmeDashboardRow = {
  task_id: string;
  title: string;
  status_name: string;
  status_classification: string;
  due_date: string | null;
  completed_at: string | null;
  actual_minutes: number;
  folder_context: string;
  updated_at_wrike: string | null;
  is_overdue: boolean;
};

function hours(minutes: number) {
  return `${(minutes / 60).toFixed(1)}h`;
}

export function SmeDashboard({ users, selected, rows, canSelect }: { users: SmeDashboardUser[]; selected: SmeDashboardUser | null; rows: SmeDashboardRow[]; canSelect: boolean }) {
  const completed = rows.filter((row) => row.completed_at || row.status_classification === "completed").length;
  const active = rows.filter((row) => !row.completed_at && row.status_classification === "active").length;
  const attention = rows.filter((row) => row.is_overdue || row.status_classification === "stalled_or_canceled").length;
  const minutes = rows.reduce((total, row) => total + Number(row.actual_minutes || 0), 0);
  const statusCounts = [...rows.reduce((counts, row) => counts.set(row.status_name, (counts.get(row.status_name) ?? 0) + 1), new Map<string, number>())];

  return <>
    <section className="card sme-selector-card">
      <form method="get">
        <label>SME<select name="sme" defaultValue={selected?.application_user_id ?? ""} disabled={!canSelect}>
          {!selected && <option value="">Select an SME</option>}
          {users.map((user) => <option key={user.application_user_id} value={user.application_user_id}>{user.display_name}</option>)}
        </select></label>
        {canSelect && <button>View dashboard</button>}
      </form>
      {selected && <p className="muted">Showing assigned work for <strong>{selected.display_name}</strong>{selected.wrike_display_name ? `, mapped to ${selected.wrike_display_name}` : ""}.</p>}
    </section>
    {!selected ? <p className="card empty">{users.length ? "Select an SME to view assigned work." : "No SME application users are available in this organization."}</p>
      : selected.mapping_status !== "mapped" ? <p className="card empty">This SME does not have a verified synchronized identity mapping. An administrator can map the account in User Management; no task data is shown until then.</p>
      : <>
        <div className="metric-grid sme-metrics">
          <article className="card metric-card"><span>Assigned tasks</span><strong>{rows.length}</strong></article>
          <article className="card metric-card"><span>Active / in progress</span><strong>{active}</strong></article>
          <article className="card metric-card"><span>Completed</span><strong>{completed}</strong></article>
          <article className="card metric-card"><span>Needs attention</span><strong>{attention}</strong></article>
          <article className="card metric-card"><span>Logged time</span><strong>{hours(minutes)}</strong></article>
        </div>
        {statusCounts.length ? <section className="card"><h2>Current status distribution</h2><div className="status-count-list">{statusCounts.map(([status, count]) => <span key={status}><StatusBadge name={status} /> <strong>{count}</strong></span>)}</div></section> : null}
        {rows.length ? <div className="admin-table-wrap"><table><thead><tr><th>Course / task</th><th>Status</th><th>Project / folder</th><th>Due</th><th>Completed</th><th>Logged time</th><th>Last synchronized</th></tr></thead><tbody>{rows.map((row) => <tr key={row.task_id}><td>{canSelect ? <Link href={`/projects/${row.task_id}`}>{row.title}</Link> : row.title}</td><td><StatusBadge name={row.status_name} />{row.is_overdue ? <><br /><span className="error">Overdue</span></> : null}</td><td>{row.folder_context}</td><td>{row.due_date ? new Date(`${row.due_date}T00:00:00`).toLocaleDateString() : "—"}</td><td>{row.completed_at ? new Date(row.completed_at).toLocaleDateString() : "—"}</td><td>{hours(Number(row.actual_minutes))}</td><td>{row.updated_at_wrike ? new Date(row.updated_at_wrike).toLocaleString() : "—"}</td></tr>)}</tbody></table></div> : <p className="card empty">No synchronized tasks are assigned to this SME.</p>}
      </>}
  </>;
}
