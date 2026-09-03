"use client";

import Link from "next/link";
import React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FinalizedDraftDashboardCell } from "@/components/finalized-draft-dashboard-cell";
import { StatusBadge } from "@/components/wrike-reference";
import {
  colleagueReviewLabel, submissionHref, surveyActionLabel, surveyHref,
} from "@/lib/dashboards/domain";
import type { IdDashboardRow } from "@/components/id-dashboard";

const OPTIONAL_COLUMNS = [
  { key: "sme", label: "SME" },
  { key: "status", label: "Status" },
  { key: "vertical", label: "Vertical" },
  { key: "courseStyle", label: "Course Style" },
  { key: "finalizedDraft", label: "Finalized Draft" },
  { key: "publicationDate", label: "Publication Date" },
  { key: "originalDueDate", label: "Original Due Date" },
  { key: "dueDate", label: "Due Date" },
  { key: "completedAt", label: "Completed Date" },
] as const;

type OptionalColumnKey = typeof OPTIONAL_COLUMNS[number]["key"];
const DEFAULT_VISIBLE: Record<OptionalColumnKey, boolean> = {
  sme: true, status: true, vertical: true, courseStyle: true, finalizedDraft: true,
  publicationDate: false, originalDueDate: false, dueDate: false, completedAt: false,
};
const STORAGE_KEY = "id-dashboard-columns";

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" })
    .format(new Date(value.length === 10 ? `${value}T00:00:00Z` : value));
}

