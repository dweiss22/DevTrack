"use client";
import { useState, type FormEvent } from "react";
import { StatusBadge, UnresolvedReferenceLabel } from "@/components/wrike-reference";

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
type IdentityReview = { id: string; display_name: string; email: string | null; verification_status: "unverified" | "ambiguous" | "not_found" | "failed"; verification_source: string; candidate_contacts: { id?: string; displayName?: string; emails?: string[] }[]; verification_attempt_count: number; last_verification_attempt_at: string | null; next_verification_attempt_at: string | null; last_error: string | null };
type NormalizedField = { id: string; title: string; normalized_key: string };
type WorkflowStatus = { wrike_id: string; title: string; status_group: string | null; color: string | null; dashboard_classification: "active" | "completed" | "stalled_or_canceled" | null; classification_source: "automatic" | "manual" | null; workflow_id: string };
type ManualMapping = { id: string; wrike_id: string; action: "map_existing" | "create_new" | "ignore"; target_normalized_field_id: string | null; manual_label: string | null; reprocess_status: string; reprocess_error: string | null; updated_at: string };
type RepairRun = { id: string; status: string; examined_count: number; repaired_count: number; unchanged_count: number; retained_count: number; still_incomplete_count: number; started_at: string; completed_at: string | null; error_summary: string | null };
type Props = { connection: Connection; folderRuns: FolderRun[]; folders: ConfiguredFolder[]; unresolvedReferences: UnresolvedReference[]; identityReview: IdentityReview[]; normalizedFields: NormalizedField[]; workflowStatuses: WorkflowStatus[]; manualMappings: ManualMapping[]; verticalDiagnostics: Record<string, unknown> | null; verticalDiagnosticsError: string | null; repairRuns: RepairRun[] };

