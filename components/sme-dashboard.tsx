import Link from "next/link";
import React from "react";
import { SearchableFilterSelect } from "@/components/searchable-filter-select";
import { SmeDashboardAnalytics } from "@/components/sme-dashboard-analytics";
import { SurveyReceived } from "@/components/survey-received";
import {
  canonicalDashboardIdentities, dashboardIdentityLabel, submissionHref,
  surveyHref, type DashboardIdentity, type SurveySummary,
} from "@/lib/dashboards/domain";

export type SmeDashboardRow = {
  task_id: string; title: string; status_name: string; status_color: string | null;
  status_classification: string; reporting_year: number | null; start_date: string | null;
  original_due_date: string | null; due_date: string | null; completed_at: string | null;
  actual_minutes: number; is_overdue: boolean; subject_application_user_id: string | null;
  submission_id: string | null; survey_status: "draft" | "submitted" | null;
  survey_is_locked: boolean | null; survey_can_edit: boolean | null; is_recent: boolean;
  submitted_billable_hours: number | null; submitted_amount_billed: number | null; submitted_at: string | null;
};

export function SmeDashboard({ identities, selected, rows, canSelect, canLaunchDebrief, currentUserId, scope, administrativeView, mappingRequired }: {
  identities: DashboardIdentity[]; selected: DashboardIdentity | null; rows: SmeDashboardRow[];
  canSelect: boolean; canLaunchDebrief: boolean; currentUserId: string | null; scope: "recent" | "all";
  administrativeView: boolean; mappingRequired: boolean;
}) {
  const returnTo = selected?.wrike_user_id
    ? `/sme-dashboard?sme=${encodeURIComponent(selected.wrike_user_id)}&scope=${scope}` : `/sme-dashboard?scope=${scope}`;
  const canonicalIdentities = canonicalDashboardIdentities(identities);
  const selectableIdentities = canonicalIdentities.filter((identity) => identity.selectable && identity.wrike_user_id);
  const unresolvedIdentities = canonicalIdentities.filter((identity) => !identity.selectable);
  const scopeHref = (nextScope: "recent" | "all") => selected?.wrike_user_id
    ? `/sme-dashboard?sme=${encodeURIComponent(selected.wrike_user_id)}&scope=${nextScope}`
    : `/sme-dashboard?scope=${nextScope}`;
  return <>
    {canSelect && <section className="card sme-selector-card"><form method="get">
      <SearchableFilterSelect label="SME" name="sme" defaultValue={selected?.wrike_user_id ?? ""}
        allLabel="Select an SME" options={selectableIdentities.map((identity) => ({
          value: identity.wrike_user_id ?? "", label: dashboardIdentityLabel(identity),
        }))} />
      <input type="hidden" name="scope" value={scope} /><button>View dashboard</button>
    </form><IdentityResolutionWarnings identities={unresolvedIdentities} /></section>}
    {mappingRequired ? <p className="card notice warning" role="status">Your DevTrack account is not mapped to a verified Wrike identity. Ask an administrator to configure the mapping.</p>
      : !selected ? <p className="card empty">{selectableIdentities.length ? "Select a verified SME to view assigned work." : "No trusted SME assignments are available."}</p>
      : <>
        <div className="card dashboard-identity-note"><p>Showing assignments for <strong>{selected.display_name}</strong>
          {selected.email ? <> ({selected.email})</> : null}. {administrativeView ? "This is a management view; you are not impersonating the SME." : ""}</p>
          <div className="scope-toggle" role="group" aria-label="Assignment period">
            <Link className={scope === "recent" ? "button" : "button secondary"} href={scopeHref("recent")}>Recent</Link>
            <Link className={scope === "all" ? "button" : "button secondary"} href={scopeHref("all")}>All Time</Link>
          </div>
        </div>
        <SmeDashboardAnalytics rows={rows} />
        {rows.length ? <div className="dashboard-table-wrap"><table className="dashboard-project-table sme-project-list"><thead><tr>
          <th>Course</th><th>Status</th><th>Survey</th>
        </tr></thead><tbody>{rows.map((row) => {
          const summary: SurveySummary | null = row.submission_id && row.survey_status ? {
            id: row.submission_id, status: row.survey_status, isLocked: Boolean(row.survey_is_locked),
            canEdit: Boolean(row.survey_can_edit), revisionNumber: 1,
          } : null;
          const href = summary?.status === "draft" ? submissionHref(summary.id, returnTo)
            : !summary && selected.wrike_user_id
              ? surveyHref(row.task_id, "course-development-debrief", selected.wrike_user_id, returnTo)
              : "";
          const ownsSelection = Boolean(currentUserId && currentUserId === selected.application_user_id);
          const allowed = row.is_recent && canLaunchDebrief && ownsSelection && Boolean(href);
          const projectHref = `/sme-dashboard/projects/${row.task_id}?sme=${encodeURIComponent(selected.wrike_user_id ?? "")}&scope=${scope}`;
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
        })}</tbody></table></div> : <p className="card empty">No projects in this period explicitly match this Wrike identity in the SME field.</p>}
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
    <p className="muted">These values are not selectable users. Correct the SME assignment identity in Wrike and re-import.</p>
    <ul>{identities.map((identity) => <li key={identity.identity_key}>{dashboardIdentityLabel(identity)}</li>)}</ul></details>;
}
