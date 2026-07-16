"use client";
import { useState } from "react";

type Connection = { status: string; account_name: string | null; api_host: string | null; token_expires_at: string | null; updated_at: string } | null;
type FolderRun = { id: string; status: string; folder_counts: Record<string, number>; task_count: number; error_summary: string | null; created_at: string };
type Props = { connection: Connection; folderRuns: FolderRun[]; folderIds: readonly string[] };

export function AdminPanel({ connection, folderRuns, folderIds }: Props) {
  const connected = connection?.status === "connected";
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [importing, setImporting] = useState(false);
  const [complete, setComplete] = useState(false);

  async function importFolderTasks() {
    setImporting(true); setComplete(false); setError(false);
    setMessage("Fetching all 13 Wrike folder task endpoints. Existing Wrike-derived data will be reset only after every GET succeeds.");
    try {
      const response = await fetch("/api/wrike/import-folder-tasks", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Folder task import failed.");
      setComplete(true);
      setMessage(`Import complete: ${payload.taskCount} unique tasks saved from ${payload.folderCount} folders.`);
    } catch (reason) {
      setError(true);
      setMessage(reason instanceof Error ? reason.message : "Folder task import failed.");
    } finally { setImporting(false); }
  }

  async function health() {
    setError(false);
    try {
      const response = await fetch("/api/wrike/health"); const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Health check failed.");
      setMessage(`Wrike connection is healthy: ${payload.account?.name ?? "account"} via ${payload.apiHost} (${payload.latencyMs} ms).`);
    } catch (reason) { setError(true); setMessage(reason instanceof Error ? reason.message : "Health check failed."); }
  }

  return <div className="admin-stack">
    {message && <p className={error ? "notice error" : "notice"}>{message}</p>}
    <section className="card space-import-card">
      <div><p className="eyebrow">TASK API — STEP 1</p><h2>Reset and import folder tasks</h2><p>This is the only enabled import. It calls Wrike’s folder task GET endpoint with descendants, subtasks, optional task fields, and pagination. It does not call timelogs, contacts, folders, workflows, or custom-field definition APIs.</p></div>
      <div className="space-import-actions"><button onClick={importFolderTasks} disabled={!connected || importing}>{importing ? "Importing folder tasks…" : "Reset and import folder tasks"}</button></div>
      {!connected && <p className="notice error">Connect Wrike before importing tasks.</p>}
      {complete && <div className="filter-bar compact"><a className="button" href="/tasks">View imported tasks</a></div>}
    </section>
    <div className="admin-grid">
      <section className="card"><h2>Wrike connection</h2>{connected ? <><p>Connected to <strong>{connection?.account_name ?? "Wrike"}</strong>.</p><p className="muted">Host: {connection?.api_host}<br />Token expires: {connection?.token_expires_at ? new Date(connection.token_expires_at).toLocaleString() : "unknown"}</p><div className="filter-bar"><button className="secondary" onClick={health}>Run health check</button><button className="secondary" onClick={async () => { await fetch("/api/wrike/disconnect", { method: "POST" }); location.reload(); }}>Disconnect</button></div></> : <><p>Connect Wrike with read-only access before importing tasks.</p><a className="button" href="/api/wrike/connect">Connect Wrike</a></>}</section>
      <section className="card"><h2>Configured folder allowlist</h2><p className="muted">Only these Wrike folder IDs are queried.</p><ol className="detail-list">{folderIds.map((folderId) => <li key={folderId}><code>{folderId}</code></li>)}</ol></section>
    </div>
    <section className="card"><h2>Folder task import history</h2>{folderRuns.length ? <table><thead><tr><th>Imported</th><th>Status</th><th>Unique tasks</th><th>Folder responses</th></tr></thead><tbody>{folderRuns.map((run) => <tr key={run.id}><td>{new Date(run.created_at).toLocaleString()}</td><td>{run.status}</td><td>{run.task_count}</td><td>{run.error_summary ?? Object.entries(run.folder_counts ?? {}).map(([id,count]) => `${id}: ${count}`).join(", ")}</td></tr>)}</tbody></table> : <p className="empty">No focused folder task import has completed yet.</p>}</section>
  </div>;
}