export function AdminPanel({ connection, folderRuns, folders, unresolvedReferences, identityReview, normalizedFields, workflowStatuses, manualMappings, verticalDiagnostics, verticalDiagnosticsError, repairRuns }: Props) {
  const connected = connection?.status === "connected";
  const needsUserScope = connected && !connection?.oauth_scopes?.includes("amReadOnlyUser");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [importing, setImporting] = useState(false);
  const [complete, setComplete] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [customFieldDiagnostic, setCustomFieldDiagnostic] = useState<Record<string, unknown> | null>(null);

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

  async function repairVerticals() {
    setImporting(true); setComplete(false); setError(false);
    setMessage("Reprocessing detail-verified Vertical data and hydrating incomplete or not-yet-verified Wrike tasks.");
    try {
      const response = await fetch("/api/admin/wrike/repair-verticals", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Vertical repair failed.");
      setComplete(true);
      setMessage(`Vertical repair complete: ${payload.examined} examined, ${payload.repaired} repaired, ${payload.unchanged} unchanged, ${payload.retained} retained, and ${payload.stillIncomplete} still incomplete.`);
      location.reload();
    } catch (reason) { setError(true); setMessage(reason instanceof Error ? reason.message : "Vertical repair failed."); }
    finally { setImporting(false); }
  }

  async function compareSuppliedTasks() {
    setDiagnosing(true); setError(false); setCustomFieldDiagnostic(null);
    setMessage("Comparing stored data with bounded, read-only Wrike list, detail, definition, and folder-context responses.");
    try {
      const params = new URLSearchParams();
      params.append("taskId", "MAAAAAECJ2DX");
      params.append("taskId", "MAAAAAAEMqHAo");
      const response = await fetch(`/api/admin/wrike/custom-field-diagnostics?${params}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Custom-field comparison failed.");
      setCustomFieldDiagnostic(payload);
      setMessage("Read-only custom-field comparison complete. No Wrike or DevTrack records were changed.");
    } catch (reason) {
      setError(true); setMessage(reason instanceof Error ? reason.message : "Custom-field comparison failed.");
    } finally { setDiagnosing(false); }
  }

  async function saveCustomFieldMapping(event: FormEvent<HTMLFormElement>, wrikeFieldId: string) {
    event.preventDefault(); setError(false);
    const form = new FormData(event.currentTarget);
    const action = String(form.get("action") ?? "map_existing");
    const targetNormalizedFieldId = String(form.get("targetNormalizedFieldId") ?? "") || undefined;
    const newTitle = String(form.get("newTitle") ?? "") || undefined;
    setMessage(`Saving mapping for ${wrikeFieldId} and rebuilding affected tasks…`);
    const response = await fetch("/api/admin/wrike/custom-field-mappings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wrikeFieldId, action, targetNormalizedFieldId, newTitle }) });
    const payload = await response.json();
    if (!response.ok) { setError(true); setMessage(`${payload.error ?? "Unable to save the mapping."}${payload.mappingSaved ? " The mapping was saved, but reprocessing must be retried." : ""}`); return; }
    setMessage(`Mapping saved. ${payload.affectedTaskCount} affected task(s) were rebuilt locally.`); location.reload();
  }

  async function removeCustomFieldMapping(wrikeFieldId: string) {
    setError(false); setMessage(`Removing mapping for ${wrikeFieldId} and rebuilding affected tasks…`);
    const response = await fetch("/api/admin/wrike/custom-field-mappings", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ wrikeFieldId }) });
    const payload = await response.json();
    if (!response.ok) { setError(true); setMessage(payload.error ?? "Unable to remove the mapping."); return; }
    setMessage(`Mapping removed. ${payload.affectedTaskCount} affected task(s) were rebuilt locally.`); location.reload();
  }

  async function updateStatusClassification(wrikeStatusId: string, selected: string) {
    setError(false);
    const automatic = selected === "automatic";
    const classification = automatic || selected === "unclassified" ? null : selected;
    const response = await fetch("/api/admin/wrike/status-classifications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wrikeStatusId, classification, automatic }) });
    const payload = await response.json();
    if (!response.ok) { setError(true); setMessage(payload.error ?? "Unable to update the status classification."); return; }
    setMessage(`Status classification updated to ${payload.classification ?? "unclassified"}.`); location.reload();
  }

  const unresolvedCustomFields = unresolvedReferences.filter((reference) => reference.reference_type === "custom_field");
  const otherUnresolvedReferences = unresolvedReferences.filter((reference) => reference.reference_type !== "custom_field");

  return <div className="admin-stack">
    {message && <p className={error ? "notice error" : "notice"}>{message}</p>}
    <section className="card space-import-card">
      <div><p className="eyebrow">WRIKE DATA — CURRENT STAGE</p><h2>Import folder tasks and timelogs</h2><p>This action refreshes people, workflow statuses, timelog categories, folder metadata, LCT fields, tasks, and timelogs. Reference failures remain visible warnings; selected-folder failures stop reconciliation.</p></div>
      <div className="space-import-actions"><button onClick={importFolderTasks} disabled={!connected || importing}>{importing ? "Importing tasks and timelogs…" : "Import folder tasks and timelogs"}</button></div>
      {!connected && <p className="notice error">Connect Wrike before importing folder data.</p>}
      {needsUserScope && <p className="notice error">Reconnect Wrike to grant <code>amReadOnlyUser</code>. Tasks and timelogs can still import, but authoritative user details cannot refresh. <a href="/api/wrike/connect">Reconnect Wrike</a></p>}
      {complete && <div className="filter-bar compact"><a className="button" href="/projects">View imported projects</a></div>}
    </section>
    <section className="card"><div><p className="eyebrow">ASSOCIATED VERTICAL</p><h2>Diagnostics and explicit repair</h2><p>This administrator-only action rebuilds detail-verified stored values locally, then requests task details for incomplete or older list-only records. It does not change folder associations, time entries, or manual mappings, and never runs automatically.</p></div><div className="filter-bar"><button onClick={repairVerticals} disabled={!connected || importing}>{importing ? "Repair running…" : "Repair Vertical data"}</button></div>{verticalDiagnosticsError ? <p className="notice error">Vertical diagnostics require the latest database migration: {verticalDiagnosticsError}</p> : verticalDiagnostics ? <details><summary>Current organization-scoped diagnostic summary</summary><pre>{JSON.stringify(verticalDiagnostics, null, 2)}</pre></details> : <p className="empty">No diagnostic result is available.</p>}{repairRuns.length ? <table><thead><tr><th>Started</th><th>Status</th><th>Examined</th><th>Repaired</th><th>Unchanged</th><th>Retained</th><th>Incomplete</th></tr></thead><tbody>{repairRuns.map((run) => <tr key={run.id}><td>{new Date(run.started_at).toLocaleString()}</td><td>{run.status}{run.error_summary ? <><br /><span className="error">{run.error_summary}</span></> : null}</td><td>{run.examined_count}</td><td>{run.repaired_count}</td><td>{run.unchanged_count}</td><td>{run.retained_count}</td><td>{run.still_incomplete_count}</td></tr>)}</tbody></table> : null}</section>
    <section className="card"><div><p className="eyebrow">CUSTOM-FIELD ACQUISITION</p><h2>Compare the two supplied tasks</h2><p>This bounded administrator diagnostic reads the stored rows and current Wrike task-list, task-detail, field-definition, and parent-folder context for <code>MAAAAAECJ2DX</code> and <code>MAAAAAAEMqHAo</code>. It returns field-level evidence without tokens or complete payloads and does not write data.</p></div><div className="filter-bar"><button className="secondary" onClick={compareSuppliedTasks} disabled={!connected || diagnosing}>{diagnosing ? "Comparing…" : "Run read-only comparison"}</button></div>{customFieldDiagnostic ? <details open><summary>Comparison evidence</summary><pre>{JSON.stringify(customFieldDiagnostic, null, 2)}</pre></details> : null}</section>
    <div className="admin-grid">
      <section className="card"><h2>Wrike connection</h2>{connected ? <><p>Connected to <strong>{connection?.account_name ?? "Wrike"}</strong>.</p><p className="muted">Host: {connection?.api_host}<br />Scopes: {connection?.oauth_scopes?.join(", ") || "wsReadOnly (legacy connection)"}<br />Token expires: {connection?.token_expires_at ? new Date(connection.token_expires_at).toLocaleString() : "unknown"}</p><div className="filter-bar"><button className="secondary" onClick={health}>Run health check</button><a className="button secondary" href="/api/wrike/connect">Reconnect</a><button className="secondary" onClick={async () => { await fetch("/api/wrike/disconnect", { method: "POST" }); location.reload(); }}>Disconnect</button></div></> : <><p>Connect Wrike with read-only access before importing folder data.</p><a className="button" href="/api/wrike/connect">Connect Wrike</a></>}</section>
      <section className="card"><h2>Configured folder allowlist</h2><p className="muted">Only these task and timelog source folders are queried.</p><ol className="detail-list">{folders.map((folder) => <li key={folder.id}><strong>{folder.title}</strong><br /><code>{folder.id}</code></li>)}</ol></section>
    </div>
    <section className="card"><h2>Unresolved custom fields</h2><p className="muted">Raw IDs and sample values remain preserved. Map a field to an existing logical field, create a new one, or intentionally ignore it. Saving rebuilds affected tasks locally without calling Wrike.</p>{unresolvedCustomFields.length ? <div className="admin-stack">{unresolvedCustomFields.map((reference) => <form className="card" key={reference.id} onSubmit={(event) => saveCustomFieldMapping(event, reference.wrike_id)}><p><strong><UnresolvedReferenceLabel id={reference.wrike_id} type="custom_field" /></strong><br /><span className="muted">Seen {reference.occurrence_count} time(s); {reference.resolution_attempts} resolution attempt(s). Last seen {new Date(reference.last_encountered_at).toLocaleString()}.</span></p><p><strong>Sample values:</strong> {reference.sample_values.length ? reference.sample_values.map((value) => typeof value === "string" ? value : JSON.stringify(value)).join(", ") : "None retained"}</p>{reference.last_error && <p className="notice error">{reference.last_error}</p>}<div className="form-grid"><label>Action<select name="action" defaultValue="map_existing"><option value="map_existing">Map to existing field</option><option value="create_new">Create normalized field</option><option value="ignore">Intentionally ignore</option></select></label><label>Existing normalized field<select name="targetNormalizedFieldId" defaultValue=""><option value="">Select a field</option>{normalizedFields.map((field) => <option key={field.id} value={field.id}>{field.title}</option>)}</select></label><label>New normalized title<input name="newTitle" maxLength={200} placeholder="Required for Create" /></label></div><button type="submit">Save mapping and rebuild</button></form>)}</div> : <p className="empty">No unresolved custom fields are waiting for correction.</p>}</section>
    <section className="card"><h2>Manual custom-field mappings</h2>{manualMappings.length ? <table><thead><tr><th>Wrike field</th><th>Action</th><th>Logical field</th><th>Reprocessing</th><th /></tr></thead><tbody>{manualMappings.map((mapping) => <tr key={mapping.id}><td><code>{mapping.wrike_id}</code></td><td>{mapping.action.replaceAll("_", " ")}</td><td>{mapping.manual_label ?? "Ignored"}</td><td>{mapping.reprocess_status}{mapping.reprocess_error && <><br /><span className="error">{mapping.reprocess_error}</span></>}</td><td><button className="secondary" onClick={() => removeCustomFieldMapping(mapping.wrike_id)}>Remove</button></td></tr>)}</tbody></table> : <p className="empty">No manual custom-field mappings have been created.</p>}</section>
    <section className="card"><h2>Person identity review</h2><p className="muted">Readable task names remain displayable. These rows need review because Wrike contact verification was ambiguous, unsuccessful, or unavailable.</p>{identityReview.length ? <table><thead><tr><th>Task name</th><th>Email</th><th>Status</th><th>Candidate contacts</th><th>Attempts</th><th>Last attempt / next retry</th></tr></thead><tbody>{identityReview.map((identity) => <tr key={identity.id}><td>{identity.display_name}</td><td>{identity.email ?? "—"}</td><td>{identity.verification_status.replaceAll("_", " ")}{identity.last_error ? <><br /><span className="error">{identity.last_error}</span></> : null}</td><td>{identity.candidate_contacts.length ? identity.candidate_contacts.map((candidate) => `${candidate.displayName ?? candidate.id}${candidate.emails?.length ? ` (${candidate.emails.join(", ")})` : ""}`).join("; ") : "None"}</td><td>{identity.verification_attempt_count}</td><td>{identity.last_verification_attempt_at ? new Date(identity.last_verification_attempt_at).toLocaleString() : "Not attempted"}<br /><span className="muted">{identity.next_verification_attempt_at ? `Retry after ${new Date(identity.next_verification_attempt_at).toLocaleString()}` : "No retry scheduled"}</span></td></tr>)}</tbody></table> : <p className="empty">No task-provided person identities require review.</p>}</section>
    <section className="card"><h2>Online Learning status classifications</h2><p className="muted">Names and colors come from Wrike. Dashboard classifications are stored centrally and manual choices survive later workflow imports.</p>{workflowStatuses.length ? <table><thead><tr><th>Status</th><th>Wrike group</th><th>Classification</th><th>Source</th></tr></thead><tbody>{workflowStatuses.map((status) => <tr key={status.wrike_id}><td><StatusBadge name={status.title} id={status.wrike_id} color={status.color} /></td><td>{status.status_group ?? "—"}</td><td><select aria-label={`Classification for ${status.title}`} defaultValue={status.classification_source === "automatic" ? "automatic" : status.dashboard_classification ?? "unclassified"} onChange={(event) => updateStatusClassification(status.wrike_id, event.target.value)}><option value="automatic">Automatic</option><option value="active">Active</option><option value="completed">Completed</option><option value="stalled_or_canceled">Stalled or Canceled</option><option value="unclassified">Unclassified</option></select></td><td>{status.classification_source ?? "unclassified"}</td></tr>)}</tbody></table> : <p className="empty">Run the combined import to synchronize Online Learning workflow statuses.</p>}</section>
    <section className="card"><h2>Other unresolved Wrike references</h2><p className="muted">These references are read-only here and will be retried during a future combined import. Previously known historical user names remain available even when a user becomes inactive.</p>{otherUnresolvedReferences.length ? <table><thead><tr><th>Type</th><th>Wrike ID</th><th>Occurrences</th><th>Attempts</th><th>Last error</th></tr></thead><tbody>{otherUnresolvedReferences.map((reference) => <tr key={reference.id}><td>{reference.reference_type.replaceAll("_", " ")}</td><td><UnresolvedReferenceLabel id={reference.wrike_id} type={reference.reference_type} /></td><td>{reference.occurrence_count}</td><td>{reference.resolution_attempts}</td><td>{reference.last_error ?? "No error detail"}</td></tr>)}</tbody></table> : <p className="empty">No other unresolved references are waiting for a future import.</p>}</section>
    <section className="card"><h2>Combined import history</h2>{folderRuns.length ? <table><thead><tr><th>Started</th><th>Status</th><th>Records</th><th>Requests</th><th>Diagnostics</th></tr></thead><tbody>{folderRuns.map((run) => <tr key={run.id}><td>{new Date(run.created_at).toLocaleString()}<br />{run.duration_ms != null ? `${run.duration_ms} ms` : "Running"}</td><td>{run.status}<br />{run.reference_warning_count ?? 0} warning(s)<br />{run.custom_field_conflict_count ?? 0} field conflict(s)<br />{run.unresolved_reference_count ?? 0} unresolved reference(s)</td><td>{run.task_count} tasks<br />{run.unique_timelog_count} timelogs</td><td>{run.task_request_count} task<br />{run.timelog_request_count} timelog</td><td>{run.error_summary ? <>{run.error_summary}<FailureDetails failures={run.folder_failures} /></> : <><span>Descendants: {run.timelog_descendant_strategy}</span><br /><span>Logical custom fields: {run.custom_field_normalization_diagnostics?.logicalFieldCount ?? 0}; values: {run.custom_field_normalization_diagnostics?.normalizedTaskValueCount ?? 0}</span><br /><ReferenceEvidence diagnostics={run.reference_data_diagnostics} /><br /><MetadataEvidence diagnostics={run.metadata_diagnostics} /></>}</td></tr>)}</tbody></table> : <p className="empty">No combined folder import has run yet.</p>}</section>
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