export function IdDashboardProjectTable({ rows, returnTo, canActAsAssignedId }: {
  rows: IdDashboardRow[]; returnTo: string; canActAsAssignedId: boolean;
}) {
  const [visible, setVisible] = useState<Record<OptionalColumnKey, boolean>>(DEFAULT_VISIBLE);
  const [open, setOpen] = useState(false);
  const [surveyTab, setSurveyTab] = useState<"all" | "incomplete" | "completed">("all");
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) setVisible((current) => ({ ...current, ...JSON.parse(stored) }));
    } catch { /* ignore unavailable storage */ }
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(visible)); } catch { /* ignore unavailable storage */ }
  }, [visible]);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const columnCount = useMemo(() => 2 + OPTIONAL_COLUMNS.filter((column) => visible[column.key]).length, [visible]);
  const visibleRows = useMemo(() => {
    if (!canActAsAssignedId || surveyTab === "all") return rows;
    return rows.filter((row) => (row.own_review?.status === "submitted") === (surveyTab === "completed"));
  }, [rows, canActAsAssignedId, surveyTab]);
  const completedCount = useMemo(() => rows.filter((row) => row.own_review?.status === "submitted").length, [rows]);
  const incompleteCount = rows.length - completedCount;

  return <div className="id-dashboard-project-table-wrap">
    {canActAsAssignedId && <nav className="survey-tabs" aria-label="My assigned surveys">
      <button type="button" aria-current={surveyTab === "incomplete" ? "page" : undefined}
        onClick={() => setSurveyTab((current) => current === "incomplete" ? "all" : "incomplete")}>
        Incomplete <span>{incompleteCount}</span>
      </button>
      <button type="button" aria-current={surveyTab === "completed" ? "page" : undefined}
        onClick={() => setSurveyTab((current) => current === "completed" ? "all" : "completed")}>
        Completed <span>{completedCount}</span>
      </button>
    </nav>}
    <div className="dashboard-table-toolbar" ref={popoverRef}>
      <button type="button" className="button secondary" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        Columns
      </button>
      {open && <div className="dashboard-column-toggle-popover" role="menu">
        {OPTIONAL_COLUMNS.map((column) => <label key={column.key}>
          <input type="checkbox" checked={visible[column.key]}
            onChange={(event) => setVisible((current) => ({ ...current, [column.key]: event.target.checked }))} />
          {column.label}
        </label>)}
      </div>}
    </div>
    {visibleRows.length ? <div className="dashboard-table-wrap"><table className="dashboard-project-table id-dashboard-table">
      <caption className="sr-only">Projects ordered from most recent to oldest</caption><thead><tr>
        <th>Course Name</th>
        {visible.sme && <th>SME</th>}
        {visible.status && <th>Status</th>}
        {visible.vertical && <th>Vertical</th>}
        {visible.courseStyle && <th>Course Style</th>}
        {visible.finalizedDraft && <th>Finalized Draft</th>}
        {visible.publicationDate && <th>Publication Date</th>}
        {visible.originalDueDate && <th>Original Due Date</th>}
        {visible.dueDate && <th>Due Date</th>}
        {visible.completedAt && <th>Completed Date</th>}
        <th>Survey</th>
      </tr></thead><tbody>{visibleRows.map((row) => {
        const reviewAvailable = Boolean(row.sme_identity_id)
          && !["ambiguous", "conflict", "missing", "unresolved"].includes(row.sme_identity_status);
        const startHref = reviewAvailable
          ? surveyHref(row.task_id, "id-sme-review", row.sme_identity_id, returnTo) : null;
        const ownHref = row.own_review ? submissionHref(row.own_review.id, returnTo) : startHref;
        return <tr key={`${row.task_id}:${row.sme_identity_id ?? row.sme_identity_status}`}>
          <td data-label="Course Name"><Link href={`/projects/${row.task_id}?returnTo=${encodeURIComponent(returnTo)}`}>{row.title}</Link></td>
          {visible.sme && <td data-label="SME">{row.sme_identity_status === "verified" ? <strong>{row.reviewed_sme_name ?? "Verified SME"}</strong>
            : reviewAvailable ? <strong>{row.reviewed_sme_name ?? "Identified SME"}</strong>
              : <UnavailableSmeAssignment row={row} />}</td>}
          {visible.status && <td data-label="Status"><StatusBadge name={row.status_name} /></td>}
          {visible.vertical && <td data-label="Vertical">{row.vertical ?? "Needs context review"}</td>}
          {visible.courseStyle && <td data-label="Course Style">{row.course_style ?? "—"}</td>}
          {visible.finalizedDraft && <td data-label="Finalized Draft">{canActAsAssignedId
            ? <FinalizedDraftDashboardCell taskId={row.task_id} initial={row.finalized_draft ?? { available: false }} />
            : row.finalized_draft?.available ? "Available" : "Not available"}</td>}
          {visible.publicationDate && <td data-label="Publication Date">{formatDate(row.publication_date)}</td>}
          {visible.originalDueDate && <td data-label="Original Due Date">{formatDate(row.original_due_date)}</td>}
          {visible.dueDate && <td data-label="Due Date">{formatDate(row.due_date)}</td>}
          {visible.completedAt && <td data-label="Completed Date">{formatDate(row.completed_at)}</td>}
          <td data-label="Survey"><div className="dashboard-survey-actions">
            {!reviewAvailable
              ? <span className="muted">{row.sme_identity_status === "missing"
                ? "Assign an SME before starting a review."
                : "SME identity needs administrative resolution before starting a review."}</span>
              : canActAsAssignedId
                ? ownHref ? <><Link className="button secondary" href={ownHref}>{surveyActionLabel(row.own_review, "review")}</Link>
                    {(row.colleague_reviews ?? []).map((review) => <Link key={review.id} href={submissionHref(review.id, returnTo, true)}>{colleagueReviewLabel(review)}</Link>)}</>
                  : <span className="muted">SME review unavailable</span>
                : <span className="muted">{row.own_review ? surveyActionLabel(row.own_review, "review") : "No review by selected ID"}</span>}
          </div></td>
        </tr>;
      })}</tbody></table></div>
      : <p className="card empty" style={{ display: columnCount ? undefined : "none" }}>
        {rows.length && surveyTab !== "all"
          ? `No projects match the ${surveyTab} survey filter.`
          : "No synchronized Online Learning projects explicitly match this Wrike identity in the Designer Assigned field."}
      </p>}
  </div>;
}

function UnavailableSmeAssignment({ row }: { row: IdDashboardRow }) {
  const issue = row.sme_identity_status === "conflict"
    ? "Conflicting SME field values"
    : row.sme_identity_status === "missing" ? "SME not assigned" : "SME identity needs administrative resolution";
  return <><strong>{issue}</strong>
    {row.sme_assignment_values.length
      ? <><br /><span className="muted">SME field value: {row.sme_assignment_values.join(", ")}</span></>
      : null}
    <br /><span className="muted">Course remains visible; SME review is unavailable.</span></>;
}
