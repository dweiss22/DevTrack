import Link from "next/link";
import { StatusBadge } from "@/components/wrike-reference";
import {
  canonicalDashboardIdentities, colleagueReviewLabel, dashboardIdentityLabel,
  submissionHref, surveyActionLabel, surveyHref,
  type DashboardIdentity, type SurveySummary,
} from "@/lib/dashboards/domain";

export type IdDashboardRow = {
  task_id: string;
  title: string;
  status_name: string;
  status_classification: string;
  reviewed_wrike_user_id: string;
  reviewed_sme_name: string;
  reviewed_sme_email: string | null;
  reviewed_sme_application_user_id: string | null;
  sme_mapping_status: "mapped" | "unmapped";
  vertical: string | null;
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

const date = (value: string | null) => value
  ? new Date(value.length === 10 ? `${value}T00:00:00Z` : value).toLocaleDateString("en-US", { timeZone: "UTC" }) : "—";

export function IdDashboard({ identities, selected, rows, canSelect, canActAsAssignedId, mappingRequired, ownOperationalView = false }: {
  identities: DashboardIdentity[];
  selected: DashboardIdentity | null;
  rows: IdDashboardRow[];
  canSelect: boolean;
  canActAsAssignedId: boolean;
  mappingRequired: boolean;
  ownOperationalView?: boolean;
}) {
  const returnTo = selected?.wrike_user_id ? `/id-dashboard?id=${encodeURIComponent(selected.wrike_user_id)}` : "/id-dashboard";
  const canonicalIdentities = canonicalDashboardIdentities(identities);
  const selectableIdentities = canonicalIdentities.filter((identity) => identity.selectable && identity.wrike_user_id);
  const unresolvedIdentities = canonicalIdentities.filter((identity) => !identity.selectable);
  return <>
    {canSelect && <section className="card sme-selector-card"><form method="get">
      <label>Instructional Designer<select name="id" defaultValue={selected?.wrike_user_id ?? ""}>
        <option value="">Select an ID</option>
        {selectableIdentities.map((identity) => <option key={identity.wrike_user_id} value={identity.wrike_user_id ?? ""}>
          {dashboardIdentityLabel(identity)}</option>)}
      </select></label><button>View dashboard</button>
    </form>
      <IdentityResolutionWarnings identities={unresolvedIdentities} />
    </section>}
    {mappingRequired ? <p className="card notice warning" role="status">Your DevTrack account is not mapped to a verified Wrike identity. Ask an administrator to configure the mapping in User Management.</p>
      : !selected ? <p className="card empty">{selectableIdentities.length ? "Select a verified ID to view assigned work." : "No trusted ID assignments are available."}</p>
        : <>
          <p className="card dashboard-identity-note"><strong>{ownOperationalView ? "My assigned ID projects" : "Administrative ID view"}</strong><br />
            Showing assignments for <strong>{selected.display_name}</strong>.
            {canSelect && !ownOperationalView ? " This selection is read-only and does not grant project actions or survey credit." : ""}</p>
          {rows.length ? <div className="dashboard-table-wrap"><table className="dashboard-project-table id-dashboard-table"><thead><tr>
            <th>Course / SME</th><th>Status</th><th>Vertical</th><th>Publication / reporting</th>
            <th>Due / completed</th><th>Project / folder</th><th>Finalized draft</th><th>Review actions</th>
          </tr></thead><tbody>{rows.map((row) => {
            const startHref = surveyHref(row.task_id, "id-sme-review", row.reviewed_wrike_user_id, returnTo);
            const ownHref = row.own_review ? submissionHref(row.own_review.id, returnTo) : startHref;
            return <tr key={`${row.task_id}:${row.reviewed_wrike_user_id}`}>
              <td data-label="Course / SME"><Link href={`/projects/${row.task_id}?returnTo=${encodeURIComponent(returnTo)}`}>{row.title}</Link>
                <br /><strong>{row.reviewed_sme_name}</strong>{row.sme_mapping_status === "unmapped" ? <><br /><span className="muted">No DevTrack SME account</span></> : null}</td>
              <td data-label="Status"><StatusBadge name={row.status_name} /></td>
              <td data-label="Vertical">{row.vertical ?? "Needs context review"}</td>
              <td data-label="Publication / reporting">{row.publication_date ? `Published ${date(row.publication_date)}` : row.publication_year ? `Publication ${row.publication_year}` : "Publication unavailable"}
                <br />Reporting {row.reporting_year ?? "—"}</td>
              <td data-label="Due / completed">Original: {date(row.original_due_date)}<br />{row.completed_at ? `Completed: ${date(row.completed_at)}` : `Due: ${date(row.due_date)}`}</td>
              <td data-label="Project / folder">{row.folder_context}<br /><span className="muted">{row.updated_at_wrike ? `Synced ${new Date(row.updated_at_wrike).toLocaleString()}` : "Sync time unavailable"}</span></td>
              <td data-label="Finalized draft">{row.finalized_draft?.available ? "Available" : "Not available"}
                {canActAsAssignedId ? <><br /><Link href={`/projects/${row.task_id}?returnTo=${encodeURIComponent(returnTo)}#finalized-draft`}>{row.finalized_draft?.available ? "Edit link" : "Add link"}</Link></> : null}</td>
              <td data-label="Review actions"><div className="dashboard-survey-actions">
                {canActAsAssignedId
                  ? <><Link className="button secondary" href={ownHref}>{surveyActionLabel(row.own_review, "review")}</Link>
                    {(row.colleague_reviews ?? []).map((review) => <Link key={review.id} href={submissionHref(review.id, returnTo, true)}>{colleagueReviewLabel(review)}</Link>)}</>
                  : <span className="muted">{row.own_review ? surveyActionLabel(row.own_review, "review") : "No review by selected ID"}</span>}
              </div></td>
            </tr>;
          })}</tbody></table></div> : <p className="card empty">No eligible course-development projects are assigned to this ID.</p>}
        </>}
  </>;
}

function IdentityResolutionWarnings({ identities }: { identities: DashboardIdentity[] }) {
  if (!identities.length) return null;
  return <details className="dashboard-identity-warnings">
    <summary>{identities.length} assignment value{identities.length === 1 ? "" : "s"} need identity resolution</summary>
    <p className="muted">These values are not selectable users. Correct the ID assignment identity in Wrike and re-import; verified people remain listed once by their stable Wrike identity.</p>
    <ul>{identities.map((identity) => <li key={identity.identity_key}>{dashboardIdentityLabel(identity)}</li>)}</ul>
  </details>;
}
