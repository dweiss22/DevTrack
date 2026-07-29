import Link from "next/link";
import React from "react";
import { SmeProjectCategoryChart } from "@/components/sme-project-category-chart";
import { SurveyInvoiceDownloadButton } from "@/components/survey-invoice-download-button";
import { SurveyReceived } from "@/components/survey-received";
import { StatusBadge } from "@/components/wrike-reference";
import { submissionHref, surveyHref } from "@/lib/dashboards/domain";
import { formatCourseLength, parseCourseLengthMinutes } from "@/lib/reporting/project-overview";
import { AGREEMENT_SCALE, SME_DEBRIEF_STATEMENTS } from "@/lib/surveys/domain";

export type SmeDebrief = {
  id?: string; status: "draft" | "submitted"; isLocked?: boolean; canEdit?: boolean; revisionNumber?: number;
  firstSubmittedAt?: string | null; latestSubmittedAt: string | null;
  response?: { internalEmployee: boolean | null; billableHours: number | null; amountBilled: number | null;
    workStartedOn: string | null; workFinishedOn: string | null; ratings: Array<number | null>; comments: string | null };
  attachments?: Array<{ id: string; filename: string; sizeBytes: number; uploadedAt: string }>;
};

export type SmeProjectDetailData = {
  taskId: string; title: string; status: string; statusColor: string | null; reportingYear: number | null;
  assignedIds: Array<{ wrikeUserId: string; name: string }>; vertical: string | null;
  courseLength: string | null; legalReviewer: string | null; debrief: SmeDebrief | null;
  finalizedDraft: { available: boolean; url?: string | null; updatedAt?: string | null };
  timeline: { startDate: string | null; originalDueDate: string | null; dueDate: string | null; completedAt: string | null };
  categoryTime: Array<{ category: string; minutes: number }>; isRecent: boolean;
  selectedSmeWrikeUserId: string; subjectApplicationUserId: string | null;
};

export function SmeProjectDetail({ detail, returnTo, canLaunchSurvey, managementView = false }: {
  detail: SmeProjectDetailData; returnTo: string; canLaunchSurvey: boolean; managementView?: boolean;
}) {
  const surveyLink = detail.debrief?.status === "draft" && detail.debrief.id
    ? submissionHref(detail.debrief.id, returnTo)
    : !detail.debrief
      ? surveyHref(detail.taskId, "course-development-debrief", detail.selectedSmeWrikeUserId, returnTo)
      : null;
  const actionLabel = detail.debrief?.status === "draft" ? "Resume SME Debrief Survey" : "Create SME Debrief Survey";
  return <div className="sme-project-detail">
    <header className="sme-project-summary"><div className="sme-project-heading"><p className="eyebrow">ASSIGNED COURSE</p><h1>{detail.title}</h1>
      <p><StatusBadge name={detail.status} /></p></div><div className="project-header-actions">
        {detail.debrief?.status === "submitted"
          ? <SurveyReceived submittedAt={detail.debrief.latestSubmittedAt} compact />
          : canLaunchSurvey && detail.isRecent && surveyLink
            ? <Link className="button sme-debrief-action" href={surveyLink}>
              <span>{actionLabel}</span><small>Share your course development feedback</small>
            </Link> : null}
        {detail.finalizedDraft.available && detail.finalizedDraft.url ? <a className="button secondary"
          href={detail.finalizedDraft.url} target="_blank" rel="noopener noreferrer">Course Review</a>
          : <button className="secondary" disabled>Course Review Not Available</button>}
      </div></header>
    {detail.finalizedDraft.available && <p className="notice warning course-review-disclaimer">Feedback provided now may not be incorporated into this release because the minor-change review period has passed and the course is in development or complete. Your comments will be retained for consideration during the next course review.</p>}

    <section className="card" aria-labelledby="sme-project-timeline"><h2 id="sme-project-timeline">Project timeline</h2>
      <ol className="sme-project-timeline">
        <TimelineItem label="Start" value={detail.timeline.startDate} />
        <TimelineItem label="Original due" value={detail.timeline.originalDueDate} />
        <TimelineItem label="Current due" value={detail.timeline.dueDate} />
        <TimelineItem label="Completed" value={detail.timeline.completedAt} includeTime />
      </ol></section>

    <section className="card" aria-labelledby="sme-project-time"><div className="section-heading"><div>
      <p className="eyebrow">RECORDED EFFORT</p><h2 id="sme-project-time">Hours by category</h2></div>
      <p>Totals include all project time without contributor names or comments.</p></div>
      <SmeProjectCategoryChart rows={detail.categoryTime} /></section>

    <section className="card" aria-labelledby="sme-project-information"><h2 id="sme-project-information">Course information</h2>
      <dl className="project-metadata-grid restricted-project-grid">
        <Metadata label="Project status">{detail.status || "Not available"}</Metadata>
        <Metadata label="Reporting year">{detail.reportingYear ?? "Not available"}</Metadata>
        <Metadata label="Assigned ID">{detail.assignedIds.length ? detail.assignedIds.map((item) => item.name).join(", ") : "Not available"}</Metadata>
        <Metadata label="Vertical">{detail.vertical ?? "Not available"}</Metadata>
        <Metadata label="Course length">{courseLength(detail.courseLength)}</Metadata>
        {managementView ? <Metadata label="Legal reviewer">{detail.legalReviewer ?? "Not available"}</Metadata> : null}
        {managementView && detail.debrief?.response ? <>
          <Metadata label="Billable hours">{billingValue(detail.debrief, "hours")}</Metadata>
          <Metadata label="Invoiced amount">{billingValue(detail.debrief, "amount")}</Metadata>
        </> : null}
      </dl></section>

    <section className="card restricted-debrief" aria-labelledby="sme-debrief-response">
      <div className="section-heading"><div><p className="eyebrow">SME RESPONSE</p><h2 id="sme-debrief-response">Course Development Debrief</h2></div>
        {detail.debrief?.status === "draft" ? <p><strong>Draft</strong> · Revision {detail.debrief.revisionNumber}</p> : null}</div>
      {!detail.debrief ? <p className="empty">No debrief has been created for this course.</p>
        : detail.debrief.status === "submitted" && (!managementView || !detail.debrief.response)
          ? <SurveyReceived submittedAt={detail.debrief.latestSubmittedAt} />
          : detail.debrief.response
            ? <DebriefResponse debrief={detail.debrief} managementView={managementView} />
            : <p className="empty">The draft response is unavailable.</p>}
    </section>
  </div>;
}

