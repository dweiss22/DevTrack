"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  HISTORICAL_SCHEMA_GUIDES,
  type HistoricalDuplicateAction,
  type HistoricalSurveyType,
} from "@/lib/surveys/finalized-historical-import";

export type FinalizedImportBatch = {
  id: string;
  source_filename: string;
  external_survey_type: HistoricalSurveyType | null;
  survey_type: string | null;
  survey_versions: string[];
  source_timezone: string;
  status: string;
  summary: Record<string, number | string | unknown[] | null>;
  created_at: string;
  finalized_at: string | null;
};

export type FinalizedImportRow = {
  id: string;
  batch_id: string;
  row_number: number;
  external_survey_type: HistoricalSurveyType;
  survey_version: string;
  source_response_id: string;
  effective_source_response_id: string;
  raw_row: Record<string, string>;
  normalized_answers: Record<string, unknown>;
  normalization_deltas: Array<{ field: string; originalValue: unknown; normalizedValue: unknown; reason: string }>;
  match_diagnostics: {
    status?: string;
    candidates?: Array<{ id: string; wrikeTaskId: string; courseName: string; publicationYear?: number | null }>;
    issues?: Array<{ code: string; field: string | null; message: string; severity: string }>;
    explicitlyUnmatched?: boolean;
  };
  context_snapshot: Record<string, unknown>;
  matched_task_id: string | null;
  respondent_principal_id: string | null;
  reviewed_wrike_user_id: string | null;
  selected_for_import: boolean;
  duplicate_action: HistoricalDuplicateAction;
  duplicate_target_response_id: string | null;
  explicit_unmatched: boolean;
  row_status: string;
  finalized_status: string | null;
  historical_response_id: string | null;
};

export type FinalizedImportIssue = {
  id: string;
  row_id: string | null;
  issue_code: string;
  severity: string;
  source_field: string | null;
  message: string;
  raw_value: unknown;
  resolution_status: string;
};

type Option = { id: string; label: string; detail?: string | null };
type HistoricalResponse = {
  id: string;
  historical_course_name: string;
  survey_type: HistoricalSurveyType;
  original_source_response_id: string;
  submitted_at: string;
  matched_task_id: string | null;
};

function statusFor(row: FinalizedImportRow) {
  if (row.finalized_status) return row.finalized_status;
  return row.match_diagnostics.status
    ?? (row.row_status === "ready" ? "Ready" : row.row_status === "duplicate" ? "Duplicate" : "Blocked");
}

function personNames(row: FinalizedImportRow) {
  const normalized = row.normalized_answers;
  const reviewer = normalized.reviewer as { name?: string } | undefined;
  const sme = (normalized.reviewedSme ?? normalized.sme) as { name?: string } | undefined;
  return { reviewer: reviewer?.name ?? "", sme: sme?.name ?? "" };
}

