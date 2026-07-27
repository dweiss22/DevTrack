"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SurveyRenderer, type RenderedSurveyAttachment } from "@/components/survey-renderer";
import { SURVEY_VERTICALS, surveyTitle, type SurveyType } from "@/lib/surveys/domain";
import {
  applyContextBindings,
  surveyDefinitionSchema,
  validateSurveyAnswers,
  type SurveyAnswers,
  type SurveyDefinition,
} from "@/lib/surveys/definition";

type Detail = {
  submission: {
    id: string; survey_type: SurveyType; status: "draft" | "submitted"; is_locked: boolean;
    revision_number: number; created_by: string; subject_application_user_id: string | null;
    context_snapshot: Record<string, unknown>; unlock_reason: string | null;
    original_submitted_at: string | null; latest_submitted_at: string | null;
  };
  definition: SurveyDefinition;
  versionNumber: number;
  response: SurveyAnswers;
  attachments: RenderedSurveyAttachment[];
  viewer: { role: string; canEdit: boolean; canManage: boolean };
  audit?: { id: number; event_type: string; actor_role: string; actor_name: string; reason: string | null; created_at: string }[];
  revisions?: { id: string; revision_number: number; submitted_at: string; submitted_by_name: string }[];
};

export function SurveyDialog({
  taskId,
  surveyType,
  submissionId,
  fallbackHref,
  initialSmeWrikeId,
  forceReadOnly = false,
  apiBase = "/api/surveys",
}: {
  taskId?: string;
  surveyType?: SurveyType;
  submissionId?: string;
  fallbackHref: string;
  initialSmeWrikeId?: string;
  forceReadOnly?: boolean;
  apiBase?: string;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [answers, setAnswers] = useState<SurveyAnswers>({});
  const [baseline, setBaseline] = useState("{}");
  const [state, setState] = useState<"loading" | "ready" | "success" | "error">("loading");
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [critical, setCritical] = useState(false);
  const dirty = state === "ready" && JSON.stringify(answers) !== baseline;
  const editable = Boolean(!forceReadOnly && detail?.viewer.canEdit && !detail.submission.is_locked);

  const loadDetail = useCallback(async (id: string) => {
    const response = await fetch(`${apiBase}/${id}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Survey is unavailable.");
    const definition = surveyDefinitionSchema.safeParse(data.definition);
    if (!definition.success) throw new Error("The saved survey definition is unavailable.");
    const loaded = { ...data, definition: definition.data } as Detail;
    const bound = applyContextBindings(definition.data, loaded.response ?? {}, loaded.submission.context_snapshot);
    setDetail(loaded); setAnswers(bound); setBaseline(JSON.stringify(bound)); setState("ready");
  }, [apiBase]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);

  useEffect(() => {
    if (submissionId) {
      loadDetail(submissionId).catch((reason) => {
        setMessage(reason instanceof Error ? reason.message : "Survey is unavailable."); setState("error");
      });
      return;
    }
    if (!taskId || !surveyType) return;
    setCritical(true);
    fetch("/api/surveys", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId, reviewedWrikeUserId: initialSmeWrikeId ?? null }),
    }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Survey context is unavailable.");
      await loadDetail(data.id);
    }).catch((reason) => {
      setMessage(reason instanceof Error ? reason.message : "Survey context is unavailable."); setState("error");
    }).finally(() => setCritical(false));
  }, [initialSmeWrikeId, loadDetail, submissionId, surveyType, taskId]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function close() {
    if (critical) return;
    if (dirty && !confirm("You have unsaved changes. Close this survey and discard them?")) return;
    dialogRef.current?.close();
    router.replace(fallbackHref);
  }

  async function save(submit: boolean) {
    if (!detail || critical) return;
    setMessage(""); setFieldErrors({});
    const attachmentIds = new Set(detail.attachments.map((attachment) => attachment.question_id));
    const validation = validateSurveyAnswers(detail.definition, answers, attachmentIds);
    if (submit && !validation.success) {
      setFieldErrors(validation.errors); setMessage("Complete every required field before submitting."); return;
    }
    setCritical(true);
    try {
      const response = await fetch(`${apiBase}/${detail.submission.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ submit, answers: submit ? validation.answers : answers }),
      });
      const data = await response.json();
      if (!response.ok) {
        setFieldErrors(Object.fromEntries(Object.entries(data.fieldErrors ?? {}).map(([key, value]) =>
          [key, Array.isArray(value) ? String(value[0]) : String(value)])));
        throw new Error(data.error ?? "The survey could not be saved.");
      }
      if (submit) setState("success");
      else {
        setMessage("Draft saved."); await loadDetail(detail.submission.id);
      }
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "The survey could not be saved.");
    } finally { setCritical(false); }
  }

  async function upload(questionId: string, file: File) {
    if (!detail || critical) return;
    setCritical(true); setMessage("");
    try {
      const form = new FormData(); form.set("questionId", questionId); form.set("file", file);
      const response = await fetch(`${apiBase}/${detail.submission.id}/attachments`, { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "The file could not be uploaded.");
      setMessage("File uploaded."); await loadDetail(detail.submission.id);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "The file could not be uploaded.");
    } finally { setCritical(false); }
  }

  async function remove(attachmentId: string) {
    if (!detail || critical || !confirm("Remove this file?")) return;
    setCritical(true); setMessage("");
    try {
      const response = await fetch(`${apiBase}/${detail.submission.id}/attachments`, {
        method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ attachmentId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "The file could not be removed.");
      setMessage("File removed."); await loadDetail(detail.submission.id);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "The file could not be removed.");
    } finally { setCritical(false); }
  }

  async function download(attachmentId: string) {
    if (!detail) return;
    const response = await fetch(`${apiBase}/${detail.submission.id}/attachments/${attachmentId}/download`);
    const data = await response.json();
    if (response.ok) window.location.assign(data.url);
    else setMessage(data.error ?? "The file download could not be prepared.");
  }

  const context = detail?.submission.context_snapshot ?? {};
  return <dialog ref={dialogRef} className="survey-dialog" aria-labelledby="survey-dialog-title"
    onCancel={(event) => { event.preventDefault(); close(); }}>
    <div className="survey-dialog-shell">
      <header className="survey-dialog-header"><div><p className="eyebrow">COURSE DEVELOPMENT</p>
        <h1 id="survey-dialog-title">{detail?.definition.title ?? (surveyType ? surveyTitle(surveyType) : "Survey")}</h1></div>
        <button type="button" className="secondary survey-close" onClick={close} disabled={critical}>Close</button>
      </header>
      {state === "loading" && <div className="survey-state" role="status"><span className="loading-pulse" />Loading survey…</div>}
      {state === "error" && <div className="survey-state error" role="alert"><h2>Survey unavailable</h2><p>{message}</p><button onClick={close}>Return</button></div>}
      {state === "success" && detail && <div className="survey-state notice" role="status"><h2>Survey submitted successfully</h2>
        <p>{detail.definition.completionMessage}</p><button onClick={close}>{detail.definition.buttons.return}</button></div>}
      {state === "ready" && detail && <>
        <div className="survey-status-row">
          <span className={`survey-status ${detail.submission.status}`}>{detail.submission.status}</span>
          <span className={`survey-status ${detail.submission.is_locked ? "locked" : "unlocked"}`}>
            {detail.submission.is_locked ? "Locked" : detail.submission.status === "submitted" ? "Admin revision" : "Editable"}
          </span>
          <span>Survey version {detail.versionNumber}</span><span>Response revision {detail.submission.revision_number}</span>
        </div>
        <ContextHeader context={context} />
        {message && <p className={message.includes("saved") || message.includes("uploaded") || message.includes("removed") ? "notice" : "notice warning"} role="status">{message}</p>}
        <SurveyRenderer definition={detail.definition} answers={answers}
          onChange={(id, value) => { setAnswers((current) => ({ ...current, [id]: value })); setFieldErrors((current) => ({ ...current, [id]: "" })); }}
          errors={fieldErrors} readOnly={!editable} context={context} attachments={detail.attachments}
          onUpload={editable ? upload : undefined} onRemove={editable ? remove : undefined} onDownload={download} />
        {detail.viewer.canManage && <AdminSurveyControls detail={detail} apiBase={apiBase} critical={critical}
          setCritical={setCritical} setMessage={setMessage} reload={() => loadDetail(detail.submission.id)} />}
        <footer className="survey-actions">
          <button type="button" className="secondary" onClick={close} disabled={critical}>Close</button>
          {editable && <><button type="button" className="secondary" onClick={() => void save(false)} disabled={critical}>{detail.definition.buttons.saveDraft}</button>
            <button type="button" onClick={() => void save(true)} disabled={critical}>
              {detail.submission.status === "submitted" ? "Resubmit and lock" : detail.definition.buttons.submit}
            </button></>}
        </footer>
      </>}
    </div>
  </dialog>;
}

