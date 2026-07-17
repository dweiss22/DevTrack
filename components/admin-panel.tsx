"use client";
import { useState } from "react";

type Connection = { status: string; account_name: string | null; api_host: string | null; oauth_scopes: string[] | null; token_expires_at: string | null; updated_at: string } | null;
type SearchAttempt = { query: string | null; path: string; returnedCount: number; returnedTitles: string[]; containsExpectedField: boolean };
type MetadataDiagnostics = { folderRequest?: string; folderResponseKind?: string; customFieldSearches?: SearchAttempt[]; unfilteredFallbackRequired?: boolean; matchingRule?: string; matchedFieldTitles?: string[] };
type ReferenceDiagnostics = {
  workflow?: { found?: boolean; statusesUpserted?: number; failed?: boolean };
  users?: { requested?: number; received?: number; upserted?: number; failedIds?: string[]; nameMismatches?: { wrikeUserId: string; expectedName: string; returnedName: string }[] };
  categories?: { requests?: number; received?: number; upserted?: number; failed?: boolean };
  failures?: { operation: string; wrikeId: string | null; status: number | null; message: string }[];
};
type FolderRun = {
  id: string; status: string; folder_counts: Record<string, number>; timelog_folder_counts: Record<string, number>;
  task_count: number; unique_timelog_count: number; task_request_count: number; timelog_request_count: number;
  failed_folder_request_count: number; folder_failures: FolderFailure[]; duration_ms: number | null;
  folder_definition_count: number; custom_field_definition_count: number; metadata_diagnostics: MetadataDiagnostics;
  timelog_descendant_strategy: "unknown" | "folder_recursive" | "explicit_tree"; timelog_descendant_diagnostics: Record<string, unknown>;
  reference_data_diagnostics: ReferenceDiagnostics; reference_warning_count: number; error_summary: string | null; created_at: string;
  custom_field_conflict_count: number; custom_field_normalization_diagnostics: { logicalFieldCount?: number; normalizedTaskValueCount?: number; conflictCount?: number };
};
type ConfiguredFolder = { id: string; title: string };
type FolderFailure = { operation: string; folderId: string; folderTitle: string; requestFolderId: string; status: number | null; message: string };
type Props = { connection: Connection; folderRuns: FolderRun[]; folders: ConfiguredFolder[] };

