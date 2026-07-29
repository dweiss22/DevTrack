"use client";

import { useMemo, useState, type FormEvent } from "react";
import type { CanonicalCsvContract } from "@/lib/surveys/csv-contract";

export type HistoricalImportBatch = {
  id: string; source_filename: string; survey_type: string | null; source_timezone: string;
  status: string; summary: Record<string, number | string | null>; created_at: string; integrated_at: string | null;
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
export type HistoricalResolutionAudit = {
  id: number; batch_id: string; row_id: string | null; action: string;
  previous_values: Record<string, unknown>; new_values: Record<string, unknown>; created_at: string;
};

export type HistoricalTemplate = CanonicalCsvContract & { id: string };
export type HistoricalResolutionOption = { id: string; label: string; detail?: string | null };
export type HistoricalResolutionOptions = {
  projects: HistoricalResolutionOption[];
  principals: HistoricalResolutionOption[];
  wrikeUsers: HistoricalResolutionOption[];
};

export function HistoricalSurveyImports({ batches, rows, issues, mappings, templates, resolutionOptions, resolutionAudit }: {
  batches: HistoricalImportBatch[];
  rows: HistoricalImportRow[];
  issues: HistoricalImportIssue[];
  mappings: HistoricalColumnMapping[];
  templates: HistoricalTemplate[];
  resolutionOptions: HistoricalResolutionOptions;
  resolutionAudit: HistoricalResolutionAudit[];
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
    <section className="card historical-template-library">
      <div className="section-heading"><div><p className="eyebrow">START HERE</p><h3>CSV templates and data dictionary</h3>
        <p>Templates are generated from each published survey definition. Use the version you intend to preserve in imported history.</p></div></div>
      {templates.length ? <div className="historical-template-grid">{templates.map((template) => <article className="admin-action-card" key={template.id}>
        <div><strong>{template.title}</strong><p className="muted">Version {template.surveyVersion} · published {new Date(template.publishedAt).toLocaleDateString()}</p></div>
        <div className="filter-bar compact">
          <a className="button" href={`/api/admin/survey-imports/templates/${template.id}?kind=blank`}>Blank template</a>
          <a className="button secondary" href={`/api/admin/survey-imports/templates/${template.id}?kind=example`}>Example CSV</a>
          <a className="button secondary" href={`/api/admin/survey-imports/templates/${template.id}?kind=dictionary`}>Data dictionary</a>
        </div>
        <details><summary>View {template.fields.length} columns and rules</summary>
          <div className="admin-table-wrap"><table><thead><tr><th>CSV column</th><th>Required</th><th>Question / meaning</th><th>Accepted value</th></tr></thead>
            <tbody>{template.fields.map((field) => <tr key={field.column}><td><code>{field.column}</code></td><td>{field.required ? "Yes" : "No"}</td><td>{field.label}<br /><span className="muted">{field.conditionalRequirement}</span></td><td>{field.acceptedFormat}<br /><span className="muted">{field.acceptedValues}</span></td></tr>)}</tbody>
          </table></div>
        </details>
      </article>)}</div> : <p className="notice error">Publish a survey version before creating a canonical import template.</p>}
      <details><summary>Legacy CSV compatibility</summary><p>Existing “ID Review of SME” and “Lexipol Course Development Debrief” exports remain supported. Legacy headings are normalized into the same staged response model, and legacy Internal or due-year values are treated as evidence—not authoritative context.</p></details>
    </section>
    <section className="historical-workflow" aria-labelledby="historical-workflow-title">
      <h3 id="historical-workflow-title">Import workflow</h3>
      <ol className="historical-workflow-steps">
        {["Choose the published survey version", "Download a blank or example template", "Prepare UTF-8 CSV data", "Upload and confirm the source timezone", "Review the dry-run summary", "Resolve project matches", "Resolve identity and assignment evidence", "Correct answer or mapping issues", "Revalidate until rows are ready", "Confirm integration and verify history"].map((step, index) =>
          <li key={step}><span>{index + 1}</span>{step}</li>)}
      </ol>
      <p className="muted">Upload never creates survey records or grants application access. Integration is always a separate confirmed action.</p>
    </section>
    <div className="admin-action-grid">
      <section className="admin-action-card">
        <div><p className="eyebrow">STEP 4 · SAFE STAGING</p><h3>Upload historical survey CSVs</h3>
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
        <td><span className="survey-status draft">{friendlyImportStatus(batch.status)}</span><br /><span className="muted">{batch.summary?.format === "canonical" ? `Canonical v${batch.summary.surveyVersion}` : "Legacy format"}</span></td>
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
      <div className="section-heading"><div><h3>Reconciliation issues</h3><p>Resolve uncertain projects, people, assignments, answers, and duplicate responses. Suggestions are never selected automatically.</p></div>
        <div className="filter-bar compact">
          <label>Batch<select value={batchFilter} onChange={(event) => setBatchFilter(event.target.value)}><option value="">All batches</option>
            {batches.map((batch) => <option key={batch.id} value={batch.id}>{batch.source_filename}</option>)}</select></label>
          <label>Issue<select value={issueFilter} onChange={(event) => setIssueFilter(event.target.value)}><option value="">All issues</option>
            {issueCodes.map((code) => <option key={code}>{code}</option>)}</select></label>
        </div></div>
      {visibleIssues.length ? <div className="historical-issue-list">{visibleIssues.map((item) =>
        <HistoricalIssueCard key={item.id} issue={item} row={item.row_id ? rowById.get(item.row_id) ?? null : null} working={working} setWorking={setWorking} setError={setError} setMessage={setMessage} resolutionOptions={resolutionOptions} audit={resolutionAudit.filter((entry) => entry.row_id === item.row_id)} />
      )}</div> : <p className="empty">No open issues match these filters.</p>}
    </section>
    {mappings.some((item) => item.mapping_target === "unmapped") ? <section>
      <h3>Unmapped columns</h3>
      <p className="muted">Confirm a canonical question/context mapping or explicitly ignore the column with a reason.</p>
      {mappings.filter((item) => item.mapping_target === "unmapped").map((item) => <ColumnMappingForm key={item.id} mapping={item} />)}
    </section> : null}
  </div>;
}

function HistoricalIssueCard({ issue, row, working, setWorking, setError, setMessage, resolutionOptions, audit }: {
  issue: HistoricalImportIssue; row: HistoricalImportRow | null; working: string;
  setWorking: (value: string) => void; setError: (value: boolean) => void; setMessage: (value: string) => void;
  resolutionOptions: HistoricalResolutionOptions;
  audit: HistoricalResolutionAudit[];
}) {
  const presentation = issuePresentation(issue.issue_code);
  const courseName = row?.raw_row.courseName || row?.raw_row["Course Name"] || "Course not identified";
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
    <summary><span><strong>Row {row?.row_number ?? "batch"} · {presentation.title}</strong><small>{presentation.category} · {courseName}</small></span><span className={`survey-status ${issue.severity === "blocking" ? "unlocked" : "draft"}`}>{issue.severity}</span></summary>
    <div><p>{issue.message}</p><p className="muted">{presentation.explanation}</p>
      <dl className="compact-stats">
        <div><dt>Source</dt><dd>{issue.source_field ?? "Whole row"}</dd></div>
        <div><dt>Original value</dt><dd>{typeof issue.raw_value === "string" ? issue.raw_value || "Blank" : "See evidence"}</dd></div>
        <div><dt>Expected</dt><dd>{presentation.expected}</dd></div>
        <div><dt>Current result</dt><dd>{row ? friendlyImportStatus(row.row_status) : "Blocked"}</dd></div>
      </dl>
      <details><summary>Source evidence and suggested matches</summary><pre>{JSON.stringify({ originalRow: row?.raw_row, originalValue: issue.raw_value, suggestedMatches: issue.candidates, normalizedAnswers: row?.normalized_answers, matchResult: row?.match_diagnostics }, null, 2)}</pre></details>
      <details><summary>Resolution history ({audit.length})</summary>{audit.length ? <ol className="detail-list">{audit.map((entry) => <li key={entry.id}><strong>{entry.action.replaceAll("_", " ")}</strong> · {new Date(entry.created_at).toLocaleString()}<pre>{JSON.stringify({ before: entry.previous_values, after: entry.new_values }, null, 2)}</pre></li>)}</ol> : <p className="empty">No administrator resolution has been recorded for this row.</p>}</details>
      {row ? <form onSubmit={resolve} className="historical-resolution-form">
        <SearchableSelect label="Matched project" name="matchedTaskId" options={resolutionOptions.projects} defaultValue={row.matched_task_id ?? ""} />
        <SearchableSelect label="Respondent identity" name="respondentPrincipalId" options={resolutionOptions.principals} defaultValue={row.respondent_principal_id ?? ""} />
        <SearchableSelect label="Reviewed SME identity" name="reviewedWrikeUserId" options={resolutionOptions.wrikeUsers} defaultValue={row.reviewed_wrike_user_id ?? ""} />
        <SearchableSelect label="Create retained historical principal from" name="historicalWrikeUserId" options={resolutionOptions.wrikeUsers} />
        <label>Historical role<select name="historicalRole" defaultValue={row.survey_type === "id_sme_review" ? "id" : "sme"}><option value="id">ID</option><option value="sme">SME</option></select></label>
        <label className="checkbox-row"><input type="checkbox" name="confirmAssignment" /> Confirm the historical assignment context.</label>
        <label>Repeat handling<select name="repeatResolution" defaultValue={row.repeat_resolution ?? ""}><option value="">Not selected</option><option value="retain">Retain this row</option><option value="revision">Integrate as a revision</option></select></label>
        <label>Revision order<input name="revisionOrder" type="number" min="1" defaultValue={row.revision_order ?? ""} /></label>
        <details className="full"><summary>Advanced answer correction</summary>
          <p className="muted">Use only when the issue is an answer value. The published survey definition will be applied again during revalidation.</p>
          <label>Corrected normalized answers (JSON)<textarea name="correctedAnswers" defaultValue={JSON.stringify(row.normalized_answers, null, 2)} rows={8} /></label>
        </details>
        <label className="full">Ignore reason<input name="ignoreReason" minLength={3} /></label>
        <button disabled={working === row.id}>Save correction and revalidate</button>
      </form> : null}
    </div>
  </details>;
}

function SearchableSelect({ label, name, options, defaultValue = "" }: {
  label: string; name: string; options: HistoricalResolutionOption[]; defaultValue?: string;
}) {
  const [query, setQuery] = useState("");
  const visible = options.filter((option) =>
    `${option.label} ${option.detail ?? ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, 100);
  const selected = options.find((option) => option.id === defaultValue);
  if (selected && !visible.some((option) => option.id === selected.id)) visible.unshift(selected);
  return <label>{label}
    <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${label.toLocaleLowerCase()}`} aria-label={`Search ${label}`} />
    <select name={name} defaultValue={defaultValue}><option value="">Not selected</option>
      {visible.map((option) => <option key={option.id} value={option.id}>{option.label}{option.detail ? ` — ${option.detail}` : ""}</option>)}
    </select>
  </label>;
}

function issuePresentation(code: string) {
  const values: Record<string, { category: string; title: string; explanation: string; expected: string }> = {
    missing_project: { category: "Project matching", title: "Project not found", explanation: "The source project could not be matched confidently to one synchronized Wrike task.", expected: "One exact Wrike task ID or course name" },
    ambiguous_project: { category: "Project matching", title: "More than one project matches", explanation: "Multiple projects are plausible and an administrator must choose.", expected: "One authorized project" },
    missing_respondent: { category: "Identity matching", title: "Respondent not found", explanation: "Import values are evidence only and cannot create application access.", expected: "One retained DevTrack principal" },
    ambiguous_respondent: { category: "Identity matching", title: "Respondent is ambiguous", explanation: "More than one retained identity matches the supplied name or email.", expected: "One confirmed respondent" },
    missing_reviewed_sme: { category: "Identity matching", title: "Reviewed SME not found", explanation: "The reviewed SME must resolve without silently creating or merging an identity.", expected: "One verified SME identity" },
    ambiguous_reviewed_sme: { category: "Identity matching", title: "Reviewed SME is ambiguous", explanation: "An administrator must choose between the candidate SME identities.", expected: "One confirmed reviewed SME" },
    missing_assignment: { category: "Assignment evidence", title: "Project assignment differs", explanation: "The imported person is not present in the synchronized assignment context.", expected: "Confirmed historical assignment" },
    invalid_answer: { category: "Answer validation", title: "Answer needs correction", explanation: "The value does not satisfy the referenced survey version’s question rules.", expected: "A value accepted by the published definition" },
    missing_timestamp: { category: "Timestamp", title: "Submission time is invalid", explanation: "Historical order and immutable submission time require a valid timestamp.", expected: "ISO timestamp, or a supported legacy timestamp" },
    question_mapping_problem: { category: "Column mapping", title: "Column needs mapping", explanation: "This heading is not part of the detected canonical or legacy contract.", expected: "A canonical mapping or explicit ignore reason" },
    duplicate_response: { category: "Duplicates", title: "Duplicate response", explanation: "The same response fingerprint already exists or appears more than once.", expected: "Explicit duplicate resolution" },
    repeat_identity: { category: "Duplicates", title: "Possible response revision", explanation: "Distinct responses share the same project and participants.", expected: "Retain one or order them as revisions" },
    canonical_collision: { category: "Existing history", title: "Survey history already exists", explanation: "A canonical survey already occupies this project and identity context.", expected: "Explicit reconciliation before integration" },
  };
  return values[code] ?? { category: "Integration", title: code.replaceAll("_", " "), explanation: "This row needs administrator review before integration.", expected: "A confirmed resolution" };
}

function friendlyImportStatus(status: string) {
  const labels: Record<string, string> = {
    invalid: "Blocked",
    staged: "Needs review",
    issues: "Needs review",
    ready: "Ready",
    resolved: "Resolved",
    integrated: "Integrated",
    completed: "Integrated",
    partially_integrated: "Partially integrated",
    rolled_back: "Rolled back",
    duplicate: "Duplicate",
  };
  return labels[status] ?? status.replaceAll("_", " ");
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
