import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { SurveyInvoiceDownloadButton } from "@/components/survey-invoice-download-button";
import { StatusBadge } from "@/components/wrike-reference";
import { requirePageCapability } from "@/lib/auth";
import { submissionHref, surveyHref } from "@/lib/dashboards/domain";
import { formatCourseLength, parseCourseLengthMinutes } from "@/lib/reporting/project-overview";
import { AGREEMENT_SCALE, SME_DEBRIEF_STATEMENTS } from "@/lib/surveys/domain";

type SmeDebrief = {
  id: string;
  status: "draft" | "submitted";
  isLocked: boolean;
  canEdit: boolean;
  revisionNumber: number;
  firstSubmittedAt: string | null;
  latestSubmittedAt: string | null;
  response: {
    internalEmployee: boolean | null;
    billableHours: number | null;
    amountBilled: number | null;
    workStartedOn: string | null;
    workFinishedOn: string | null;
    ratings: Array<number | null>;
    comments: string | null;
  };
  attachments: Array<{ id: string; filename: string; sizeBytes: number; uploadedAt: string }>;
};

type SmeProjectDetail = {
  taskId: string;
  title: string;
  status: string;
  reportingYear: number | null;
  assignedIds: Array<{ wrikeUserId: string; name: string }>;
  vertical: string | null;
  courseLength: string | null;
  legalReviewer: string | null;
  debrief: SmeDebrief | null;
  finalizedDraft: { available: boolean; url?: string | null; updatedAt?: string | null };
};

export default async function SmeProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { supabase } = await requirePageCapability("view_sme_dashboard");
  const { data, error } = await supabase.rpc("sme_project_detail", { target_task_id: projectId });
  if (error || !data) notFound();
  const detail = data as SmeProjectDetail;
  const returnTo = `/sme-dashboard/projects/${detail.taskId}`;
  const surveyLink = detail.debrief
    ? submissionHref(detail.debrief.id, returnTo)
    : surveyHref(detail.taskId, "course-development-debrief", null, returnTo);
  const actionLabel = !detail.debrief ? "Create SME Debrief"
    : detail.debrief.status === "draft" ? "Resume SME Debrief"
      : !detail.debrief.isLocked && detail.debrief.canEdit ? "Revise SME Debrief"
        : "View Submitted Debrief";

  return <AppShell isAdmin={false}>
    <nav className="breadcrumb" aria-label="Breadcrumb"><Link href="/sme-dashboard">SME Dashboard</Link><span aria-hidden="true">/</span><span aria-current="page">Course detail</span></nav>
    <header className="page-header"><div><p className="eyebrow">ASSIGNED COURSE</p><h1>{detail.title}</h1>
      <p><StatusBadge name={detail.status} /></p></div><div className="project-header-actions">
        <Link className="button" href={surveyLink}>{actionLabel}</Link>
        {detail.finalizedDraft.available && detail.finalizedDraft.url
          ? <a className="button secondary" href={detail.finalizedDraft.url} target="_blank" rel="noopener noreferrer">View Finalized Course Draft</a>
          : <button className="secondary" disabled>Finalized Course Draft Not Available</button>}
      </div></header>

    <section className="card" aria-labelledby="sme-project-information">
      <h2 id="sme-project-information">Course information</h2>
      <dl className="project-metadata-grid restricted-project-grid">
        <Metadata label="Project status">{detail.status || "Not available"}</Metadata>
        <Metadata label="Reporting year">{detail.reportingYear ?? "Not available"}</Metadata>
        <Metadata label="Assigned ID">{detail.assignedIds.length ? detail.assignedIds.map((item) => item.name).join(", ") : "Not available"}</Metadata>
        <Metadata label="Vertical">{detail.vertical ?? "Not available"}</Metadata>
        <Metadata label="Course length">{courseLength(detail.courseLength)}</Metadata>
        <Metadata label="Legal reviewer">{detail.legalReviewer ?? "Not available"}</Metadata>
        <Metadata label="Billable hours">{billingValue(detail.debrief, "hours")}</Metadata>
        <Metadata label="Invoiced amount">{billingValue(detail.debrief, "amount")}</Metadata>
      </dl>
    </section>

    <section className="card restricted-debrief" aria-labelledby="sme-debrief-response">
      <div className="section-heading"><div><p className="eyebrow">YOUR RESPONSE</p><h2 id="sme-debrief-response">Course Development Debrief</h2></div>
        {detail.debrief ? <p><strong>{detail.debrief.status === "draft" ? "Draft" : "Submitted"}</strong> · {detail.debrief.isLocked ? "Locked" : "Unlocked for revision"} · Revision {detail.debrief.revisionNumber}</p> : null}</div>
      {!detail.debrief ? <p className="empty">You have not created a debrief for this course.</p> : <DebriefResponse debrief={detail.debrief} />}
    </section>
  </AppShell>;
}

