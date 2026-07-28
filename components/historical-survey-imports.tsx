"use client";

import { useMemo, useState, type FormEvent } from "react";

export type HistoricalImportBatch = {
  id: string; source_filename: string; survey_type: string | null; source_timezone: string;
  status: string; summary: Record<string, number>; created_at: string; integrated_at: string | null;
  rolled_back_at: string | null;
};
export type HistoricalImportRow = {
  id: string; batch_id: string; row_number: number; survey_type: string; raw_row: Record<string, string>;
  normalized_answers: Record<string, unknown>; match_diagnostics: Record<string, unknown>;
  matched_task_id: string | null; respondent_principal_id: string | null;
  reviewed_wrike_user_id: string | null; repeat_resolution: string | null;
  revision_order: number | null; row_status: string;
};
export type HistoricalImportIssue = {
  id: string; batch_id: string; row_id: string | null; issue_code: string; severity: string;
  source_field: string | null; message: string; raw_value: unknown; candidates: unknown[];
};
export type HistoricalColumnMapping = {
  id: string; batch_id: string; original_heading: string; canonical_question_id: string | null;
  mapping_target: string; normalized_conversion: string | null; mapping_source: string;
};

export function HistoricalSurveyImports({ batches, rows, issues, mappings }: {
  batches: HistoricalImportBatch[];
  rows: HistoricalImportRow[];
  issues: HistoricalImportIssue[];
  mappings: HistoricalColumnMapping[];
}) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [working, setWorking] = useState("");
  const [batchFilter, setBatchFilter] = useState("");
  const [issueFilter, setIssueFilter] = useState("");
  const visibleIssues = useMemo(() => issues.filter((issue) =>
    (!batchFilter || issue.batch_id === batchFilter) && (!issueFilter || issue.issue_code === issueFilter)
  ), [batchFilter, issueFilter, issues]);
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const issueCodes = [...new Set(issues.map((issue) => issue.issue_code))].sort();
  const readyRows = rows.filter((row) => row.row_status === "ready");

  function reloadWithMessage(value: string) {
    sessionStorage.setItem("devtrack-data-message", value);
    location.reload();
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    data.set("confirmTimezone", String(data.get("confirmTimezone") === "on"));
    setWorking("upload"); setError(false); setMessage("Parsing and staging historical survey rows…");
    try {
      const response = await fetch("/api/admin/survey-imports", { method: "POST", body: data });
      const payload = await response.json() as { error?: string; batches?: { totalRows: number; readyRows: number; issueRows: number; duplicateUpload: boolean }[] };
      if (!response.ok) throw new Error(payload.error ?? "Historical surveys could not be staged.");
      const total = (payload.batches ?? []).reduce((sum, batch) => sum + batch.totalRows, 0);
      const ready = (payload.batches ?? []).reduce((sum, batch) => sum + batch.readyRows, 0);
      const issueRows = (payload.batches ?? []).reduce((sum, batch) => sum + batch.issueRows, 0);
      reloadWithMessage(`Historical survey dry run complete — ${total} rows staged, ${ready} ready, and ${issueRows} requiring review. No canonical surveys were created.`);
    } catch (reason) {
      setError(true); setMessage(reason instanceof Error ? reason.message : "Historical surveys could not be staged.");
      setWorking("");
    }
  }

  async function batchAction(batchId: string, action: "integrate" | "rollback") {
    if (action === "integrate" && !confirm("Integrate every currently ready row into canonical survey history? Unresolved rows will remain staged.")) return;
    if (action === "rollback" && !confirm("Roll back every untouched canonical survey created by this batch?")) return;
    setWorking(`${batchId}:${action}`); setError(false); setMessage("");
    try {
      const response = await fetch(`/api/admin/survey-imports/${batchId}/${action}`, { method: "POST" });
      const payload = await response.json() as { error?: string; result?: { integrated?: number; failed?: number; rolledBackSubmissions?: number } };
      if (!response.ok) throw new Error(payload.error ?? `Historical import ${action} failed.`);
      reloadWithMessage(action === "integrate"
        ? `Historical integration complete — ${payload.result?.integrated ?? 0} rows integrated and ${payload.result?.failed ?? 0} failed.`
        : `Historical rollback complete — ${payload.result?.rolledBackSubmissions ?? 0} canonical submissions removed.`);
    } catch (reason) {
      setError(true); setMessage(reason instanceof Error ? reason.message : `Historical import ${action} failed.`);
      setWorking("");
    }
  }

  async function revalidateBatch(batchId: string) {
    setWorking(`${batchId}:revalidate`); setError(false); setMessage("");
    try {
      const response = await fetch(`/api/admin/survey-imports/${batchId}/revalidate`, { method: "POST" });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "The batch could not be revalidated.");
      reloadWithMessage("Historical import matches and issue states were revalidated.");
    } catch (reason) {
      setError(true); setMessage(reason instanceof Error ? reason.message : "The batch could not be revalidated.");
      setWorking("");
    }
  }

  async function integrateRow(row: HistoricalImportRow) {
    if (!confirm(`Integrate historical row ${row.row_number} into canonical survey history?`)) return;
    setWorking(`${row.id}:integrate`); setError(false); setMessage("");
    try {
      const response = await fetch(`/api/admin/survey-imports/rows/${row.id}/integrate`, { method: "POST" });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "The historical row could not be integrated.");
      reloadWithMessage(`Historical row ${row.row_number} was integrated and verified.`);
    } catch (reason) {
      setError(true); setMessage(reason instanceof Error ? reason.message : "The historical row could not be integrated.");
      setWorking("");
    }
  }

  return <div className="admin-section-content historical-imports">
    {message && <p className={error ? "notice error" : "notice"} role={error ? "alert" : "status"}>{message}</p>}
    <div className="admin-action-grid">
      <section className="admin-action-card">
        <div><p className="eyebrow">SAFE STAGING</p><h3>Upload historical survey CSVs</h3>
          <p>Uploads create a dry run and issue records only. Ready rows require a separate integration action.</p></div>
        <form onSubmit={upload} className="historical-upload-form">
          <label>CSV files<input type="file" name="files" accept=".csv,text/csv" multiple required /></label>
          <label>Source timezone<select name="timezone" defaultValue="America/Chicago">
            <option value="America/Chicago">America/Chicago (Central)</option>
            <option value="America/New_York">America/New_York (Eastern)</option>
            <option value="America/Denver">America/Denver (Mountain)</option>
            <option value="America/Los_Angeles">America/Los_Angeles (Pacific)</option>
            <option value="UTC">UTC</option>
          </select></label>
          <label className="checkbox-row"><input type="checkbox" name="confirmTimezone" required /> I confirm this timezone applies to offset-free CSV timestamps.</label>
          <button disabled={Boolean(working)}>{working === "upload" ? "Staging…" : "Upload and run dry run"}</button>
        </form>
      </section>
      <section className="admin-action-card">
        <div><p className="eyebrow">RECONCILIATION</p><h3>Current staged totals</h3>
          <p>Only rows with confident project, respondent, SME, assignment, answer, and timestamp matches become ready.</p></div>
        <dl className="compact-stats">
          <div><dt>Batches</dt><dd>{batches.length}</dd></div>
          <div><dt>Rows</dt><dd>{batches.reduce((sum, batch) => sum + Number(batch.summary?.totalRows ?? 0), 0)}</dd></div>
          <div><dt>Ready</dt><dd>{batches.reduce((sum, batch) => sum + Number(batch.summary?.readyRows ?? 0), 0)}</dd></div>
          <div><dt>Open issues</dt><dd>{issues.length}</dd></div>
        </dl>
      </section>
    </div>
    <section>
      <h3>Import batches</h3>
      {batches.length ? <div className="admin-table-wrap"><table><thead><tr>
        <th>Uploaded</th><th>Source</th><th>Status</th><th>Dry-run reconciliation</th><th>Actions</th>
      </tr></thead><tbody>{batches.map((batch) => <tr key={batch.id}>
        <td>{new Date(batch.created_at).toLocaleString()}</td>
        <td><strong>{batch.source_filename}</strong><br /><span className="muted">{batch.survey_type?.replaceAll("_", " ") ?? "Unrecognized"} · {batch.source_timezone}</span></td>
        <td>{batch.status}</td>
        <td>{Number(batch.summary?.totalRows ?? 0)} total · {Number(batch.summary?.readyRows ?? 0)} ready<br />
          <span className="muted">{Number(batch.summary?.issueRows ?? 0)} issue rows · {Number(batch.summary?.integratedRows ?? 0)} integrated</span></td>
        <td><div className="filter-bar compact">
          <button onClick={() => batchAction(batch.id, "integrate")} disabled={Boolean(working) || Number(batch.summary?.readyRows ?? 0) === 0}>Integrate ready rows</button>
          <button className="secondary" onClick={() => revalidateBatch(batch.id)} disabled={Boolean(working) || batch.status === "rolled_back"}>Revalidate</button>
          <button className="secondary" onClick={() => batchAction(batch.id, "rollback")} disabled={Boolean(working) || !["completed", "partially_integrated"].includes(batch.status)}>Roll back</button>
        </div></td>
      </tr>)}</tbody></table></div> : <p className="empty">No historical survey files have been staged.</p>}
    </section>
    <section>
      <h3>Ready rows</h3>
      <p className="muted">These rows have no open blocking issues. Integrate one row for representative verification or use the batch action above after approving the full reconciliation.</p>
      {readyRows.length ? <div className="admin-table-wrap"><table><thead><tr><th>Batch</th><th>Row</th><th>Survey</th><th>Course</th><th>Action</th></tr></thead>
        <tbody>{readyRows.map((row) => {
          const batch = batches.find((item) => item.id === row.batch_id);
          return <tr key={row.id}>
            <td>{batch?.source_filename ?? row.batch_id}</td>
            <td>{row.row_number}</td>
            <td>{row.survey_type.replaceAll("_", " ")}</td>
            <td>{row.raw_row["Course Name"] || "Unnamed course"}</td>
            <td><button onClick={() => integrateRow(row)} disabled={Boolean(working)}>Integrate row</button></td>
          </tr>;
        })}</tbody></table></div> : <p className="empty">No rows are ready for integration.</p>}
    </section>
    <section>
      <div className="section-heading"><div><h3>Survey Data Issues</h3><p>Resolve or explicitly ignore every uncertain value. Candidate suggestions are never selected automatically.</p></div>
        <div className="filter-bar compact">
          <label>Batch<select value={batchFilter} onChange={(event) => setBatchFilter(event.target.value)}><option value="">All batches</option>
            {batches.map((batch) => <option key={batch.id} value={batch.id}>{batch.source_filename}</option>)}</select></label>
          <label>Issue<select value={issueFilter} onChange={(event) => setIssueFilter(event.target.value)}><option value="">All issues</option>
            {issueCodes.map((code) => <option key={code}>{code}</option>)}</select></label>
        </div></div>
      {visibleIssues.length ? <div className="historical-issue-list">{visibleIssues.map((item) =>
        <HistoricalIssueCard key={item.id} issue={item} row={item.row_id ? rowById.get(item.row_id) ?? null : null} working={working} setWorking={setWorking} setError={setError} setMessage={setMessage} />
      )}</div> : <p className="empty">No open issues match these filters.</p>}
    </section>
    {mappings.some((item) => item.mapping_target === "unmapped") ? <section>
      <h3>Unmapped columns</h3>
      <p className="muted">Confirm a canonical question/context mapping or explicitly ignore the column with a reason.</p>
      {mappings.filter((item) => item.mapping_target === "unmapped").map((item) => <ColumnMappingForm key={item.id} mapping={item} />)}
    </section> : null}
  </div>;
}