function Metadata({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}
function TimelineItem({ label, value, includeTime = false }: { label: string; value: string | null; includeTime?: boolean }) {
  return <li><span className="timeline-marker" aria-hidden="true" /><strong>{label}</strong><span>{formatDate(value, includeTime, "Not available")}</span></li>;
}
function billingValue(debrief: SmeDebrief | null, type: "hours" | "amount") {
  if (!debrief || debrief.status !== "submitted" || !debrief.response) return "Not provided";
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
function DebriefResponse({ debrief, managementView }: { debrief: SmeDebrief; managementView: boolean }) {
  const response = debrief.response!;
  const attachments = debrief.attachments ?? [];
  return <div className="restricted-response"><dl className="project-metadata-grid">
    <Metadata label="Internal employee">{response.internalEmployee == null ? "Not provided" : response.internalEmployee ? "Yes" : "No"}</Metadata>
    <Metadata label="Billable hours">{billingValue(debrief, "hours")}</Metadata><Metadata label="Invoiced amount">{billingValue(debrief, "amount")}</Metadata>
    <Metadata label="Started">{formatDate(response.workStartedOn)}</Metadata><Metadata label="Finished">{formatDate(response.workFinishedOn)}</Metadata>
    <Metadata label="Submitted">{formatDate(debrief.latestSubmittedAt, true)}</Metadata></dl>
    <section aria-labelledby="debrief-invoice"><h3 id="debrief-invoice">Invoice</h3>{response.internalEmployee === true ? <p>Not applicable</p>
      : attachments.length ? <ul className="detail-list">{attachments.map((attachment) => <li key={attachment.id}>
        <strong>{attachment.filename}</strong> · Uploaded {formatDate(attachment.uploadedAt, true)} · {(attachment.sizeBytes / 1024).toFixed(1)} KB<br />
        {debrief.id ? <SurveyInvoiceDownloadButton submissionId={debrief.id} attachmentId={attachment.id} management={managementView} /> : null}
      </li>)}</ul> : <p>Not provided</p>}</section>
    <section aria-labelledby="debrief-ratings"><h3 id="debrief-ratings">Agreement ratings</h3><ol className="restricted-rating-list">
      {SME_DEBRIEF_STATEMENTS.map((statement, index) => { const rating = response.ratings[index]; return <li key={statement}>
        <span>{statement}</span><strong>{rating ? `${rating} — ${AGREEMENT_SCALE[rating - 1]}` : "Not provided"}</strong></li>; })}
    </ol></section><section aria-labelledby="debrief-comments"><h3 id="debrief-comments">Comments</h3>
      <p className="survey-comment-readonly">{response.comments || "Not provided"}</p></section></div>;
}
function formatDate(value: string | null, includeTime = false, empty = "Not provided") {
  if (!value) return empty;
  return new Intl.DateTimeFormat("en-US", includeTime ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value.length === 10 ? `${value}T00:00:00Z` : value));
}
