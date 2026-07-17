"use client";
import { useState } from "react";

type Connection = { status: string; account_name: string | null; api_host: string | null; token_expires_at: string | null; updated_at: string } | null;
type SearchAttempt = { query: string | null; path: string; returnedCount: number; returnedTitles: string[]; containsExpectedField: boolean };
type MetadataDiagnostics = { folderRequest?: string; folderResponseKind?: string; customFieldSearches?: SearchAttempt[]; unfilteredFallbackRequired?: boolean; matchingRule?: string; matchedFieldTitles?: string[] };
type FolderRun = {
  id: string;
  status: string;
  folder_counts: Record<string, number>;
  task_count: number;
  folder_definition_count: number;
  custom_field_definition_count: number;
  metadata_diagnostics: MetadataDiagnostics;
  error_summary: string | null;
  created_at: string;
};
type ConfiguredFolder = { id: string; title: string | null };
type Props = { connection: Connection; folderRuns: FolderRun[]; folders: ConfiguredFolder[] };

export function AdminPanel({ connection, folderRuns, folders }: Props) {
  const connected = connection?.status === "connected";
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [importing, setImporting] = useState(false);
  const [complete, setComplete] = useState(false);

  async function importFolderTasks() {
    setImporting(true); setComplete(false); setError(false);
    setMessage("Validating the Wrike folder tree, both LCT title searches, and all 13 paginated task endpoints. Existing reporting data remains unchanged until every response succeeds.");
    try {
      const response = await fetch("/api/wrike/import-folder-tasks", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Folder task import failed.");
      setComplete(true);
      const fields = (payload.matchedCustomFieldTitles as string[] | undefined)?.join(", ") || "none";
      setMessage(`Import complete: ${payload.taskCount} unique tasks, ${payload.folderDefinitionCount} folder definitions, and ${payload.customFieldDefinitionCount} LCT fields (${fields}).`);
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
      <div><p className="eyebrow">TASK METADATA — CURRENT STAGE</p><h2>Reset and import folder tasks</h2><p>This single action calls the Learning folder-tree endpoint, the encoded <code>[LCT]</code> and <code>LCT</code> custom-field searches, and the 13 configured folder-task endpoints. It does not call timelogs, contacts, or workflows.</p></div>
      <div className="space-import-actions"><button onClick={importFolderTasks} disabled={!connected || importing}>{importing ? "Importing and resolving metadata…" : "Reset and import folder tasks"}</button></div>
      {!connected && <p className="notice error">Connect Wrike before importing tasks.</p>}
      {complete && <div className="filter-bar compact"><a className="button" href="/tasks">View imported tasks</a></div>}
    </section>
    <div className="admin-grid">
      <section className="card"><h2>Wrike connection</h2>{connected ? <><p>Connected to <strong>{connection?.account_name ?? "Wrike"}</strong>.</p><p className="muted">Host: {connection?.api_host}<br />Token expires: {connection?.token_expires_at ? new Date(connection.token_expires_at).toLocaleString() : "unknown"}</p><div className="filter-bar"><button className="secondary" onClick={health}>Run health check</button><button className="secondary" onClick={async () => { await fetch("/api/wrike/disconnect", { method: "POST" }); location.reload(); }}>Disconnect</button></div></> : <><p>Connect Wrike with read-only access before importing tasks.</p><a className="button" href="/api/wrike/connect">Connect Wrike</a></>}</section>
      <section className="card"><h2>Configured folder allowlist</h2><p className="muted">Only these task-source folders are queried.</p><ol className="detail-list">{folders.map((folder) => <li key={folder.id}>{folder.title ? <><strong>{folder.title}</strong><br /><code>{folder.id}</code></> : <code>{folder.id}</code>}</li>)}</ol></section>
    </div>
    <section className="card"><h2>Import history and metadata diagnostics</h2>{folderRuns.length ? <table><thead><tr><th>Imported</th><th>Status</th><th>Tasks</th><th>Metadata</th><th>Search evidence</th></tr></thead><tbody>{folderRuns.map((run) => <tr key={run.id}><td>{new Date(run.created_at).toLocaleString()}</td><td>{run.status}</td><td>{run.task_count}</td><td>{run.folder_definition_count} folders<br />{run.custom_field_definition_count} LCT fields</td><td>{run.error_summary ?? <MetadataEvidence diagnostics={run.metadata_diagnostics} />}</td></tr>)}</tbody></table> : <p className="empty">No folder task and metadata import has completed yet.</p>}</section>
  </div>;
}

function MetadataEvidence({ diagnostics }: { diagnostics: MetadataDiagnostics }) {
  const searches = diagnostics?.customFieldSearches ?? [];
  return <details><summary>{diagnostics?.matchedFieldTitles?.join(", ") || "View searches"}</summary><p><strong>Folder request:</strong> {diagnostics?.folderRequest ?? "—"}</p>{searches.map((search) => <p key={search.path}><strong>{search.query ?? "Unfiltered"}:</strong> {search.returnedCount} returned ({search.returnedTitles.join(", ") || "no titles"}); expected field {search.containsExpectedField ? "found" : "not found"}.</p>)}<p><strong>Unfiltered fallback:</strong> {diagnostics?.unfilteredFallbackRequired ? "required" : "not required"}<br /><strong>Local rule:</strong> {diagnostics?.matchingRule ?? "—"}</p></details>;
}