function ContextHeader({ context }: { context: Record<string, unknown> }) {
  return <dl className="survey-context">
    <div><dt>Course</dt><dd>{String(context.taskTitle ?? "Unavailable")}</dd></div>
    <div><dt>Workflow status</dt><dd>{String(context.status ?? "Unavailable")}</dd></div>
    <div><dt>SME</dt><dd>{String((context.subject as Record<string, unknown> | undefined)?.name ?? "See assignment context")}</dd></div>
    <div><dt>Reporting year</dt><dd>{String(context.reportingYear ?? "Unavailable")}</dd></div>
    <div><dt>Publication year</dt><dd>{String(context.publicationYear ?? "Unavailable")}</dd></div>
    <div><dt>Original due year</dt><dd>{String(context.originalDueYear ?? "Unavailable")}</dd></div>
  </dl>;
}

function AdminSurveyControls({ detail, apiBase, critical, setCritical, setMessage, reload }: {
  detail: Detail; apiBase: string; critical: boolean;
  setCritical: (value: boolean) => void; setMessage: (value: string) => void; reload: () => Promise<void>;
}) {
  const context = detail.submission.context_snapshot;
  const [reason, setReason] = useState("");
  const [year, setYear] = useState(String(detail.submission.survey_type === "course_development_debrief" ? context.originalDueYear ?? "" : context.publicationYear ?? ""));
  const [vertical, setVertical] = useState(String(context.vertical ?? ""));

  async function act(body: Record<string, unknown>, success: string) {
    setCritical(true); setMessage("");
    try {
      const response = await fetch(`${apiBase}/${detail.submission.id}/actions`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "The survey action failed.");
      setMessage(success); await reload();
    } catch (reasonValue) {
      setMessage(reasonValue instanceof Error ? reasonValue.message : "The survey action failed.");
    } finally { setCritical(false); }
  }

  return <section className="survey-admin card" aria-labelledby="survey-admin-heading">
    <h2 id="survey-admin-heading">Survey administration</h2>
    {detail.submission.status === "submitted" && detail.submission.is_locked && <div className="survey-admin-action">
      <label>Required unlock reason<textarea value={reason} maxLength={2000} onChange={(event) => setReason(event.target.value)} /></label>
      <button type="button" disabled={critical || !reason.trim()}
        onClick={() => void act({ action: "unlock", reason, reviserId: null }, "Survey unlocked for an administrator revision.")}>Unlock for administrator revision</button>
    </div>}
    {detail.submission.status === "submitted" && !detail.submission.is_locked && <button type="button" className="secondary"
      disabled={critical} onClick={() => void act({ action: "relock" }, "Pending edits discarded and the submitted revision relocked.")}>Relock submitted revision</button>}
    {(detail.submission.status === "draft" || !detail.submission.is_locked) && <div className="survey-context-correction">
      <h3>Correct trusted survey context</h3>
      <label>{detail.submission.survey_type === "course_development_debrief" ? "Original Due Year" : "Publication Year"}
        <input type="number" min="1000" max="9999" value={year} onChange={(event) => setYear(event.target.value)} /></label>
      {detail.submission.survey_type === "id_sme_review" && <label>Vertical<select value={vertical} onChange={(event) => setVertical(event.target.value)}>
        <option value="">Select Vertical</option>{SURVEY_VERTICALS.map((item) => <option key={item}>{item}</option>)}</select></label>}
      <button type="button" className="secondary" disabled={critical || year.length !== 4}
        onClick={() => void act({
          action: "correct_context",
          corrections: detail.submission.survey_type === "course_development_debrief"
            ? { originalDueYear: Number(year) } : { publicationYear: Number(year), vertical },
        }, "Survey context corrected and audited.")}>Save context correction</button>
    </div>}
    <details><summary>Revision history ({detail.revisions?.length ?? 0})</summary>{detail.revisions?.length
      ? <ol>{detail.revisions.map((revision) => <li key={revision.id}>Revision {revision.revision_number} by {revision.submitted_by_name} — {new Date(revision.submitted_at).toLocaleString()}</li>)}</ol>
      : <p>No submitted revisions yet.</p>}</details>
    <details><summary>Audit history ({detail.audit?.length ?? 0})</summary>{detail.audit?.length
      ? <ol>{detail.audit.map((event) => <li key={event.id}><strong>{event.event_type.replaceAll("_", " ")}</strong> by {event.actor_name} ({event.actor_role}) — {new Date(event.created_at).toLocaleString()}{event.reason ? ` — ${event.reason}` : ""}</li>)}</ol>
      : <p>No audit events are available.</p>}</details>
  </section>;
}