export function AdminPanel({ connection, folderRuns, folders }: Props) {
  const connected = connection?.status === "connected";
  const needsUserScope = connected && !connection?.oauth_scopes?.includes("amReadOnlyUser");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [importing, setImporting] = useState(false);
  const [complete, setComplete] = useState(false);

  async function importFolderTasks() {
    setImporting(true); setComplete(false); setError(false);
    setMessage("Refreshing people, workflow statuses, timelog categories, folder metadata, tasks, and timelogs. Existing reporting data remains unchanged until every selected-folder response succeeds.");
    try {
      const response = await fetch("/api/wrike/import-folder-tasks", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) {
        const failures = (payload.folderFailures as FolderFailure[] | undefined) ?? [];
        const detail = failures.map((failure) => `${failure.folderTitle} ${failure.operation} (${failure.status ?? "network"}): ${failure.message}`).join("; ");
        throw new Error(`${payload.error ?? "Folder task and timelog import failed."}${detail ? ` ${detail}` : ""}`);
      }
      setComplete(true);
      const fields = (payload.matchedCustomFieldTitles as string[] | undefined)?.join(", ") || "none";
      const refs = payload.referenceDataDiagnostics as ReferenceDiagnostics | undefined;
      setMessage(`Import complete: ${payload.taskCount} unique tasks, ${payload.timelogCount} unique timelogs, ${refs?.users?.received ?? 0} Wrike users, ${refs?.categories?.received ?? 0} timelog categories, and ${refs?.workflow?.statusesUpserted ?? 0} workflow statuses. ${payload.referenceWarningCount ?? 0} reference warning(s); ${payload.customFieldConflictCount ?? 0} custom-field conflict(s). LCT fields: ${fields}. Descendant timelogs: ${payload.descendantStrategy}.`);
    } catch (reason) {
      setError(true); setMessage(reason instanceof Error ? reason.message : "Folder task and timelog import failed.");
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
      <div><p className="eyebrow">WRIKE DATA — CURRENT STAGE</p><h2>Import folder tasks and timelogs</h2><p>This action refreshes people, workflow statuses, timelog categories, folder metadata, LCT fields, tasks, and timelogs. Reference failures remain visible warnings; selected-folder failures stop reconciliation.</p></div>
      <div className="space-import-actions"><button onClick={importFolderTasks} disabled={!connected || importing}>{importing ? "Importing tasks and timelogs…" : "Import folder tasks and timelogs"}</button></div>
      {!connected && <p className="notice error">Connect Wrike before importing folder data.</p>}
      {needsUserScope && <p className="notice error">Reconnect Wrike to grant <code>amReadOnlyUser</code>. Tasks and timelogs can still import, but authoritative user details cannot refresh. <a href="/api/wrike/connect">Reconnect Wrike</a></p>}
      {complete && <div className="filter-bar compact"><a className="button" href="/tasks">View imported tasks</a></div>}
    </section>
    <div className="admin-grid">
      <section className="card"><h2>Wrike connection</h2>{connected ? <><p>Connected to <strong>{connection?.account_name ?? "Wrike"}</strong>.</p><p className="muted">Host: {connection?.api_host}<br />Scopes: {connection?.oauth_scopes?.join(", ") || "wsReadOnly (legacy connection)"}<br />Token expires: {connection?.token_expires_at ? new Date(connection.token_expires_at).toLocaleString() : "unknown"}</p><div className="filter-bar"><button className="secondary" onClick={health}>Run health check</button><a className="button secondary" href="/api/wrike/connect">Reconnect</a><button className="secondary" onClick={async () => { await fetch("/api/wrike/disconnect", { method: "POST" }); location.reload(); }}>Disconnect</button></div></> : <><p>Connect Wrike with read-only access before importing folder data.</p><a className="button" href="/api/wrike/connect">Connect Wrike</a></>}</section>
      <section className="card"><h2>Configured folder allowlist</h2><p className="muted">Only these task and timelog source folders are queried.</p><ol className="detail-list">{folders.map((folder) => <li key={folder.id}><strong>{folder.title}</strong><br /><code>{folder.id}</code></li>)}</ol></section>
    </div>
    <section className="card"><h2>Combined import history</h2>{folderRuns.length ? <table><thead><tr><th>Started</th><th>Status</th><th>Records</th><th>Requests</th><th>Diagnostics</th></tr></thead><tbody>{folderRuns.map((run) => <tr key={run.id}><td>{new Date(run.created_at).toLocaleString()}<br />{run.duration_ms != null ? `${run.duration_ms} ms` : "Running"}</td><td>{run.status}<br />{run.reference_warning_count ?? 0} warning(s)<br />{run.custom_field_conflict_count ?? 0} field conflict(s)</td><td>{run.task_count} tasks<br />{run.unique_timelog_count} timelogs</td><td>{run.task_request_count} task<br />{run.timelog_request_count} timelog</td><td>{run.error_summary ? <>{run.error_summary}<FailureDetails failures={run.folder_failures} /></> : <><span>Descendants: {run.timelog_descendant_strategy}</span><br /><span>Logical custom fields: {run.custom_field_normalization_diagnostics?.logicalFieldCount ?? 0}; values: {run.custom_field_normalization_diagnostics?.normalizedTaskValueCount ?? 0}</span><br /><ReferenceEvidence diagnostics={run.reference_data_diagnostics} /><br /><MetadataEvidence diagnostics={run.metadata_diagnostics} /></>}</td></tr>)}</tbody></table> : <p className="empty">No combined folder import has run yet.</p>}</section>
  </div>;
}

function FailureDetails({ failures }: { failures: FolderFailure[] }) {
  if (!failures?.length) return null;
  return <details><summary>{failures.length} folder request failure(s)</summary>{failures.map((failure, index) => <p key={`${failure.requestFolderId}-${failure.operation}-${index}`}><strong>{failure.folderTitle}:</strong> {failure.operation} request for <code>{failure.requestFolderId}</code> returned {failure.status ?? "a network error"}. {failure.message}</p>)}</details>;
}

function ReferenceEvidence({ diagnostics }: { diagnostics: ReferenceDiagnostics }) {
  const users = diagnostics?.users; const categories = diagnostics?.categories; const workflow = diagnostics?.workflow;
  return <details><summary>Reference data</summary><p><strong>Users:</strong> {users?.received ?? 0}/{users?.requested ?? 0} retrieved; {(users?.failedIds ?? []).length} failed.<br /><strong>Categories:</strong> {categories?.received ?? 0} retrieved{categories?.failed ? " (request warning)" : ""}.<br /><strong>Workflow statuses:</strong> {workflow?.statusesUpserted ?? 0} saved{workflow?.failed ? " (request warning)" : ""}.</p>{(users?.failedIds ?? []).length > 0 && <p><strong>Failed user IDs:</strong> {users?.failedIds?.join(", ")}</p>}{(users?.nameMismatches ?? []).map((mismatch) => <p key={mismatch.wrikeUserId}><code>{mismatch.wrikeUserId}</code>: expected {mismatch.expectedName}; Wrike returned {mismatch.returnedName}.</p>)}{(diagnostics?.failures ?? []).map((failure, index) => <p key={`${failure.operation}-${failure.wrikeId}-${index}`}><strong>{failure.operation}:</strong> {failure.wrikeId && <><code>{failure.wrikeId}</code> </>}{failure.status ?? "local/network"} — {failure.message}</p>)}</details>;
}

function MetadataEvidence({ diagnostics }: { diagnostics: MetadataDiagnostics }) {
  const searches = diagnostics?.customFieldSearches ?? [];
  return <details><summary>{diagnostics?.matchedFieldTitles?.join(", ") || "View searches"}</summary><p><strong>Folder request:</strong> {diagnostics?.folderRequest ?? "—"}</p>{searches.map((search) => <p key={search.path}><strong>{search.query ?? "Unfiltered"}:</strong> {search.returnedCount} returned ({search.returnedTitles.join(", ") || "no titles"}); expected field {search.containsExpectedField ? "found" : "not found"}.</p>)}<p><strong>Unfiltered fallback:</strong> {diagnostics?.unfilteredFallbackRequired ? "required" : "not required"}<br /><strong>Local rule:</strong> {diagnostics?.matchingRule ?? "—"}</p></details>;
}