function HistoricalIssueCard({ issue, row, working, setWorking, setError, setMessage }: {
  issue: HistoricalImportIssue; row: HistoricalImportRow | null; working: string;
  setWorking: (value: string) => void; setError: (value: boolean) => void; setMessage: (value: string) => void;
}) {
  async function resolve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!row) return;
    const form = new FormData(event.currentTarget);
    const body: Record<string, unknown> = {};
    const copy = (formKey: string, bodyKey: string) => {
      const value = String(form.get(formKey) ?? "").trim();
      if (value) body[bodyKey] = value;
    };
    copy("matchedTaskId", "matchedTaskId");
    copy("respondentPrincipalId", "respondentPrincipalId");
    copy("reviewedWrikeUserId", "reviewedWrikeUserId");
    copy("historicalWrikeUserId", "historicalWrikeUserId");
    copy("historicalRole", "historicalRole");
    copy("repeatResolution", "repeatResolution");
    copy("ignoreReason", "ignoreReason");
    const order = Number(form.get("revisionOrder"));
    if (Number.isInteger(order) && order > 0) body.revisionOrder = order;
    if (form.get("confirmAssignment") === "on") body.confirmAssignment = true;
    const answers = String(form.get("correctedAnswers") ?? "").trim();
    if (answers) {
      try { body.correctedAnswers = JSON.parse(answers); }
      catch { setError(true); setMessage("Corrected answers must be valid JSON."); return; }
    }
    setWorking(row.id); setError(false); setMessage("");
    try {
      const response = await fetch(`/api/admin/survey-imports/rows/${row.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "The historical row could not be updated.");
      sessionStorage.setItem("devtrack-data-message", `Historical row ${row.row_number} was revalidated.`);
      location.reload();
    } catch (reason) {
      setError(true); setMessage(reason instanceof Error ? reason.message : "The historical row could not be updated.");
      setWorking("");
    }
  }
  return <details className="card historical-issue-card">
    <summary><span><strong>Row {row?.row_number ?? "batch"}</strong> · {issue.issue_code.replaceAll("_", " ")}</span><span className={`survey-status ${issue.severity === "blocking" ? "unlocked" : "draft"}`}>{issue.severity}</span></summary>
    <div><p>{issue.message}</p>{issue.source_field ? <p><strong>Source field:</strong> {issue.source_field}</p> : null}
      <details><summary>Original row and candidates</summary><pre>{JSON.stringify({ rawRow: row?.raw_row, rawValue: issue.raw_value, candidates: issue.candidates }, null, 2)}</pre></details>
      {row ? <form onSubmit={resolve} className="historical-resolution-form">
        <label>Project UUID<input name="matchedTaskId" defaultValue={row.matched_task_id ?? ""} /></label>
        <label>Respondent principal UUID<input name="respondentPrincipalId" defaultValue={row.respondent_principal_id ?? ""} /></label>
        <label>Reviewed SME Wrike UUID<input name="reviewedWrikeUserId" defaultValue={row.reviewed_wrike_user_id ?? ""} /></label>
        <label>Create historical principal from Wrike UUID<input name="historicalWrikeUserId" /></label>
        <label>Historical role<select name="historicalRole" defaultValue={row.survey_type === "id_sme_review" ? "id" : "sme"}><option value="id">ID</option><option value="sme">SME</option></select></label>
        <label className="checkbox-row"><input type="checkbox" name="confirmAssignment" /> Confirm the historical assignment context.</label>
        <label>Repeat handling<select name="repeatResolution" defaultValue={row.repeat_resolution ?? ""}><option value="">Not selected</option><option value="retain">Retain this row</option><option value="revision">Integrate as a revision</option></select></label>
        <label>Revision order<input name="revisionOrder" type="number" min="1" defaultValue={row.revision_order ?? ""} /></label>
        <label className="full">Corrected normalized answers (JSON)<textarea name="correctedAnswers" defaultValue={JSON.stringify(row.normalized_answers, null, 2)} rows={8} /></label>
        <label className="full">Ignore reason<input name="ignoreReason" minLength={3} /></label>
        <button disabled={working === row.id}>Save correction and revalidate</button>
      </form> : null}
    </div>
  </details>;
}

function ColumnMappingForm({ mapping }: { mapping: HistoricalColumnMapping }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/admin/survey-imports/columns/${mapping.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mappingTarget: form.get("mappingTarget"), canonicalQuestionId: String(form.get("canonicalQuestionId") ?? "") || undefined,
        conversion: String(form.get("conversion") ?? "") || undefined, reason: form.get("reason"),
      }),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) { alert(payload.error ?? "Column mapping could not be saved."); return; }
    location.reload();
  }
  return <form onSubmit={submit} className="card historical-column-form">
    <strong>{mapping.original_heading}</strong>
    <label>Target<select name="mappingTarget"><option value="context">Source context</option><option value="answer">Survey answer</option><option value="identity">Identity</option><option value="timestamp">Timestamp</option><option value="ignored">Ignore</option></select></label>
    <label>Canonical ID<input name="canonicalQuestionId" /></label>
    <label>Conversion<input name="conversion" /></label>
    <label>Reason<input name="reason" required minLength={3} /></label>
    <button>Confirm mapping</button>
  </form>;
}
