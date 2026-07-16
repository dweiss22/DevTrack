import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { TaskCustomFieldList, TaskFolderList } from "@/components/task-metadata";
import { requireContext } from "@/lib/auth";
import { hours } from "@/lib/metrics";
import type { ResolvedCustomField, ResolvedFolder } from "@/lib/wrike/metadata";

type TaskDetailRow = {
  title: string;
  status: string;
  description: string | null;
  permalink: string | null;
  due_date: string | null;
  completed_at: string | null;
  planned_minutes: number | null;
  allocated_minutes: number | null;
  raw_data: unknown;
  enriched_metadata: { folders?: ResolvedFolder[]; customFields?: ResolvedCustomField[] } | null;
  wrike_time_entries: { id: string; entry_date: string; minutes: number; comment: string | null; wrike_users: { display_name: string; email: string | null } | null }[];
  wrike_task_assignees: { wrike_users: { display_name: string } | null }[];
};

export default async function TaskDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, profile } = await requireContext();
  const { data: task } = await supabase.from("wrike_tasks").select("*,wrike_time_entries(id,entry_date,minutes,comment,wrike_users(display_name,email)),wrike_task_assignees(wrike_users(display_name))").eq("id", id).eq("organization_id", profile.organization_id).maybeSingle();
  if (!task) notFound();
  const row = task as unknown as TaskDetailRow;
  const folders = row.enriched_metadata?.folders ?? [];
  const customFields = row.enriched_metadata?.customFields ?? [];

  return <AppShell>
    <header className="page-header"><div><p className="eyebrow">TASK DETAIL</p><h1>{row.title}</h1><p>{row.status} · Due {row.due_date ?? "not set"}</p></div>{row.permalink && <a className="button" href={row.permalink} target="_blank" rel="noreferrer">Open in Wrike</a>}</header>
    <div className="admin-grid">
      <section className="card"><h2>Reporting details</h2><p><strong>Assignees:</strong> {row.wrike_task_assignees.map((item) => item.wrike_users?.display_name).filter(Boolean).join(", ") || "Unassigned"}</p><p><strong>Planned effort:</strong> {row.planned_minutes == null ? "Not available" : `${hours(row.planned_minutes)} hours`}</p><p><strong>Allocated effort:</strong> {row.allocated_minutes == null ? "Not available" : `${hours(row.allocated_minutes)} hours`}</p><p><strong>Completion:</strong> {row.completed_at ? new Date(row.completed_at).toLocaleString() : "Not completed"}</p><p>{row.description || "No task description supplied by Wrike."}</p></section>
      <section className="card"><h2>Wrike folders</h2><TaskFolderList folders={folders} /></section>
      <section className="card"><h2>LCT custom fields</h2><TaskCustomFieldList fields={customFields} /></section>
    </div>
    {profile.role === "admin" && <section className="card"><h2>Administrator: original Wrike metadata</h2><pre>{JSON.stringify(row.raw_data, null, 2)}</pre></section>}
    <section className="card"><h2>Visible time entries</h2>{row.wrike_time_entries.length ? <table><thead><tr><th>Date</th><th>Person</th><th>Hours</th><th>Comment</th></tr></thead><tbody>{row.wrike_time_entries.map((entry) => <tr key={entry.id}><td>{entry.entry_date}</td><td>{entry.wrike_users?.display_name ?? "Unknown"}</td><td>{hours(entry.minutes)}</td><td>{entry.comment ?? "—"}</td></tr>)}</tbody></table> : <p className="empty">No visible recorded time for this task.</p>}</section>
  </AppShell>;
}
