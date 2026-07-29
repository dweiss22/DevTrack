import Link from "next/link";
import React from "react";
import { SearchableFilterSelect } from "@/components/searchable-filter-select";
import { SmeDashboardAnalytics } from "@/components/sme-dashboard-analytics";
import { SurveyReceived } from "@/components/survey-received";
import {
  canonicalDashboardIdentities, dashboardIdentityLabel, submissionHref,
  surveyHref, type DashboardIdentity, type SurveySummary,
} from "@/lib/dashboards/domain";
import { sortDashboardProjectsNewestFirst } from "@/lib/dashboards/project-order";

export type SmeDashboardRow = {
  task_id: string; title: string; status_name: string; status_color: string | null;
  status_classification: string; reporting_year: number | null; start_date: string | null;
  original_due_date: string | null; due_date: string | null; completed_at: string | null;
  actual_minutes: number; is_overdue: boolean; subject_application_user_id: string | null;
  submission_id: string | null; survey_status: "draft" | "submitted" | null;
  survey_is_locked: boolean | null; survey_can_edit: boolean | null; is_recent: boolean;
  submitted_billable_hours: number | null; submitted_amount_billed: number | null; submitted_at: string | null;
};

export function SmeDashboard({ identities, selected, rows, canSelect, canLaunchDebrief, currentUserId, scope, mappingRequired }: {
  identities: DashboardIdentity[]; selected: DashboardIdentity | null; rows: SmeDashboardRow[];
  canSelect: boolean; canLaunchDebrief: boolean; currentUserId: string | null; scope: "recent" | "all";
  administrativeView: boolean; mappingRequired: boolean;
}) {
  const returnTo = selected?.sme_identity_id
    ? `/sme-dashboard?sme=${encodeURIComponent(selected.sme_identity_id)}&scope=${scope}` : `/sme-dashboard?scope=${scope}`;
  const canonicalIdentities = canonicalDashboardIdentities(identities);
  const selectableIdentities = canonicalIdentities.filter((identity) => identity.selectable);
  const unresolvedIdentities = canonicalIdentities.filter((identity) => !identity.selectable);
  const orderedRows = sortDashboardProjectsNewestFirst(rows);
  const scopeHref = (nextScope: "recent" | "all") => selected?.sme_identity_id
    ? `/sme-dashboard?sme=${encodeURIComponent(selected.sme_identity_id)}&scope=${nextScope}`
    : `/sme-dashboard?scope=${nextScope}`;
  return <>
    {canSelect && <section className="card sme-selector-card"><form method="get">
      <SearchableFilterSelect label="SME" name="sme" defaultValue={selected?.sme_identity_id ?? ""}
        allLabel="Select an SME" options={canonicalIdentities.map((identity) => ({
          value: identity.sme_identity_id ?? identity.wrike_user_id ?? identity.identity_key,
          label: dashboardIdentityLabel(identity),
        }))} />
      <input type="hidden" name="scope" value={scope} /><button>View dashboard</button>
    </form><IdentityResolutionWarnings identities={unresolvedIdentities} /></section>}
    {mappingRequired ? <p className="card notice warning" role="status">Your DevTrack account is not linked to a project-field SME identity. Ask an administrator to configure the link in User Management.</p>
      : !selected ? <p className="card empty">{selectableIdentities.length ? "Select an SME to view assigned work." : "No SME field identities are available."}</p>
      : !selected.selectable ? <p className="card notice warning">This SME name is ambiguous or comes from conflicting project data. An administrator must confirm its identity before its dashboard can be opened.</p>
      : <>
        <div className="sme-dashboard-toolbar">
          <span>Project period</span>
          <div className="scope-toggle" role="group" aria-label="Assignment period">
            <Link className={scope === "recent" ? "button" : "button secondary"} href={scopeHref("recent")}>Recent</Link>
            <Link className={scope === "all" ? "button" : "button secondary"} href={scopeHref("all")}>All Time</Link>
          </div>
        </div>
        <SmeDashboardAnalytics rows={rows} />
        {orderedRows.length ? <div className="dashboard-table-wrap"><table className="dashboard-project-table sme-project-list">
          <caption className="sr-only">Projects ordered from most recent to oldest</caption><thead><tr>
          <th>Course</th><th>Status</th><th>Survey</th>
        </tr></thead><tbody>{orderedRows.map((row) => {
          const summary: SurveySummary | null = row.submission_id && row.survey_status ? {
            id: row.submission_id, status: row.survey_status, isLocked: Boolean(row.survey_is_locked),
            canEdit: Boolean(row.survey_can_edit), revisionNumber: 1,
          } : null;
          const href = summary?.status === "draft" ? submissionHref(summary.id, returnTo)
            : !summary && selected.sme_identity_id
              ? surveyHref(row.task_id, "course-development-debrief", selected.sme_identity_id, returnTo)
              : "";
          const ownsSelection = Boolean(currentUserId && currentUserId === selected.application_user_id);
          const allowed = row.is_recent && canLaunchDebrief && ownsSelection && Boolean(href);
          const projectHref = `/sme-dashboard/projects/${row.task_id}?sme=${encodeURIComponent(selected.sme_identity_id ?? "")}&scope=${scope}`;
          return <tr key={row.task_id}>
            <td data-label="Course"><Link href={projectHref}>{row.title}</Link></td>
            <td data-label="Status"><span className="sme-status-indicator" title={row.status_name}>
              <span className="sme-status-dot" style={{ backgroundColor: row.status_color ?? statusColor(row.status_classification) }} aria-hidden="true" />
              <span className="sr-only">{row.status_name}</span>
            </span></td>
            <td data-label="Survey">{summary?.status === "submitted"
              ? <SurveyReceived submittedAt={row.submitted_at} compact />
              : allowed
                ? <Link className="button secondary" href={href}>{summary ? "Resume survey" : "Start survey"}</Link>
                : row.is_recent && summary
                  ? <span className="muted">Draft</span>
                  : <span className="muted">—</span>}</td>
          </tr>;
        })}</tbody></table></div> : <p className="card empty">No projects in this period match this SME field identity.</p>}
      </>}
  </>;
}

function statusColor(classification: string) {
  if (classification === "completed") return "#0c8f78";
  if (classification === "active") return "#3b82c4";
  if (classification === "stalled_or_canceled") return "#64748b";
  return "#d97706";
}

function IdentityResolutionWarnings({ identities }: { identities: DashboardIdentity[] }) {
  if (!identities.length) return null;
  return <details className="dashboard-identity-warnings"><summary>{identities.length} assignment value{identities.length === 1 ? "" : "s"} need identity resolution</summary>
    <p className="muted">These names remain visible but cannot be opened until an administrator confirms an ambiguous match or the conflicting project field is corrected.</p>
    <ul>{identities.map((identity) => <li key={identity.identity_key}>{dashboardIdentityLabel(identity)}</li>)}</ul></details>;
}