export function FinalizedHistoricalSurveyImports({
  batches,
  activeBatch,
  rows,
  issues,
  projects,
  principals,
  wrikeUsers,
  historicalResponses,
  canReplace,
}: {
  batches: FinalizedImportBatch[];
  activeBatch: FinalizedImportBatch | null;
  rows: FinalizedImportRow[];
  issues: FinalizedImportIssue[];
  projects: Option[];
  principals: Option[];
  wrikeUsers: Option[];
  historicalResponses: HistoricalResponse[];
  canReplace: boolean;
}) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [working, setWorking] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [matchFilter, setMatchFilter] = useState("");
  const [duplicateFilter, setDuplicateFilter] = useState("");
  const [search, setSearch] = useState("");
  const issueByRow = useMemo(() => {
    const map = new Map<string, FinalizedImportIssue[]>();
    for (const issue of issues) {
      if (!issue.row_id) continue;
      map.set(issue.row_id, [...(map.get(issue.row_id) ?? []), issue]);
    }
    return map;
  }, [issues]);
  const visibleRows = useMemo(() => rows.filter((row) => {
    const names = personNames(row);
    const haystack = [
      row.source_response_id,
      String(row.normalized_answers.courseName ?? ""),
      names.reviewer,
      names.sme,
    ].join(" ").toLocaleLowerCase("en-US");
    const status = statusFor(row);
    return (!statusFilter || status === statusFilter)
      && (!matchFilter || (matchFilter === "matched" ? Boolean(row.matched_task_id) : !row.matched_task_id))
      && (!duplicateFilter || (duplicateFilter === "duplicates" ? row.row_status === "duplicate" : row.row_status !== "duplicate"))
      && (!search || haystack.includes(search.toLocaleLowerCase("en-US")));
  }), [rows, statusFilter, matchFilter, duplicateFilter, search]);
  const selectedRows = rows.filter((row) => row.selected_for_import && row.row_status === "ready");
  const summary = {
    total: rows.length,
    selected: selectedRows.length,
    newRecords: selectedRows.filter((row) => row.duplicate_action !== "replace").length,
    duplicateSkipped: rows.filter((row) => row.row_status === "duplicate" && row.duplicate_action === "skip").length,
    replacing: selectedRows.filter((row) => row.duplicate_action === "replace").length,
    unmatched: selectedRows.filter((row) => !row.matched_task_id).length,
    warnings: rows.filter((row) => statusFor(row) === "Ready with warnings").length,
    blocked: rows.filter((row) => row.row_status === "issues").length,
  };

  useEffect(() => {
    const saved = sessionStorage.getItem("devtrack-survey-import-message");
    if (!saved) return;
    sessionStorage.removeItem("devtrack-survey-import-message");
    setError(false);
    setMessage(saved);
  }, []);

  function reload(value: string) {
    sessionStorage.setItem("devtrack-survey-import-message", value);
    location.reload();
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking("upload"); setError(false); setMessage("Inspecting the CSV and staging its preview…");
    const form = new FormData(event.currentTarget);
    form.set("confirmTimezone", "true");
    try {
      const response = await fetch("/api/admin/survey-imports", { method: "POST", body: form });
      const payload = await response.json() as { error?: string; batch?: { batchId: string; duplicateUpload: boolean } };
      if (!response.ok || !payload.batch) throw new Error(payload.error ?? "The CSV could not be inspected.");
      location.href = `/admin/survey-imports?batch=${payload.batch.batchId}`;
    } catch (reason) {
      setError(true); setMessage(reason instanceof Error ? reason.message : "The CSV could not be inspected.");
    } finally {
      setWorking("");
    }
  }

  async function patchRow(rowId: string, body: Record<string, unknown>, success: string) {
    setWorking(rowId); setError(false);
    try {
      const response = await fetch(`/api/admin/survey-imports/rows/${rowId}/finalized`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "The row could not be updated.");
      reload(success);
    } catch (reason) {
      setError(true); setMessage(reason instanceof Error ? reason.message : "The row could not be updated.");
      setWorking("");
    }
  }

  async function selectVisible(selected: boolean) {
    const eligible = visibleRows.filter((row) => row.row_status === "ready" && row.selected_for_import !== selected);
    if (!eligible.length) return;
    setWorking("bulk"); setError(false); setMessage(`${selected ? "Selecting" : "Deselecting"} ${eligible.length} rows…`);
    try {
      for (const row of eligible) {
        const response = await fetch(`/api/admin/survey-imports/rows/${row.id}/finalized`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ selected }),
        });
        if (!response.ok) {
          const payload = await response.json() as { error?: string };
          throw new Error(payload.error ?? `CSV row ${row.row_number} could not be updated.`);
        }
      }
      reload(`${eligible.length} rows ${selected ? "selected" : "deselected"}.`);
    } catch (reason) {
      setError(true); setMessage(reason instanceof Error ? reason.message : "Bulk selection failed.");
      setWorking("");
    }
  }

  async function integrate() {
    if (!activeBatch || !selectedRows.length) return;
    setWorking("import"); setError(false); setMessage(`Importing ${selectedRows.length} survey responses…`);
    try {
      const response = await fetch(`/api/admin/survey-imports/${activeBatch.id}/integrate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "The survey import failed.");
      reload(`Historical survey import completed for ${activeBatch.source_filename}.`);
    } catch (reason) {
      setError(true); setMessage(reason instanceof Error ? reason.message : "The survey import failed.");
      setWorking("");
    }
  }

  return <div className="admin-stack finalized-survey-import">
    {message && <p className={error ? "notice error" : "notice"} role={error ? "alert" : "status"}>{message}</p>}
    <ol className="survey-import-steps" aria-label="Historical survey import stages">
      <li className={!activeBatch ? "active" : ""}>1. Select and inspect</li>
      <li className={activeBatch && !activeBatch.finalized_at ? "active" : ""}>2. Preview and reconcile</li>
      <li className={activeBatch && !activeBatch.finalized_at ? "active" : ""}>3. Confirm import</li>
      <li className={activeBatch?.finalized_at ? "active" : ""}>4. Results</li>
    </ol>

    <section className="card">
      <p className="eyebrow">FINALIZED HISTORICAL SCHEMAS</p>
      <h2>Select and inspect a CSV</h2>
      <p>Upload one SME Debrief or ID Review of SME file. DevTrack inspects and previews every row before any response is written.</p>
      <form className="survey-import-upload" onSubmit={upload}>
        <label>CSV file<input type="file" name="file" accept=".csv,text/csv" required /></label>
        <label>Source timezone<select name="timezone" defaultValue="America/Chicago">
          <option value="America/Chicago">America/Chicago</option>
          <option value="UTC">UTC</option>
          <option value="America/New_York">America/New_York</option>
          <option value="America/Denver">America/Denver</option>
          <option value="America/Los_Angeles">America/Los_Angeles</option>
        </select></label>
        <button disabled={working === "upload"}>{working === "upload" ? "Inspecting CSV…" : "Inspect CSV"}</button>
      </form>
      <div className="filter-bar">
        <a className="button secondary" href="/api/admin/survey-imports/templates/SME_DEBRIEF">SME Debrief CSV template</a>
        <a className="button secondary" href="/api/admin/survey-imports/templates/ID_SME_REVIEW">ID Review of SME CSV template</a>
      </div>
      <SchemaGuide />
    </section>

    {activeBatch && <section className="card">
      <p className="eyebrow">FILE INSPECTION</p>
      <h2>{activeBatch.source_filename}</h2>
      <dl className="summary-grid">
        <div><dt>Detected type</dt><dd>{activeBatch.external_survey_type ?? "Not recognized"}</dd></div>
        <div><dt>Version</dt><dd>{activeBatch.survey_versions?.join(", ") || "Unavailable"}</dd></div>
        <div><dt>Total rows</dt><dd>{Number(activeBatch.summary.totalRows ?? rows.length)}</dd></div>
        <div><dt>Valid rows</dt><dd>{Number(activeBatch.summary.validRows ?? 0)}</dd></div>
        <div><dt>Warnings</dt><dd>{Number(activeBatch.summary.warningCount ?? 0)}</dd></div>
        <div><dt>Errors</dt><dd>{Number(activeBatch.summary.errorCount ?? 0)}</dd></div>
      </dl>
      {issues.filter((issue) => !issue.row_id).map((issue) =>
        <p className="notice error" key={issue.id}>{issue.message}</p>)}
    </section>}

    {activeBatch && rows.length > 0 && <section className="card">
      <p className="eyebrow">PREVIEW AND RECONCILE</p>
      <h2>Survey rows</h2>
      <div className="survey-import-filters">
        <label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="">All statuses</option>
          {["Ready", "Ready with warnings", "Blocked", "Duplicate", "Possible match"].map((status) =>
            <option key={status}>{status}</option>)}
        </select></label>
        <label>Project match<select value={matchFilter} onChange={(event) => setMatchFilter(event.target.value)}>
          <option value="">Matched and unmatched</option><option value="matched">Matched</option><option value="unmatched">Unmatched</option>
        </select></label>
        <label>Duplicates<select value={duplicateFilter} onChange={(event) => setDuplicateFilter(event.target.value)}>
          <option value="">All rows</option><option value="duplicates">Duplicates only</option><option value="new">Nonduplicates</option>
        </select></label>
        <label>Search<input type="search" value={search} onChange={(event) => setSearch(event.target.value)}
          placeholder="Course, SME, reviewer, source ID" /></label>
      </div>
      {!activeBatch.finalized_at && <div className="filter-bar">
        <button className="secondary" onClick={() => selectVisible(true)} disabled={working === "bulk"}>Select all importable</button>
        <button className="secondary" onClick={() => selectVisible(false)} disabled={working === "bulk"}>Deselect visible</button>
      </div>}
      <div className="dashboard-table-wrap"><table className="dashboard-project-table survey-import-grid">
        <thead><tr><th>Import</th><th>CSV row</th><th>Status</th><th>Survey / source</th><th>Course / project</th><th>People</th><th>Warnings and errors</th><th>Review</th></tr></thead>
        <tbody>{visibleRows.map((row) => {
          const names = personNames(row);
          const rowIssues = issueByRow.get(row.id) ?? [];
          const status = statusFor(row);
          return <tr key={row.id}>
            <td data-label="Import"><input type="checkbox" aria-label={`Import CSV row ${row.row_number}`}
              checked={row.selected_for_import} disabled={Boolean(activeBatch.finalized_at) || row.row_status !== "ready" || working === row.id}
              onChange={(event) => patchRow(row.id, { selected: event.target.checked }, `CSV row ${row.row_number} updated.`)} /></td>
            <td data-label="CSV row">{row.row_number}</td>
            <td data-label="Status"><span className={`survey-status ${status.toLocaleLowerCase().replaceAll(" ", "-")}`}>{status}</span></td>
            <td data-label="Survey / source">{row.external_survey_type}<br /><code>{row.source_response_id}</code><br />{row.survey_version}</td>
            <td data-label="Course / project"><strong>{String(row.normalized_answers.courseName ?? "")}</strong><br />
              {row.matched_task_id ? projects.find((option) => option.id === row.matched_task_id)?.label ?? "Matched project" : "Unmatched"}</td>
            <td data-label="People">{names.reviewer && <>Reviewer: {names.reviewer}<br /></>}SME: {names.sme || "Unavailable"}</td>
            <td data-label="Warnings and errors">{rowIssues.length
              ? <ul>{rowIssues.slice(0, 3).map((issue) => <li key={issue.id}>{issue.message}</li>)}</ul>
              : "None"}</td>
            <td data-label="Review"><details><summary>Resolve or inspect</summary>
              <RowReview row={row} projects={projects} principals={principals} wrikeUsers={wrikeUsers}
                canReplace={canReplace} disabled={Boolean(activeBatch.finalized_at) || working === row.id}
                patch={(body) => patchRow(row.id, body, `CSV row ${row.row_number} updated.`)} />
            </details></td>
          </tr>;
        })}</tbody>
      </table></div>
    </section>}

    {activeBatch && rows.length > 0 && !activeBatch.finalized_at && <section className="card">
      <p className="eyebrow">CONFIRM IMPORT</p><h2>Import summary</h2>
      <dl className="summary-grid">
        <div><dt>Total rows</dt><dd>{summary.total}</dd></div>
        <div><dt>Rows selected</dt><dd>{summary.selected}</dd></div>
        <div><dt>New records</dt><dd>{summary.newRecords}</dd></div>
        <div><dt>Duplicates skipped</dt><dd>{summary.duplicateSkipped}</dd></div>
        <div><dt>Replacing</dt><dd>{summary.replacing}</dd></div>
        <div><dt>Unmatched projects</dt><dd>{summary.unmatched}</dd></div>
        <div><dt>Rows with warnings</dt><dd>{summary.warnings}</dd></div>
        <div><dt>Blocked rows</dt><dd>{summary.blocked}</dd></div>
      </dl>
      <button onClick={integrate} disabled={!summary.selected || working === "import"}>
        {working === "import" ? `Importing ${summary.selected} survey responses…` : `Import ${summary.selected} survey responses`}
      </button>
    </section>}

    {activeBatch?.finalized_at && <section className="card">
      <p className="eyebrow">IMPORT RESULTS</p><h2>{activeBatch.status === "completed" ? "Import completed" : "Import needs attention"}</h2>
      <dl className="summary-grid">
        {["importedRows", "skippedRows", "blockedRows", "unmatchedRows", "replacedRows", "failedRows"].map((key) =>
          <div key={key}><dt>{key.replace(/([A-Z])/g, " $1")}</dt><dd>{Number(activeBatch.summary[key] ?? 0)}</dd></div>)}
      </dl>
      <div className="filter-bar">
        <a className="button" href={`/admin/survey-imports?batch=${activeBatch.id}&records=all`}>View imported survey responses</a>
        <a className="button secondary" href={`/admin/survey-imports?batch=${activeBatch.id}&records=unmatched`}>Review unmatched records</a>
        <a className="button secondary" href={`/api/admin/survey-imports/${activeBatch.id}/errors`}>Download CSV error report</a>
      </div>
      {historicalResponses.length ? <ul className="detail-list">{historicalResponses.map((response) =>
        <li key={response.id}><a href={`/admin/historical-surveys/${response.id}`}><strong>{response.historical_course_name}</strong></a> · {response.survey_type} · {response.original_source_response_id}
          <br />{response.matched_task_id ? "Matched" : "Unmatched"} · {new Date(response.submitted_at).toLocaleString()}</li>)}</ul> : null}
    </section>}

    <section className="card">
      <p className="eyebrow">IMPORT AUDIT</p><h2>Previous batches</h2>
      {batches.length ? <table><thead><tr><th>Uploaded</th><th>File</th><th>Type</th><th>Status</th><th>Rows</th></tr></thead>
        <tbody>{batches.map((batch) => <tr key={batch.id}><td>{new Date(batch.created_at).toLocaleString()}</td>
          <td><a href={`/admin/survey-imports?batch=${batch.id}`}>{batch.source_filename}</a></td>
          <td>{batch.external_survey_type ?? "Legacy importer"}</td><td>{batch.status}</td>
          <td>{Number(batch.summary.totalRows ?? 0)}</td></tr>)}</tbody></table>
        : <p className="empty">No historical survey batches have been uploaded.</p>}
    </section>
  </div>;
}

function RowReview({ row, projects, principals, wrikeUsers, canReplace, disabled, patch }: {
  row: FinalizedImportRow;
  projects: Option[];
  principals: Option[];
  wrikeUsers: Option[];
  canReplace: boolean;
  disabled: boolean;
  patch: (body: Record<string, unknown>) => void;
}) {
  const [project, setProject] = useState(row.matched_task_id ?? "");
  const [principal, setPrincipal] = useState(row.respondent_principal_id ?? "");
  const [wrikeUser, setWrikeUser] = useState(row.reviewed_wrike_user_id ?? "");
  const [duplicateAction, setDuplicateAction] = useState<HistoricalDuplicateAction>(row.duplicate_action);
  const candidates = row.match_diagnostics.candidates ?? [];
  return <div className="survey-import-row-review">
    <label>Matched project<select value={project} onChange={(event) => setProject(event.target.value)} disabled={disabled}>
      <option value="">No project selected</option>
      {candidates.length > 0 && <optgroup label="Suggested matches">{candidates.map((candidate) =>
        <option value={candidate.id} key={candidate.id}>{candidate.courseName} · {candidate.wrikeTaskId}</option>)}</optgroup>}
      <optgroup label="All projects">{projects.map((option) => <option value={option.id} key={option.id}>{option.label} · {option.detail}</option>)}</optgroup>
    </select></label>
    <div className="filter-bar"><button className="secondary" disabled={disabled || !project}
      onClick={() => patch({ matchedTaskId: project })}>Use selected project</button>
      <button className="secondary" disabled={disabled}
        onClick={() => patch({ explicitlyUnmatched: true })}>Import unmatched</button></div>
    <label>Respondent match<select value={principal} onChange={(event) => setPrincipal(event.target.value)} disabled={disabled}>
      <option value="">No person association</option>{principals.map((option) =>
        <option value={option.id} key={option.id}>{option.label} · {option.detail}</option>)}
    </select></label>
    <label>SME contact match<select value={wrikeUser} onChange={(event) => setWrikeUser(event.target.value)} disabled={disabled}>
      <option value="">No SME association</option>{wrikeUsers.map((option) =>
        <option value={option.id} key={option.id}>{option.label} · {option.detail}</option>)}
    </select></label>
    <button className="secondary" disabled={disabled}
      onClick={() => patch({ respondentPrincipalId: principal || null, reviewedWrikeUserId: wrikeUser || null })}>Save person matches</button>
    {row.row_status === "duplicate" && <><label>Duplicate behavior<select value={duplicateAction}
      onChange={(event) => setDuplicateAction(event.target.value as HistoricalDuplicateAction)} disabled={disabled}>
      <option value="skip">Skip duplicate</option><option value="separate">Import as a separate response</option>
      {canReplace && row.duplicate_target_response_id && <option value="replace">Replace existing historical response</option>}
    </select></label><button className="secondary" disabled={disabled}
      onClick={() => patch({ duplicateAction })}>Apply duplicate behavior</button>
      {duplicateAction === "separate" && <p className="muted">The collision-safe derived identifier will be shown after this choice is saved.</p>}</>}
    {row.effective_source_response_id !== row.source_response_id &&
      <p><strong>Derived source ID:</strong> <code>{row.effective_source_response_id}</code></p>}
    <details><summary>Original and normalized row</summary>
      <h4>Normalization changes</h4>{row.normalization_deltas.length
        ? <ul>{row.normalization_deltas.map((item) => <li key={item.field}><strong>{item.field}:</strong> {String(item.originalValue)} → {String(item.normalizedValue)}</li>)}</ul>
        : <p>No values changed during normalization.</p>}
      <h4>Original</h4><pre>{JSON.stringify(row.raw_row, null, 2)}</pre>
      <h4>Normalized</h4><pre>{JSON.stringify(row.normalized_answers, null, 2)}</pre>
    </details>
  </div>;
}

function SchemaGuide() {
  return <details className="schema-guide"><summary>Historical CSV schema guide</summary>
    <p><strong>Dates:</strong> use ISO 8601 with a timezone for <code>submittedAt</code> and <code>YYYY-MM-DD</code> for date-only fields.</p>
    <p><strong>Verticals:</strong> P1A, C1A, D1A, FR1A, EMS1, LGU, Lexipol, Wellness, or Cross Vertical.</p>
    {(["SME_DEBRIEF", "ID_SME_REVIEW"] as const).map((type) => {
      const guide = HISTORICAL_SCHEMA_GUIDES[type];
      return <section key={type}><h3>{guide.label}</h3>
        <p><strong>Required values:</strong> {guide.required.join(", ")}</p>
        <p><strong>Optional values:</strong> {guide.optional.join(", ")}</p>
        <p><strong>Ratings:</strong> {guide.ratings.join(", ")}</p>
        {type === "ID_SME_REVIEW" && <p><strong>Recommendation score:</strong> integer 0 through 10.</p>}
      </section>;
    })}
  </details>;
}
