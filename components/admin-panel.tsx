"use client";
import { useEffect, useState, type ReactNode } from "react";
import { UnresolvedReferenceLabel } from "@/components/wrike-reference";

type Connection = { status: string; account_name: string | null; api_host: string | null; oauth_scopes: string[] | null; token_expires_at: string | null; updated_at: string } | null;
type SearchAttempt = { query: string | null; path: string; returnedCount: number; returnedTitles: string[]; containsExpectedField: boolean };
type MetadataDiagnostics = { folderRequest?: string; folderResponseKind?: string; customFieldSearches?: SearchAttempt[]; unfilteredFallbackRequired?: boolean; matchingRule?: string; matchedFieldTitles?: string[] };
type ReferenceDiagnostics = {
  workflow?: { found?: boolean; statusesUpserted?: number; failed?: boolean };
  spaces?: { received?: number; upserted?: number; failed?: boolean };
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
  task_custom_field_diagnostics?: Record<string, unknown>;
  unresolved_reference_count: number; reference_resolution_diagnostics: { unresolvedByType?: Record<string, number>; manualMappings?: number; ignoredCustomFields?: number };
};
type ConfiguredFolder = { id: string; title: string };
type FolderFailure = { operation: string; folderId: string; folderTitle: string; requestFolderId: string; status: number | null; message: string };
type UnresolvedReference = { id: string; reference_type: "custom_field" | "user" | "custom_status" | "workflow" | "folder" | "space" | "timelog_category"; wrike_id: string; sample_values: unknown[]; related_records: unknown[]; occurrence_count: number; resolution_attempts: number; first_encountered_at: string; last_encountered_at: string; last_attempted_at: string | null; last_error: string | null; resolution_status: string };
type RepairRun = { id: string; status: string; examined_count: number; repaired_count: number; unchanged_count: number; retained_count: number; still_incomplete_count: number; started_at: string; completed_at: string | null; error_summary: string | null };
type Props = { connection: Connection; folderRuns: FolderRun[]; folders: ConfiguredFolder[]; unresolvedReferences: UnresolvedReference[]; verticalDiagnostics: Record<string, unknown> | null; verticalDiagnosticsError: string | null; repairRuns: RepairRun[] };

