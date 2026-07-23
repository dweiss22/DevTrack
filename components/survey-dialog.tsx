"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AGREEMENT_SCALE,
  COLLABORATION_SCALE,
  EXAMPLE_EFFECTIVENESS_SCALE,
  ID_REVIEW_STATEMENTS,
  SME_DEBRIEF_STATEMENTS,
  SURVEY_VERTICALS,
  debriefDraftSchema,
  idReviewDraftSchema,
  surveyTitle,
  type AssignedSme,
  type SurveyContext,
  type SurveyType,
} from "@/lib/surveys/domain";

type Detail = {
  submission: {
    id: string; survey_type: SurveyType; status: "draft" | "submitted"; is_locked: boolean;
    revision_number: number; created_by: string; subject_application_user_id: string | null;
    revision_assignee_id: string | null; context_snapshot: Record<string, unknown>; unlock_reason: string | null;
    original_submitted_at: string | null; latest_submitted_at: string | null;
  };
  response: Record<string, string | number | boolean | null>;
  attachments: { id: string; original_filename: string; mime_type: string; size_bytes: number; uploaded_at: string }[];
  viewer: { role: string; canEdit: boolean; canManage: boolean };
  audit?: { id: number; event_type: string; actor_role: string; actor_name: string; reason: string | null; created_at: string }[];
  revisions?: { id: string; revision_number: number; submitted_at: string; submitted_by_name: string }[];
  revisers?: { id: string; display_name: string | null }[];
};

type Answers = Record<string, string | number | boolean>;

