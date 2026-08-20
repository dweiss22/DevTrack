import Link from "next/link";
import React from "react";
import { FinalizedDraftDashboardCell } from "@/components/finalized-draft-dashboard-cell";
import { IdDashboardAnalyticsSection } from "@/components/id-dashboard-analytics";
import { SearchableFilterSelect } from "@/components/searchable-filter-select";
import { StatusBadge } from "@/components/wrike-reference";
import {
  canonicalDashboardIdentities, colleagueReviewLabel, dashboardIdentityLabel,
  submissionHref, surveyActionLabel, surveyHref,
  type DashboardIdentity, type SurveySummary,
} from "@/lib/dashboards/domain";
import type { IdDashboardAnalytics } from "@/lib/dashboards/id-analytics";
import { sortDashboardProjectsNewestFirst } from "@/lib/dashboards/project-order";

export type IdDashboardRow = {
  task_id: string;
  title: string;
  status_name: string;
  status_classification: string;
  reviewed_wrike_user_id: string | null;
  sme_identity_id: string | null;
  reviewed_sme_name: string | null;
  reviewed_sme_email: string | null;
  reviewed_sme_application_user_id: string | null;
  sme_mapping_status: "mapped" | "unmapped" | null;
  sme_identity_status: "discovered" | "verified" | "resolved" | "ambiguous" | "unresolved" | "conflict" | "missing";
  sme_assignment_values: string[];
  vertical: string | null;
  course_style?: string | null;
  publication_date: string | null;
  publication_year: number | null;
  reporting_year: number | null;
  original_due_date: string | null;
  due_date: string | null;
  completed_at: string | null;
  folder_context: string;
  updated_at_wrike: string | null;
  own_review: SurveySummary | null;
  colleague_reviews: SurveySummary[];
  finalized_draft?: { available: boolean; updatedAt?: string | null; updatedBy?: string | null };
};

export function IdDashboard({ identities, selected, rows, canSelect, canActAsAssignedId, mappingRequired, analytics = null, analyticsError = null }: {
  identities: DashboardIdentity[];
  selected: DashboardIdentity | null;
  rows: IdDashboardRow[];
  canSelect: boolean;
  canActAsAssignedId: boolean;
  mappingRequired: boolean;
  ownOperationalView?: boolean;
  analytics?: IdDashboardAnalytics | null;
  analyticsError?: string | null;
}) {
  const returnTo = selected?.wrike_user_id ? `/id-dashboard?id=${encodeURIComponent(selected.wrike_user_id)}` : "/id-dashboard";
  const canonicalIdentities = canonicalDashboardIdentities(identities);
  const selectableIdentities = canonicalIdentities.filter((identity) => identity.selectable && identity.wrike_user_id);
  const unresolvedIdentities = canonicalIdentities.filter((identity) => !identity.selectable);
  const orderedRows = sortDashboardProjectsNewestFirst(rows);
  return <>
    {canSelect && <section className="card sme-selector-card"><form method="get">
      <SearchableFilterSelect label="Instructional Designer" name="id"
        defaultValue={selected?.wrike_user_id ?? ""} allLabel="Select an ID"
        options={selectableIdentities.map((identity) => ({
          value: identity.wrike_user_id ?? "", label: dashboardIdentityLabel(identity),
        }))} />
      <button>View dashboard</button>
    </form>
      <IdentityResolutionWarnings identities={unresolvedIdentities} />
    </section>}
    {mappingRequired ? <p className="card notice warning" role="status">Your DevTrack account is not mapped to a verified Wrike identity. Ask an administrator to configure the mapping in User Management.</p>
      : !selected ? <p className="card empty">{selectableIdentities.length ? "Select a verified ID to view assigned work." : "No trusted ID assignments are available."}</p>
        : <>
          <IdDashboardAnalyticsSection key={selected.wrike_user_id} analytics={analytics} error={analyticsError} />
          {orderedRows.length ? <div className="dashboard-table-wrap"><table className="dashboard-project-table id-dashboard-table">
            <caption className="sr-only">Projects ordered from most recent to oldest</caption><thead><tr>
            <th>Course Name</th><th>SME</th><th>Status</th><th>Vertical</th><th>Course Style</th>
            <th>Finalized Draft</th><th>Survey</th>
          </tr></thead><tbody>{orderedRows.map((row) => {
            const reviewAvailable = Boolean(row.sme_identity_id)
              && !["ambiguous", "conflict", "missing", "unresolved"].includes(row.sme_identity_status);
            const startHref = reviewAvailable
              ? surveyHref(row.task_id, "id-sme-review", row.sme_identity_id, returnTo) : null;
            const ownHref = row.own_review ? submissionHref(row.own_review.id, returnTo) : startHref;
            return <tr key={`${row.task_id}:${row.sme_identity_id ?? row.sme_identity_status}`}>
              <td data-label="Course Name"><Link href={`/projects/${row.task_id}?returnTo=${encodeURIComponent(returnTo)}`}>{row.title}</Link></td>
              <td data-label="SME">{row.sme_identity_status === "verified" ? <>
                  <strong>{row.reviewed_sme_name ?? "Verified SME"}</strong>
                </> : reviewAvailable
                  ? <strong>{row.reviewed_sme_name ?? "Identified SME"}</strong>
                  : <UnavailableSmeAssignment row={row} />}</td>
              <td data-label="Status"><StatusBadge name={row.status_name} /></td>
              <td data-label="Vertical">{row.vertical ?? "Needs context review"}</td>
              <td data-label="Course Style">{row.course_style ?? "—"}</td>
              <td data-label="Finalized Draft">{canActAsAssignedId
                ? <FinalizedDraftDashboardCell taskId={row.task_id} initial={row.finalized_draft ?? { available: false }} />
                : row.finalized_draft?.available ? "Available" : "Not available"}</td>
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
          })}</tbody></table></div> : <p className="card empty">No synchronized Online Learning projects explicitly match this Wrike identity in the ID Assigned field.</p>}
        </>}
  </>;
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

function IdentityResolutionWarnings({ identities }: { identities: DashboardIdentity[] }) {
  if (!identities.length) return null;
  return <details className="dashboard-identity-warnings">
    <summary>{identities.length} assignment value{identities.length === 1 ? "" : "s"} need identity resolution</summary>
    <p className="muted">These values do not uniquely match an active, verified Wrike identity and are not selectable users. Correct ambiguous ID/owner values in Wrike, then re-import; verified people remain listed once by their stable identity.</p>
    <ul>{identities.map((identity) => <li key={identity.identity_key}>{dashboardIdentityLabel(identity)}</li>)}</ul>
  </details>;
}