export function AdminPanel({ connection, folderRuns, folders, unresolvedReferences, verticalDiagnostics, verticalDiagnosticsError, repairRuns }: Props) {
  const connected = connection?.status === "connected";
  const needsUserScope = connected && !connection?.oauth_scopes?.includes("amReadOnlyUser");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [importing, setImporting] = useState(false);
  const [complete, setComplete] = useState(false);
  const [clearingHistory, setClearingHistory] = useState(false);

  useEffect(() => {
    const savedMessage = sessionStorage.getItem("devtrack-data-message");
    if (!savedMessage) return;
    sessionStorage.removeItem("devtrack-data-message");
    setError(false);
    setMessage(savedMessage);
  }, []);

  function reloadWithMessage(nextMessage: string) {
    sessionStorage.setItem("devtrack-data-message", nextMessage);
    location.reload();
  }

  async function importFolderTasks() {
    setImporting(true); setComplete(false); setError(false);
    setMessage("Importing Wrike tasks, timelogs, and reference data…");
    try {
      const response = await fetch("/api/wrike/import-folder-tasks", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) {
        const failures = (payload.folderFailures as FolderFailure[] | undefined) ?? [];
        const detail = failures.map((failure) => `${failure.folderTitle} ${failure.operation} (${failure.status ?? "network"}): ${failure.message}`).join("; ");
        throw new Error(`${payload.error ?? "Folder task and timelog import failed."}${detail ? ` ${detail}` : ""}`);
      }
      setComplete(true);
      setMessage(`Import complete — ${payload.taskCount} tasks and ${payload.timelogCount} timelogs synchronized. ${payload.referenceWarningCount ?? 0} reference warnings; ${payload.customFieldConflictCount ?? 0} field conflicts.`);
    } catch (reason) {
      setError(true); setMessage(reason instanceof Error ? reason.message : "Folder task and timelog import failed.");
    } finally { setImporting(false); }
  }

  async function health() {
    setError(false);
    try {
      const response = await fetch("/api/wrike/health"); const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Health check failed.");
      setMessage(`Wrike connection healthy — ${payload.account?.name ?? "account"} responded in ${payload.latencyMs} ms.`);
    } catch (reason) { setError(true); setMessage(reason instanceof Error ? reason.message : "Health check failed."); }
  }

  async function repairVerticals() {
    setImporting(true); setComplete(false); setError(false);
    setMessage("Repairing synchronized Vertical data…");
    try {
      const response = await fetch("/api/admin/wrike/repair-verticals", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Vertical repair failed.");
      setComplete(true);
      reloadWithMessage(`Vertical repair complete — ${payload.repaired} repaired; ${payload.stillIncomplete} still incomplete.`);
    } catch (reason) { setError(true); setMessage(reason instanceof Error ? reason.message : "Vertical repair failed."); }
    finally { setImporting(false); }
  }

  async function clearHistory() {
    if (!confirm("Clear all import and Vertical repair history? This cannot be undone.")) return;
    setClearingHistory(true); setError(false); setMessage("");
    try {
      const response = await fetch("/api/admin/wrike/history", { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to clear history.");
      reloadWithMessage("History cleared.");
    } catch (reason) {
      setError(true); setMessage(reason instanceof Error ? reason.message : "Unable to clear history.");
      setClearingHistory(false);
    }
  }

  const otherUnresolvedReferences = unresolvedReferences.filter((reference) => reference.reference_type !== "custom_field");

  return <div className="admin-stack">
    {message && <p className={error ? "notice error" : "notice"} role={error ? "alert" : "status"}>{message}</p>}
    <AdminDisclosure title="Import & repair" description="Synchronize Wrike data or repair stored Vertical values." defaultOpen>
      <div className="admin-action-grid">
    <section className="admin-action-card">
      <div><p className="eyebrow">WRIKE DATA — CURRENT STAGE</p><h2>Import folder tasks and timelogs</h2><p>This action refreshes people, workflow statuses, timelog categories, folder metadata, LCT fields, tasks, and timelogs. Reference failures remain visible warnings; selected-folder failures stop reconciliation.</p></div>
      <div className="space-import-actions"><button onClick={importFolderTasks} disabled={!connected || importing}>{importing ? "Importing tasks and timelogs…" : "Import folder tasks and timelogs"}</button></div>
      {!connected && <p className="notice error">Connect Wrike before importing folder data.</p>}
      {needsUserScope && <p className="notice error">Reconnect Wrike to grant <code>amReadOnlyUser</code>. Tasks and timelogs can still import, but authoritative user details cannot refresh. <a href="/api/wrike/connect">Reconnect Wrike</a></p>}
      {complete && <div className="filter-bar compact"><a className="button" href="/projects">View imported projects</a></div>}
    </section>
    <section className="admin-action-card"><div><p className="eyebrow">ASSOCIATED VERTICAL</p><h2>Diagnostics and explicit repair</h2><p>This administrator-only action rebuilds detail-verified stored values locally, then requests task details for incomplete or older list-only records. It does not change folder associations, time entries, or manual mappings, and never runs automatically.</p></div><div className="filter-bar"><button onClick={repairVerticals} disabled={!connected || importing}>{importing ? "Repair running…" : "Repair Vertical data"}</button></div>{verticalDiagnosticsError ? <p className="notice error">Vertical diagnostics require the latest database migration: {verticalDiagnosticsError}</p> : verticalDiagnostics ? <details><summary>Current organization-scoped diagnostic summary</summary><pre>{JSON.stringify(verticalDiagnostics, null, 2)}</pre></details> : <p className="empty">No diagnostic result is available.</p>}</section>
      </div>
      <div className="admin-history-toolbar"><a className="button secondary" href="#data-history">View run history</a></div>
    </AdminDisclosure>
    <AdminDisclosure title="Connection & source folders" description="Manage the Wrike connection and review the folders included in synchronization.">
    <div className="admin-grid">
      <section className="card"><h2>Wrike connection</h2>{connected ? <><p>Connected to <strong>{connection?.account_name ?? "Wrike"}</strong>.</p><p className="muted">Host: {connection?.api_host}<br />Scopes: {connection?.oauth_scopes?.join(", ") || "wsReadOnly (legacy connection)"}<br />Token expires: {connection?.token_expires_at ? new Date(connection.token_expires_at).toLocaleString() : "unknown"}</p><div className="filter-bar"><button className="secondary" onClick={health}>Run health check</button><a className="button secondary" href="/api/wrike/connect">Reconnect</a><button className="secondary" onClick={async () => { await fetch("/api/wrike/disconnect", { method: "POST" }); location.reload(); }}>Disconnect</button></div></> : <><p>Connect Wrike with read-only access before importing folder data.</p><a className="button" href="/api/wrike/connect">Connect Wrike</a></>}</section>
      <section className="card"><h2>Configured folder allowlist</h2><p className="muted">Only these task and timelog source folders are queried.</p><ol className="detail-list">{folders.map((folder) => <li key={folder.id}><strong>{folder.title}</strong><br /><code>{folder.id}</code></li>)}</ol></section>
    </div>
    </AdminDisclosure>
    <AdminDisclosure title="Other unresolved Wrike references" description="Review references that will be retried during a future import."><div className="admin-section-content"><p className="muted">These references are read-only here and will be retried during a future combined import. Previously known historical user names remain available even when a user becomes inactive.</p>{otherUnresolvedReferences.length ? <table><thead><tr><th>Type</th><th>Wrike ID</th><th>Occurrences</th><th>Attempts</th><th>Last error</th></tr></thead><tbody>{otherUnresolvedReferences.map((reference) => <tr key={reference.id}><td>{reference.reference_type.replaceAll("_", " ")}</td><td><UnresolvedReferenceLabel id={reference.wrike_id} type={reference.reference_type} /></td><td>{reference.occurrence_count}</td><td>{reference.resolution_attempts}</td><td>{reference.last_error ?? "No error detail"}</td></tr>)}</tbody></table> : <p className="empty">No other unresolved references are waiting for a future import.</p>}</div></AdminDisclosure>
    <AdminDisclosure title="History" description="Review recent imports and repairs, newest first." count={`${folderRuns.length + repairRuns.length} recent runs`} id="data-history"><div className="admin-history-toolbar"><p className="muted">Most recent runs are shown first.</p><button className="secondary" onClick={clearHistory} disabled={clearingHistory || folderRuns.length + repairRuns.length === 0}>{clearingHistory ? "Clearing history…" : "Clear history"}</button></div><div className="admin-history-section"><h3>Combined import history</h3>{folderRuns.length ? <table><thead><tr><th>Started</th><th>Status</th><th>Records</th><th>Requests</th><th>Diagnostics</th></tr></thead><tbody>{folderRuns.map((run) => <tr key={run.id}><td>{new Date(run.created_at).toLocaleString()}<br />{run.duration_ms != null ? `${run.duration_ms} ms` : "Running"}</td><td>{run.status}<br />{run.reference_warning_count ?? 0} warning(s)<br />{run.custom_field_conflict_count ?? 0} field conflict(s)<br />{run.unresolved_reference_count ?? 0} unresolved reference(s)</td><td>{run.task_count} tasks<br />{run.unique_timelog_count} timelogs</td><td>{run.task_request_count} task<br />{run.timelog_request_count} timelog</td><td>{run.error_summary ? <>{run.error_summary}<FailureDetails failures={run.folder_failures} /></> : <><span>Descendants: {run.timelog_descendant_strategy}</span><br /><span>Logical custom fields: {run.custom_field_normalization_diagnostics?.logicalFieldCount ?? 0}; values: {run.custom_field_normalization_diagnostics?.normalizedTaskValueCount ?? 0}</span><br /><ReferenceEvidence diagnostics={run.reference_data_diagnostics} /><br /><MetadataEvidence diagnostics={run.metadata_diagnostics} /></>}</td></tr>)}</tbody></table> : <p className="empty">No combined folder import has run yet.</p>}</div><div className="admin-history-section"><h3>Vertical repair history</h3>{repairRuns.length ? <div className="admin-table-wrap"><table><thead><tr><th>Started</th><th>Status</th><th>Examined</th><th>Repaired</th><th>Unchanged</th><th>Retained</th><th>Incomplete</th></tr></thead><tbody>{repairRuns.map((run) => <tr key={run.id}><td>{new Date(run.started_at).toLocaleString()}</td><td>{run.status}{run.error_summary ? <><br /><span className="error">{run.error_summary}</span></> : null}</td><td>{run.examined_count}</td><td>{run.repaired_count}</td><td>{run.unchanged_count}</td><td>{run.retained_count}</td><td>{run.still_incomplete_count}</td></tr>)}</tbody></table></div> : <p className="empty">No Vertical repair has run yet.</p>}</div></AdminDisclosure>
  </div>;
}

function FailureDetails({ failures }: { failures: FolderFailure[] }) {
  if (!failures?.length) return null;
  return <details><summary>{failures.length} folder request failure(s)</summary>{failures.map((failure, index) => <p key={`${failure.requestFolderId}-${failure.operation}-${index}`}><strong>{failure.folderTitle}:</strong> {failure.operation} request for <code>{failure.requestFolderId}</code> returned {failure.status ?? "a network error"}. {failure.message}</p>)}</details>;
}

function ReferenceEvidence({ diagnostics }: { diagnostics: ReferenceDiagnostics }) {
  const users = diagnostics?.users;
  const categories = diagnostics?.categories;
  const workflow = diagnostics?.workflow;
  const spaces = diagnostics?.spaces;
  return <details><summary>Reference data</summary><p><strong>Users:</strong> {users?.received ?? 0}/{users?.requested ?? 0} retrieved; {(users?.failedIds ?? []).length} failed.<br /><strong>Categories:</strong> {categories?.received ?? 0} retrieved{categories?.failed ? " (request warning)" : ""}.<br /><strong>Workflow statuses:</strong> {workflow?.statusesUpserted ?? 0} saved{workflow?.failed ? " (request warning)" : ""}.<br /><strong>Spaces:</strong> {spaces?.upserted ?? spaces?.received ?? 0} saved{spaces?.failed ? " (request warning)" : ""}.</p>{(users?.failedIds ?? []).length > 0 && <p><strong>Failed user IDs:</strong> {users?.failedIds?.join(", ")}</p>}{(users?.nameMismatches ?? []).map((mismatch) => <p key={mismatch.wrikeUserId}><code>{mismatch.wrikeUserId}</code>: expected {mismatch.expectedName}; Wrike returned {mismatch.returnedName}.</p>)}{(diagnostics?.failures ?? []).map((failure, index) => <p key={`${failure.operation}-${failure.wrikeId}-${index}`}><strong>{failure.operation}:</strong> {failure.wrikeId && <><code>{failure.wrikeId}</code> </>}{failure.status ?? "local/network"} — {failure.message}</p>)}</details>;
}

function MetadataEvidence({ diagnostics }: { diagnostics: MetadataDiagnostics }) {
  const searches = diagnostics?.customFieldSearches ?? [];
  return <details><summary>{diagnostics?.matchedFieldTitles?.join(", ") || "View searches"}</summary><p><strong>Folder request:</strong> {diagnostics?.folderRequest ?? "—"}</p>{searches.map((search) => <p key={search.path}><strong>{search.query ?? "Unfiltered"}:</strong> {search.returnedCount} returned ({search.returnedTitles.join(", ") || "no titles"}); expected field {search.containsExpectedField ? "found" : "not found"}.</p>)}<p><strong>Unfiltered fallback:</strong> {diagnostics?.unfilteredFallbackRequired ? "required" : "not required"}<br /><strong>Local rule:</strong> {diagnostics?.matchingRule ?? "—"}</p></details>;
}

function AdminDisclosure({ title, description, count, defaultOpen = false, id, children }: { title: string; description: string; count?: string; defaultOpen?: boolean; id?: string; children: ReactNode }) {
  return <details className="card admin-disclosure" open={defaultOpen} id={id}>
    <summary>
      <span className="admin-disclosure-summary"><strong>{title}</strong><small>{description}</small></span>
      {count ? <span className="admin-disclosure-count">{count}</span> : null}
    </summary>
    <div className="admin-disclosure-body">{children}</div>
  </details>;
}
