import Link from "next/link";
import { StatusBadge } from "@/components/wrike-reference";
import {
  submissionHref, surveyActionLabel, surveyHref, type DashboardIdentity, type SurveySummary,
} from "@/lib/dashboards/domain";

export type SmeDashboardRow = {
  task_id: string;
  title: string;
  status_name: string;
  status_classification: string;
  reporting_year: number | null;
  original_due_date: string | null;
  due_date: string | null;
  completed_at: string | null;
  actual_minutes: number;
  folder_context: string;
  updated_at_wrike: string | null;
  is_overdue: boolean;
  subject_application_user_id: string | null;
  submission_id: string | null;
  survey_status: "draft" | "submitted" | null;
  survey_is_locked: boolean | null;
  survey_can_edit: boolean | null;
  finalized_draft_available?: boolean;
};

const date = (value: string | null) => value
  ? new Date(value.length === 10 ? `${value}T00:00:00Z` : value).toLocaleDateString("en-US", { timeZone: "UTC" }) : "—";
const hours = (minutes: number) => `${(minutes / 60).toFixed(1)}h`;

export function SmeDashboard({ identities, selected, rows, canSelect, canViewProjects, canLaunchDebrief, restrictedSmeView, administrativeView, mappingRequired }: {
  identities: DashboardIdentity[];
  selected: DashboardIdentity | null;
  rows: SmeDashboardRow[];
  canSelect: boolean;
  canViewProjects: boolean;
  canLaunchDebrief: boolean;
  restrictedSmeView: boolean;
  administrativeView: boolean;
  mappingRequired: boolean;
}) {
  const returnTo = selected?.wrike_user_id ? `/sme-dashboard?sme=${encodeURIComponent(selected.wrike_user_id)}` : "/sme-dashboard";
  return <>
    {canSelect && <section className="card sme-selector-card"><form method="get">
      <label>SME<select name="sme" defaultValue={selected?.wrike_user_id ?? ""}>
        <option value="">Select an SME</option>
        {identities.map((identity) => <option key={identity.identity_key} value={identity.wrike_user_id ?? ""}
          disabled={!identity.selectable}>{identity.display_name}{identity.mapping_status === "unmapped" ? " — no DevTrack account" : ""}{!identity.selectable ? ` — ${identity.identity_status}` : ""}</option>)}
      </select></label><button>View dashboard</button>
    </form></section>}
    {mappingRequired
      ? <p className="card notice warning" role="status">Your DevTrack account is not mapped to a verified Wrike identity. Ask an administrator to configure the mapping in User Management.</p>
      : !selected
        ? <p className="card empty">{identities.length ? "Select a verified SME to view assigned work." : "No trusted SME assignments are available."}</p>
        : <>
          <p className="card dashboard-identity-note">Showing assignments for <strong>{selected.display_name}</strong>
            {selected.email ? <> ({selected.email})</> : null}. {selected.mapping_status === "unmapped" ? "This person does not yet have a DevTrack account." : "Identity verified and mapped."}
            {administrativeView ? " This is an administrative assignment view; you are not impersonating the SME." : ""}</p>
          <div className="metric-grid sme-metrics">
            <article className="card metric-card"><span>Assigned courses</span><strong>{rows.length}</strong></article>
            <article className="card metric-card"><span>Active</span><strong>{rows.filter((row) => row.status_classification === "active").length}</strong></article>
            <article className="card metric-card"><span>Completed</span><strong>{rows.filter((row) => row.completed_at || row.status_classification === "completed").length}</strong></article>
            {!restrictedSmeView && <article className="card metric-card"><span>Logged time</span><strong>{hours(rows.reduce((sum, row) => sum + Number(row.actual_minutes || 0), 0))}</strong></article>}
          </div>
          {rows.length ? <div className="dashboard-table-wrap"><table className="dashboard-project-table"><thead><tr>
            <th>Course</th><th>Status</th><th>Reporting year</th>
            {!restrictedSmeView && <><th>Original due</th><th>Due / completed</th><th>Project / folder</th><th>Last synchronized</th></>}
            {restrictedSmeView && <th>Finalized draft</th>}<th>Debrief</th>
          </tr></thead><tbody>{rows.map((row) => {
            const summary: SurveySummary | null = row.submission_id && row.survey_status ? {
              id: row.submission_id, status: row.survey_status, isLocked: Boolean(row.survey_is_locked),
              canEdit: Boolean(row.survey_can_edit), revisionNumber: 1,
            } : null;
            const href = summary ? submissionHref(summary.id, returnTo)
              : selected.wrike_user_id ? surveyHref(row.task_id, "course-development-debrief", selected.wrike_user_id, returnTo) : "";
            const allowed = canLaunchDebrief && Boolean(selected.application_user_id) && Boolean(href);
            return <tr key={row.task_id}>
              <td data-label="Course">{restrictedSmeView
                ? <Link href={`/sme-dashboard/projects/${row.task_id}`}>{row.title}</Link>
                : canViewProjects ? <Link href={`/projects/${row.task_id}?returnTo=${encodeURIComponent(returnTo)}`}>{row.title}</Link> : row.title}</td>
              <td data-label="Status"><StatusBadge name={row.status_name} />{row.is_overdue ? <><br /><span className="error">Overdue</span></> : null}</td>
              <td data-label="Reporting year">{row.reporting_year ?? "—"}</td>
              {!restrictedSmeView && <><td data-label="Original due">{date(row.original_due_date)}</td>
                <td data-label="Due / completed">{row.completed_at ? `Completed ${date(row.completed_at)}` : date(row.due_date)}</td>
                <td data-label="Project / folder">{row.folder_context}</td>
                <td data-label="Last synchronized">{row.updated_at_wrike ? new Date(row.updated_at_wrike).toLocaleString() : "—"}</td></>}
              {restrictedSmeView && <td data-label="Finalized draft">{row.finalized_draft_available ? "Available" : "Not available"}</td>}
              <td data-label="Debrief">{allowed ? <Link className="button secondary" href={href}>{surveyActionLabel(summary, "survey")}</Link>
                : summary ? <span className="muted">{summary.status === "draft" ? "Draft"
                  : summary.isLocked ? "Submitted · Locked" : "Submitted · Unlocked"}</span>
                  : selected.mapping_status === "unmapped" ? <span className="muted">Account mapping required</span> : "—"}</td>
            </tr>;
          })}</tbody></table></div> : <p className="card empty">No eligible course-development projects are assigned to this SME.</p>}
        </>}
  </>;
}