function Metadata({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}

function billingValue(debrief: SmeDebrief | null, type: "hours" | "amount") {
  if (!debrief) return "Not provided";
  if (debrief.response.internalEmployee === true) return "Not applicable";
  const value = type === "hours" ? debrief.response.billableHours : debrief.response.amountBilled;
  if (value == null) return "Not provided";
  return type === "hours" ? `${Number(value).toLocaleString()} hours`
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value));
}

function courseLength(value: string | null) {
  if (!value) return "Not available";
  return formatCourseLength(parseCourseLengthMinutes(value.split(",").map((item) => item.trim()))) ?? value;
}

function DebriefResponse({ debrief }: { debrief: SmeDebrief }) {
  const response = debrief.response;
  return <div className="restricted-response">
    <dl className="project-metadata-grid">
      <Metadata label="Internal employee">{response.internalEmployee == null ? "Not provided" : response.internalEmployee ? "Yes" : "No"}</Metadata>
      <Metadata label="Billable hours">{billingValue(debrief, "hours")}</Metadata>
      <Metadata label="Invoiced amount">{billingValue(debrief, "amount")}</Metadata>
      <Metadata label="Started">{formatDate(response.workStartedOn)}</Metadata>
      <Metadata label="Finished">{formatDate(response.workFinishedOn)}</Metadata>
      <Metadata label="Submitted">{formatDate(debrief.latestSubmittedAt, true)}</Metadata>
    </dl>
    <section aria-labelledby="debrief-invoice"><h3 id="debrief-invoice">Invoice</h3>
      {response.internalEmployee === true ? <p>Not applicable</p>
        : debrief.attachments.length ? <ul className="detail-list">{debrief.attachments.map((attachment) => <li key={attachment.id}>
          <strong>{attachment.filename}</strong> · Uploaded {formatDate(attachment.uploadedAt, true)} · {(attachment.sizeBytes / 1024).toFixed(1)} KB<br />
          <SurveyInvoiceDownloadButton submissionId={debrief.id} attachmentId={attachment.id} />
        </li>)}</ul> : <p>Not provided</p>}
    </section>
    <section aria-labelledby="debrief-ratings"><h3 id="debrief-ratings">Agreement ratings</h3>
      <ol className="restricted-rating-list">{SME_DEBRIEF_STATEMENTS.map((statement, index) => {
        const rating = response.ratings[index];
        return <li key={statement}><span>{statement}</span><strong>{rating ? `${rating} — ${AGREEMENT_SCALE[rating - 1]}` : "Not provided"}</strong></li>;
      })}</ol>
    </section>
    <section aria-labelledby="debrief-comments"><h3 id="debrief-comments">Comments</h3>
      <p className="survey-comment-readonly">{response.comments || "Not provided"}</p>
    </section>
  </div>;
}

function formatDate(value: string | null, includeTime = false) {
  if (!value) return "Not provided";
  return new Intl.DateTimeFormat("en-US", includeTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value.length === 10 ? `${value}T00:00:00Z` : value));
}