export function SurveyDialog({ taskId, surveyType, submissionId, fallbackHref, initialSmeWrikeId, forceReadOnly = false }: {
  taskId?: string;
  surveyType?: SurveyType;
  submissionId?: string;
  fallbackHref: string;
  initialSmeWrikeId?: string;
  forceReadOnly?: boolean;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [context, setContext] = useState<SurveyContext | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [selectedSme, setSelectedSme] = useState("");
  const [answers, setAnswers] = useState<Answers>({});
  const [baseline, setBaseline] = useState("");
  const [state, setState] = useState<"loading" | "select-sme" | "ready" | "success" | "error">("loading");
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [critical, setCritical] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const dirty = state === "ready" && baseline !== JSON.stringify(answers);
  const type = detail?.submission.survey_type ?? surveyType;
  const locked = detail?.submission.is_locked ?? false;
  const editable = Boolean(!forceReadOnly && detail?.viewer.canEdit && !locked);

  const loadDetail = useCallback(async (id: string) => {
    const response = await fetch(`/api/surveys/${id}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Survey is unavailable.");
    const loaded = data as Detail;
    const mapped = answersFromResponse(loaded.submission.survey_type, loaded.response);
    setDetail(loaded);
    setAnswers(mapped);
    setBaseline(JSON.stringify(mapped));
    setState("ready");
  }, []);

  const createSurvey = useCallback(async (selectedWrikeId?: string) => {
    if (!taskId || !surveyType) return;
    const selected = context?.assignedSmes.find((sme) => sme.wrikeUserId === selectedWrikeId);
    setCritical(true);
    try {
      const response = await fetch("/api/surveys", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskId, surveyType,
          smeApplicationUserId: surveyType === "course_development_debrief" ? selected?.applicationUserId ?? null : null,
          reviewedWrikeUserId: selectedWrikeId || selected?.wrikeUserId || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Survey context is unavailable.");
      await loadDetail(data.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Survey context is unavailable.");
      setState("error");
    } finally {
      setCritical(false);
    }
  }, [context, loadDetail, surveyType, taskId]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);

  useEffect(() => {
    if (submissionId) {
      loadDetail(submissionId).catch((error) => { setMessage(error.message); setState("error"); });
      return;
    }
    if (!taskId || !surveyType) return;
    const query = new URLSearchParams({ taskId, type: surveyType });
    fetch(`/api/surveys/context?${query}`, { cache: "no-store" }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      const loaded = data.context as SurveyContext;
      setContext(loaded);
      const requestedSme = initialSmeWrikeId
        ? loaded.assignedSmes.find((sme) => sme.wrikeUserId === initialSmeWrikeId) : null;
      if (initialSmeWrikeId && !requestedSme) throw new Error("The selected SME is not assigned to this project.");
      if (loaded.viewer.role === "sme" && surveyType === "course_development_debrief") {
        const self = loaded.assignedSmes.find((sme) => sme.applicationUserId === loaded.viewer.id);
        if (!self) throw new Error("Your verified SME assignment could not be resolved.");
        setContext(loaded);
        return;
      }
      if (requestedSme) { setSelectedSme(requestedSme.wrikeUserId); setState("select-sme"); return; }
      if (loaded.assignedSmes.length === 1) { setSelectedSme(loaded.assignedSmes[0].wrikeUserId); setState("select-sme"); return; }
      if (loaded.assignedSmes.length > 1) return setState("select-sme");
      throw new Error("No verified SME is assigned to this project.");
    }).catch((error) => {
      setMessage(error instanceof Error ? error.message : "Survey context is unavailable.");
      setState("error");
    });
  }, [initialSmeWrikeId, loadDetail, submissionId, surveyType, taskId]);

  useEffect(() => {
    if (!context || context.viewer.role !== "sme" || surveyType !== "course_development_debrief" || detail) return;
    const self = context.assignedSmes.find((sme) => sme.applicationUserId === context.viewer.id);
    if (self) void createSurvey(self.wrikeUserId);
  }, [context, createSurvey, detail, surveyType]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function close() {
    if (critical) return;
    if (dirty && !window.confirm("You have unsaved changes. Close this survey and discard them?")) return;
    dialogRef.current?.close();
    if (window.history.length > 1) router.back();
    else router.replace(fallbackHref);
  }

  function onCancel(event: React.SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault();
    close();
  }

  function update(name: string, value: string | number | boolean) {
    setAnswers((current) => {
      const next = { ...current, [name]: value };
      if (name === "internalEmployee" && value === true) {
        next.billableHours = ""; next.amountBilled = "";
      }
      if (name === "providedRealWorldExamples" && value === false) next.realWorldExamplesEffectiveness = "";
      return next;
    });
    setFieldErrors((current) => ({ ...current, [name]: "" }));
  }

  async function save(submit: boolean) {
    if (!detail || !type || critical) return;
    setMessage("");
    setFieldErrors({});
    const schema = type === "course_development_debrief" ? debriefDraftSchema : idReviewDraftSchema;
    const parsed = schema.safeParse(answers);
    if (!parsed.success) {
      setFieldErrors(Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message])));
      setMessage("Review the highlighted survey fields.");
      return;
    }
    if (submit) {
      const required = requiredFieldErrors(type, answers, detail.attachments.length > 0);
      if (Object.keys(required).length) {
        setFieldErrors(required); setMessage("Complete every required field before submitting."); return;
      }
    }
    setCritical(true);
    try {
      const response = await fetch(`/api/surveys/${detail.submission.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ surveyType: type, submit, answers }),
      });
      const data = await response.json();
      if (!response.ok) {
        setFieldErrors(Object.fromEntries(Object.entries(data.fieldErrors ?? {}).map(([key, value]) => [key, Array.isArray(value) ? String(value[0]) : String(value)])));
        throw new Error(data.error ?? "The survey could not be saved.");
      }
      if (submit) setState("success");
      else {
        setBaseline(JSON.stringify(answers));
        setMessage(detail.submission.status === "submitted" ? "Revision saved." : "Draft saved.");
        await loadDetail(detail.submission.id);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The survey could not be saved.");
    } finally {
      setCritical(false);
    }
  }

  function uploadInvoice(file: File) {
    if (!detail || critical) return;
    setCritical(true); setUploadProgress(0); setMessage("");
    const form = new FormData(); form.set("invoice", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/surveys/${detail.submission.id}/invoice`);
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) setUploadProgress(Math.round(event.loaded / event.total * 100)); };
    xhr.onload = async () => {
      const data = JSON.parse(xhr.responseText || "{}");
      if (xhr.status >= 200 && xhr.status < 300) {
        setMessage("Invoice uploaded successfully.");
        await loadDetail(detail.submission.id);
      } else setMessage(data.error ?? "The invoice could not be uploaded.");
      setCritical(false); setUploadProgress(null);
    };
    xhr.onerror = () => { setMessage("The invoice upload failed."); setCritical(false); setUploadProgress(null); };
    xhr.send(form);
  }

  async function removeInvoice(attachmentId: string) {
    if (!detail || critical) return;
    setCritical(true);
    const response = await fetch(`/api/surveys/${detail.submission.id}/invoice`, {
      method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ attachmentId }),
    });
    const data = await response.json();
    setMessage(response.ok ? "Invoice removed." : data.error ?? "The invoice could not be removed.");
    if (response.ok) await loadDetail(detail.submission.id);
    setCritical(false);
  }

  async function downloadInvoice(attachmentId: string) {
    if (!detail) return;
    const response = await fetch(`/api/surveys/${detail.submission.id}/invoice/${attachmentId}/download`);
    const data = await response.json();
    if (response.ok) window.location.assign(data.url);
    else setMessage(data.error ?? "The invoice download could not be prepared.");
  }

  const title = type ? surveyTitle(type) : "Course-development survey";
  const contextSnapshot = (detail?.submission.context_snapshot ?? context ?? {}) as Record<string, unknown>;
  const subject = (contextSnapshot.subject ?? {}) as Record<string, unknown>;

  return <dialog ref={dialogRef} className="survey-dialog" aria-labelledby="survey-dialog-title" onCancel={onCancel}>
    <div className="survey-dialog-shell">
      <header className="survey-dialog-header">
        <div><p className="eyebrow">COURSE DEVELOPMENT</p><h1 id="survey-dialog-title">{title}</h1>
          {type === "id_sme_review" && <p>It’s time to share your insights on your recent work with the SME assigned to this project.</p>}
        </div>
        <button type="button" className="secondary survey-close" onClick={close} disabled={critical} aria-label="Close survey">Close</button>
      </header>

      {state === "loading" && <div className="survey-state" role="status"><span className="loading-pulse" />Loading trusted project context…</div>}
      {state === "error" && <div className="survey-state error" role="alert"><h2>Survey context could not be resolved</h2><p>{message}</p><button onClick={close}>Return</button></div>}
      {state === "select-sme" && context && <div className="survey-state">
        <h2>Select the assigned project SME</h2><p>Only verified SMEs assigned to this project are available.</p>
        <label>Project SME<select value={selectedSme} onChange={(event) => setSelectedSme(event.target.value)}>
          <option value="">Select an SME</option>{context.assignedSmes.map((sme) => <option key={sme.wrikeUserId} value={sme.wrikeUserId}
            disabled={surveyType === "course_development_debrief" && !sme.applicationUserId}>{sme.name}{!sme.applicationUserId ? " — no DevTrack account" : ""}</option>)}
        </select></label>
        <button disabled={!selectedSme || critical} onClick={() => createSurvey(selectedSme)}>Continue</button>
      </div>}
      {state === "success" && <div className="survey-state notice" role="status"><h2>Survey submitted successfully</h2><p>Your response is locked and its revision history has been preserved.</p><button onClick={close}>Return to project</button></div>}
      {state === "ready" && detail && type && <>
        <div className="survey-status-row">
          <span className={`survey-status ${detail.submission.status}`}>{detail.submission.status === "draft" ? "Draft" : "Submitted"}</span>
          <span className={`survey-status ${locked ? "locked" : "unlocked"}`}>{locked ? "Locked" : detail.submission.status === "submitted" ? "Unlocked for Revision" : "Editable"}</span>
          <span>Revision {detail.submission.revision_number}</span>
        </div>
        {!locked && detail.submission.status === "submitted" && <p className="notice warning" role="status"><strong>Unlocked for Revision.</strong> {detail.submission.unlock_reason}</p>}
        <ContextHeader type={type} context={contextSnapshot} subject={subject} />
        {message && <p className={message.includes("saved") || message.includes("success") || message.includes("removed") ? "notice" : "notice warning"} role="status">{message}</p>}
        {!editable
          ? <ReadOnlySurveyResponse type={type} answers={answers} detail={detail} downloadInvoice={downloadInvoice} />
          : type === "course_development_debrief"
            ? <DebriefForm answers={answers} update={update} errors={fieldErrors} editable detail={detail} uploadInvoice={uploadInvoice} removeInvoice={removeInvoice} downloadInvoice={downloadInvoice} uploadProgress={uploadProgress} />
            : <IdReviewForm answers={answers} update={update} errors={fieldErrors} editable detail={detail} />}
        {detail.viewer.canManage && <AdminSurveyControls detail={detail} context={contextSnapshot} critical={critical} setCritical={setCritical} setMessage={setMessage} reload={() => loadDetail(detail.submission.id)} />}
        <footer className="survey-actions">
          <button type="button" className="secondary" onClick={close} disabled={critical}>Close</button>
          {editable && <><button type="button" className="secondary" onClick={() => save(false)} disabled={critical}>{critical ? "Working…" : "Save draft"}</button>
            <button type="button" onClick={() => save(true)} disabled={critical}>{detail.submission.status === "submitted" ? "Resubmit and lock" : "Submit and lock"}</button></>}
        </footer>
      </>}
    </div>
  </dialog>;
}

function AdminSurveyControls({ detail, context, critical, setCritical, setMessage, reload }: {
  detail: Detail; context: Record<string, unknown>; critical: boolean;
  setCritical: (value: boolean) => void; setMessage: (value: string) => void; reload: () => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [reviserId, setReviserId] = useState(detail.submission.revision_assignee_id ?? "");
  const [year, setYear] = useState(String(detail.submission.survey_type === "course_development_debrief" ? context.originalDueYear ?? "" : context.publicationYear ?? ""));
  const [vertical, setVertical] = useState(String(context.vertical ?? ""));

  async function act(body: Record<string, unknown>, success: string) {
    setCritical(true); setMessage("");
    const response = await fetch(`/api/surveys/${detail.submission.id}/actions`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await response.json();
    setMessage(response.ok ? success : data.error ?? "The administrative action failed.");
    if (response.ok) await reload();
    setCritical(false);
  }

  return <section className="survey-admin card" aria-labelledby="survey-admin-heading">
    <h2 id="survey-admin-heading">Survey administration</h2>
    {detail.submission.status === "submitted" && detail.submission.is_locked && <div className="survey-admin-action">
      <label>Required unlock reason<textarea value={reason} maxLength={2000} onChange={(event) => setReason(event.target.value)} /></label>
      {detail.submission.survey_type === "id_sme_review" && <label>Optional revision assignee<select value={reviserId} onChange={(event) => setReviserId(event.target.value)}><option value="">Original author</option>{detail.revisers?.map((user) => <option key={user.id} value={user.id}>{user.display_name ?? "Unnamed ID"}</option>)}</select></label>}
      <button type="button" disabled={critical || !reason.trim()} onClick={() => act({ action: "unlock", reason, reviserId: reviserId || null }, "Survey unlocked for revision.")}>Unlock for revision</button>
    </div>}
    {(detail.submission.status === "draft" || !detail.submission.is_locked) && <div className="survey-admin-action">
      {detail.submission.status === "submitted" && detail.submission.survey_type === "id_sme_review" && <label>Revision assignee<select value={reviserId} onChange={(event) => setReviserId(event.target.value)}><option value="">Select an ID</option>{detail.revisers?.map((user) => <option key={user.id} value={user.id}>{user.display_name ?? "Unnamed ID"}</option>)}</select></label>}
      {detail.submission.status === "submitted" && detail.submission.survey_type === "id_sme_review" && <button type="button" className="secondary" disabled={critical || !reviserId} onClick={() => act({ action: "assign_reviser", reviserId }, "Revision access reassigned.")}>Assign revision access</button>}
      {detail.submission.status === "submitted" && <button type="button" className="secondary" disabled={critical} onClick={() => act({ action: "relock" }, "Pending edits discarded and the submitted revision relocked.")}>Relock submitted revision</button>}
      <div className="survey-context-correction">
        <h3>Correct trusted survey context</h3>
        {detail.submission.survey_type === "course_development_debrief"
          ? <label>Original Due Year<input type="number" min="1000" max="9999" value={year} onChange={(event) => setYear(event.target.value)} /></label>
          : <><label>Publication Year<input type="number" min="1000" max="9999" value={year} onChange={(event) => setYear(event.target.value)} /></label>
            <label>Vertical<select value={vertical} onChange={(event) => setVertical(event.target.value)}><option value="">Select Vertical</option>{SURVEY_VERTICALS.map((item) => <option key={item}>{item}</option>)}</select></label></>}
        <button type="button" className="secondary" disabled={critical || year.length !== 4 || (detail.submission.survey_type === "id_sme_review" && !vertical)} onClick={() => act({
          action: "correct_context",
          corrections: detail.submission.survey_type === "course_development_debrief" ? { originalDueYear: Number(year) } : { publicationYear: Number(year), vertical },
        }, "Survey context corrected and recorded in the audit log.")}>Save context correction</button>
      </div>
    </div>}
    <details><summary>Revision history ({detail.revisions?.length ?? 0})</summary>{detail.revisions?.length
      ? <ol>{detail.revisions.map((revision) => <li key={revision.id}>Revision {revision.revision_number} by {revision.submitted_by_name} — {new Date(revision.submitted_at).toLocaleString()}</li>)}</ol>
      : <p>No submitted revisions yet.</p>}</details>
    <details><summary>Audit history ({detail.audit?.length ?? 0})</summary>{detail.audit?.length
      ? <ol>{detail.audit.map((event) => <li key={event.id}><strong>{event.event_type.replaceAll("_", " ")}</strong> by {event.actor_name} ({event.actor_role}) — {new Date(event.created_at).toLocaleString()}{event.reason ? ` — ${event.reason}` : ""}</li>)}</ol>
      : <p>No audit events are available.</p>}</details>
  </section>;
}

function ContextHeader({ type, context, subject }: { type: SurveyType; context: Record<string, unknown>; subject: Record<string, unknown> }) {
  const viewer = (context.viewer ?? {}) as Record<string, unknown>;
  const values = type === "course_development_debrief"
    ? [["SME", subject.name], ["Email", subject.email ?? "Available from authenticated profile"], ["Course", context.taskTitle], ["Original Due Date", formatDate(context.originalDueDate)]]
    : [["Instructional Designer", viewer.name], ["Course", context.taskTitle], ["Project SME", subject.name], ["Vertical", context.vertical ?? "Requires resolution"], ["Publication Date", formatDate(context.publicationDate)], ["Publication Year", context.publicationYear ?? "Enter below"]];
  return <dl className="survey-context">{values.map(([label, value]) => <div key={String(label)}><dt>{String(label)}</dt><dd>{String(value ?? "Unavailable")}</dd></div>)}</dl>;
}

function ReadOnlySurveyResponse({ type, answers, detail, downloadInvoice }: {
  type: SurveyType;
  answers: Answers;
  detail: Detail;
  downloadInvoice: (id: string) => void;
}) {
  const statements = type === "course_development_debrief" ? SME_DEBRIEF_STATEMENTS : ID_REVIEW_STATEMENTS;
  const scale = type === "course_development_debrief" ? AGREEMENT_SCALE : COLLABORATION_SCALE;
  return <section className="survey-readonly" aria-labelledby="survey-readonly-heading">
    <h2 id="survey-readonly-heading">Submitted response</h2>
    <dl className="project-metadata-grid">
      {type === "course_development_debrief" ? <>
        <ReadOnlyValue label="Internal employee">{booleanValue(answers.internalEmployee)}</ReadOnlyValue>
        <ReadOnlyValue label="Billable hours">{answers.internalEmployee === true ? "Not applicable" : valueOrNotProvided(answers.billableHours)}</ReadOnlyValue>
        <ReadOnlyValue label="Invoiced amount">{answers.internalEmployee === true ? "Not applicable" : currencyOrNotProvided(answers.amountBilled)}</ReadOnlyValue>
        <ReadOnlyValue label="Work started">{formatDate(answers.workStartedOn)}</ReadOnlyValue>
        <ReadOnlyValue label="Work finished">{formatDate(answers.workFinishedOn)}</ReadOnlyValue>
      </> : <>
        <ReadOnlyValue label="Publication year">{valueOrNotProvided(answers.publicationYear)}</ReadOnlyValue>
        <ReadOnlyValue label="Vertical">{valueOrNotProvided(answers.vertical)}</ReadOnlyValue>
        <ReadOnlyValue label="Provided real-world examples">{booleanValue(answers.providedRealWorldExamples)}</ReadOnlyValue>
        <ReadOnlyValue label="Example effectiveness">{valueOrNotProvided(answers.realWorldExamplesEffectiveness)}</ReadOnlyValue>
        <ReadOnlyValue label="Recommendation score">{valueOrNotProvided(answers.recommendationScore)}</ReadOnlyValue>
      </>}
      <ReadOnlyValue label="Submission date">{formatDateTime(detail.submission.latest_submitted_at)}</ReadOnlyValue>
      <ReadOnlyValue label="Revision">{detail.submission.revision_number}</ReadOnlyValue>
      <ReadOnlyValue label="State">{detail.submission.is_locked ? "Submitted and locked" : "Unlocked for revision"}</ReadOnlyValue>
    </dl>
    {type === "course_development_debrief" ? <section><h3>Invoice</h3>
      {answers.internalEmployee === true ? <p>Not applicable</p> : detail.attachments.length
        ? detail.attachments.map((attachment) => <div className="survey-file" key={attachment.id}>
          <span>{attachment.original_filename} ({formatBytes(attachment.size_bytes)})</span>
          <button type="button" className="link-button" onClick={() => downloadInvoice(attachment.id)}>Download</button>
        </div>) : <p>Not provided</p>}
    </section> : null}
    <section><h3>Ratings</h3><ol className="restricted-rating-list">{statements.map((statement, index) => {
      const rating = Number(answers[`rating${String(index + 1).padStart(2, "0")}`]) || 0;
      return <li key={statement}><span>{statement}</span><strong>{rating ? `${rating} — ${scale[rating - 1]}` : "Not provided"}</strong></li>;
    })}</ol></section>
    <section><h3>Comments</h3><p className="survey-comment-readonly">{String(answers.comments || "Not provided")}</p></section>
  </section>;
}

function ReadOnlyValue({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}

function valueOrNotProvided(value: unknown) {
  return value === "" || value == null ? "Not provided" : String(value);
}

function booleanValue(value: unknown) {
  return value === true ? "Yes" : value === false ? "No" : "Not provided";
}

function currencyOrNotProvided(value: unknown) {
  if (value === "" || value == null) return "Not provided";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value));
}

function formatDateTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Not provided";
}

function DebriefForm({ answers, update, errors, editable, detail, uploadInvoice, removeInvoice, downloadInvoice, uploadProgress }: {
  answers: Answers; update: (name: string, value: string | number | boolean) => void; errors: Record<string, string>; editable: boolean; detail: Detail;
  uploadInvoice: (file: File) => void; removeInvoice: (id: string) => void; downloadInvoice: (id: string) => void; uploadProgress: number | null;
}) {
  const external = answers.internalEmployee === false;
  const trustedDueYear = Number(detail.submission.context_snapshot.originalDueYear) || null;
  const dueYearChoice = answers.originalDueYear === "" || answers.originalDueYear == null ? "" : [2026, 2027].includes(Number(answers.originalDueYear)) ? String(answers.originalDueYear) : "other";
  return <form className="survey-form" onSubmit={(event) => event.preventDefault()}>
    <section><h2>Project details</h2><div className="survey-form-grid">
      <Field label="Course’s Original Due Year" error={errors.originalDueYear}>{trustedDueYear
        ? <input value={trustedDueYear} readOnly aria-readonly="true" />
        : <><select value={dueYearChoice} onChange={(event) => update("originalDueYear", event.target.value === "other" ? 0 : event.target.value)} disabled={!editable}><option value="">Select year</option><option value="2026">2026</option><option value="2027">2027</option><option value="other">Other</option></select>
          {dueYearChoice === "other" && <input aria-label="Other original due year" type="number" min="1000" max="9999" value={Number(answers.originalDueYear) >= 1000 ? String(answers.originalDueYear) : ""} onChange={(event) => update("originalDueYear", event.target.value)} disabled={!editable} />}</>}</Field>
      <fieldset disabled={!editable}><legend>Are you an internal Lexipol employee? <Required /></legend>
        <Radio name="internalEmployee" label="Yes" checked={answers.internalEmployee === true} onChange={() => update("internalEmployee", true)} />
        <Radio name="internalEmployee" label="No" checked={answers.internalEmployee === false} onChange={() => update("internalEmployee", false)} />
        <ErrorText text={errors.internalEmployee} />
      </fieldset>
    </div></section>
    {external && <section><h2>Billable Information</h2><div className="survey-form-grid">
      <Field label="Billable Hours" error={errors.billableHours}><input type="number" min="0" step="0.01" value={String(answers.billableHours ?? "")} onChange={(e) => update("billableHours", e.target.value)} disabled={!editable} /></Field>
      <Field label="Amount Billed (USD)" error={errors.amountBilled}><input type="number" min="0" step="0.01" value={String(answers.amountBilled ?? "")} onChange={(e) => update("amountBilled", e.target.value)} disabled={!editable} /></Field>
    </div><div className="survey-invoice"><h3>Invoice <Required /></h3>
      {detail.attachments.map((attachment) => <div className="survey-file" key={attachment.id}><span>{attachment.original_filename} ({formatBytes(attachment.size_bytes)})</span>
        <span><button type="button" className="link-button" onClick={() => downloadInvoice(attachment.id)}>Download</button>{editable && <button type="button" className="link-button danger" onClick={() => removeInvoice(attachment.id)}>Remove</button>}</span></div>)}
      {editable && <label className="survey-upload">Upload or replace invoice<input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg" onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadInvoice(file); }} /></label>}
      {uploadProgress != null && <progress value={uploadProgress} max="100" aria-label="Invoice upload progress">{uploadProgress}%</progress>}
      <ErrorText text={errors.invoice} />
    </div></section>}
    <section><h2>Dates</h2><div className="survey-form-grid">
      <Field label="When did you START working on this project?" error={errors.workStartedOn}><input type="date" max={new Date().toISOString().slice(0, 10)} value={String(answers.workStartedOn ?? "")} onChange={(e) => update("workStartedOn", e.target.value)} disabled={!editable} /></Field>
      <Field label="When did you FINISH working on this project?" error={errors.workFinishedOn}><input type="date" value={String(answers.workFinishedOn ?? "")} onChange={(e) => update("workFinishedOn", e.target.value)} disabled={!editable} /></Field>
    </div></section>
    <RatingMatrix statements={SME_DEBRIEF_STATEMENTS} scale={AGREEMENT_SCALE} answers={answers} update={update} errors={errors} editable={editable} />
    <Comments label="Please provide any additional comments or suggestions for improving the course development process at Lexipol." answers={answers} update={update} error={errors.comments} editable={editable} />
  </form>;
}

function IdReviewForm({ answers, update, errors, editable, detail }: { answers: Answers; update: (name: string, value: string | number | boolean) => void; errors: Record<string, string>; editable: boolean; detail: Detail }) {
  const trustedPublicationYear = Number(detail.submission.context_snapshot.publicationYear) || null;
  const trustedVertical = typeof detail.submission.context_snapshot.vertical === "string" ? detail.submission.context_snapshot.vertical : null;
  return <form className="survey-form" onSubmit={(event) => event.preventDefault()}>
    <section><h2>Publication context</h2><div className="survey-form-grid">
      <Field label="Publication Year" error={errors.publicationYear}>{trustedPublicationYear
        ? <input value={trustedPublicationYear} readOnly aria-readonly="true" />
        : <input type="number" min="1000" max="9999" value={String(answers.publicationYear ?? "")} onChange={(e) => update("publicationYear", e.target.value)} disabled={!editable} />}</Field>
      <Field label="Vertical" error={errors.vertical}>{trustedVertical
        ? <input value={trustedVertical} readOnly aria-readonly="true" />
        : <><input value="Requires administrator resolution" readOnly aria-readonly="true" /><span className="field-error-message">A trusted Vertical could not be resolved. An administrator must correct the context before submission.</span></>}</Field>
    </div></section>
    <p>We’re using a scale from 1 to 5 to evaluate different aspects of the collaboration.</p>
    <RatingMatrix statements={ID_REVIEW_STATEMENTS} scale={COLLABORATION_SCALE} answers={answers} update={update} errors={errors} editable={editable} />
    <section><fieldset disabled={!editable}><legend>Did the SME provide sufficient real-world examples and/or case studies for inclusion in the course? <Required /></legend>
      <Radio name="providedRealWorldExamples" label="Yes" checked={answers.providedRealWorldExamples === true} onChange={() => update("providedRealWorldExamples", true)} />
      <Radio name="providedRealWorldExamples" label="No" checked={answers.providedRealWorldExamples === false} onChange={() => update("providedRealWorldExamples", false)} />
      <ErrorText text={errors.providedRealWorldExamples} />
    </fieldset>
    {answers.providedRealWorldExamples === true && <fieldset className="effectiveness-scale" disabled={!editable}><legend>Rate the effectiveness of the real-world examples and case studies provided by the SME in enriching the course content. <Required /></legend>
      {EXAMPLE_EFFECTIVENESS_SCALE.map((label, index) => <Radio key={label} name="realWorldExamplesEffectiveness" label={`${index + 1}. ${label}`} checked={Number(answers.realWorldExamplesEffectiveness) === index + 1} onChange={() => update("realWorldExamplesEffectiveness", index + 1)} />)}
      <ErrorText text={errors.realWorldExamplesEffectiveness} />
    </fieldset>}</section>
    <section><fieldset className="recommendation-scale" disabled={!editable}><legend>Considering your experience, how likely are you to recommend working with this SME to other team members or instructional designers? <Required /></legend>
      <div className="recommendation-options">{Array.from({ length: 11 }, (_, value) => <Radio key={value} name="recommendationScore" label={String(value)} checked={Number(answers.recommendationScore) === value} onChange={() => update("recommendationScore", value)} />)}</div>
      <div className="recommendation-anchors"><span>0 = Not at all likely</span><span>10 = Extremely likely</span></div><ErrorText text={errors.recommendationScore} />
    </fieldset></section>
    <Comments label="Please provide any additional comments or suggestions for improving the process of working with SMEs in course development." answers={answers} update={update} error={errors.comments} editable={editable} />
  </form>;
}

function RatingMatrix({ statements, scale, answers, update, errors, editable }: {
  statements: readonly string[]; scale: readonly string[]; answers: Answers;
  update: (name: string, value: number) => void; errors: Record<string, string>; editable: boolean;
}) {
  return <section><h2>Collaboration ratings</h2><div className="survey-matrix-wrap"><table className="survey-matrix">
    <thead><tr><th>Statement</th>{scale.map((label, index) => <th key={label}>{index + 1}<small>{label}</small></th>)}</tr></thead>
    <tbody>{statements.map((statement, statementIndex) => {
      const name = `rating${String(statementIndex + 1).padStart(2, "0")}`;
      return <tr key={statement}><th scope="row" id={`${name}-statement`}>{statement} <Required /><ErrorText text={errors[name]} /></th>
        {scale.map((label, ratingIndex) => <td key={label}><label><input type="radio" name={name} value={ratingIndex + 1} checked={Number(answers[name]) === ratingIndex + 1} onChange={() => update(name, ratingIndex + 1)} disabled={!editable} aria-labelledby={`${name}-statement`} /><span>{ratingIndex + 1}. {label}</span></label></td>)}
      </tr>;
    })}</tbody>
  </table></div></section>;
}

function Comments({ label, answers, update, error, editable }: { label: string; answers: Answers; update: (name: string, value: string) => void; error?: string; editable: boolean }) {
  const value = String(answers.comments ?? "");
  return <section><Field label={label} error={error} required={false}><textarea rows={7} maxLength={5000} value={value} onChange={(event) => update("comments", event.target.value)} disabled={!editable} /><small>{(5000 - value.length).toLocaleString()} characters remaining</small></Field></section>;
}

function Field({ label, error, children, required = true }: { label: string; error?: string; children: React.ReactNode; required?: boolean }) {
  return <label className={error ? "field-error" : undefined}><span>{label} {required && <Required />}</span>{children}<ErrorText text={error} /></label>;
}
function Radio({ name, label, checked, onChange }: { name: string; label: string; checked: boolean; onChange: () => void }) {
  return <label className="survey-radio"><input type="radio" name={name} checked={checked} onChange={onChange} /><span>{label}</span></label>;
}
function Required() { return <span className="required" aria-hidden="true">*</span>; }
function ErrorText({ text }: { text?: string }) { return text ? <span className="field-error-message" role="alert">{text}</span> : null; }

function answersFromResponse(type: SurveyType, response: Detail["response"]): Answers {
  const answers: Answers = { comments: response.comments ?? "" };
  if (type === "course_development_debrief") {
    Object.assign(answers, {
      originalDueYear: response.original_due_year ?? "", internalEmployee: response.internal_employee ?? "",
      billableHours: response.billable_hours ?? "", amountBilled: response.amount_billed ?? "",
      workStartedOn: response.work_started_on ?? "", workFinishedOn: response.work_finished_on ?? "",
    });
    for (let index = 1; index <= 10; index++) answers[`rating${String(index).padStart(2, "0")}`] = response[`rating_${String(index).padStart(2, "0")}`] ?? "";
  } else {
    Object.assign(answers, {
      publicationYear: response.publication_year ?? "", vertical: response.vertical ?? "",
      providedRealWorldExamples: response.provided_real_world_examples ?? "",
      realWorldExamplesEffectiveness: response.real_world_examples_effectiveness ?? "",
      recommendationScore: response.recommendation_score ?? "",
    });
    for (let index = 1; index <= 9; index++) answers[`rating${String(index).padStart(2, "0")}`] = response[`rating_${String(index).padStart(2, "0")}`] ?? "";
  }
  return answers;
}

function requiredFieldErrors(type: SurveyType, answers: Answers, hasInvoice: boolean) {
  const errors: Record<string, string> = {};
  const require = (name: string) => { if (answers[name] === "" || answers[name] == null) errors[name] = "This field is required."; };
  if (type === "course_development_debrief") {
    ["originalDueYear", "internalEmployee", "workStartedOn", "workFinishedOn", ...Array.from({ length: 10 }, (_, i) => `rating${String(i + 1).padStart(2, "0")}`)].forEach(require);
    if (answers.internalEmployee === false) {
      require("billableHours"); require("amountBilled"); if (!hasInvoice) errors.invoice = "An invoice is required.";
    }
  } else {
    ["publicationYear", "vertical", "providedRealWorldExamples", "recommendationScore", ...Array.from({ length: 9 }, (_, i) => `rating${String(i + 1).padStart(2, "0")}`)].forEach(require);
    if (answers.providedRealWorldExamples === true) require("realWorldExamplesEffectiveness");
  }
  return errors;
}
function formatDate(value: unknown) { return typeof value === "string" && value ? new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC" }) : "Unavailable"; }
function formatBytes(value: number) { return value < 1024 * 1024 ? `${Math.round(value / 1024)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`; }
