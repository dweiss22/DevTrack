import Link from "next/link";
import { PersonalSurveyAction } from "@/components/personal-survey-action";
import { surveyTitle, type SurveyType } from "@/lib/surveys/domain";

export type RequirementRow = {
  task_id: string; survey_type: SurveyType; reviewed_wrike_user_id: string | null;
  reviewed_sme_identity_id: string | null;
  course_name: string; workflow_status: string; sme_name: string | null;
  reporting_year: number | null; publication_year: number | null; original_due_year: number | null;
  action_available?: boolean; unavailable_reason?: string | null;
  completed_on?: string | null; available_through?: string | null; availability_code?: string | null;
  submission_id: string | null; survey_state: "not_started" | "draft" | "submitted";
  version_number: number | null; submitted_at?: string | null;
};

export type Requirements = {
  incompleteCount: number; completedCount: number;
  incomplete: RequirementRow[]; completed: RequirementRow[];
};

export function PersonalSurveyList({ requirements, tab, tabHref, returnTo }: {
  requirements: Requirements;
  tab: "incomplete" | "completed";
  tabHref: (tab: "incomplete" | "completed") => string;
  returnTo: string;
}) {
  const rows = tab === "completed" ? requirements.completed : requirements.incomplete;
  return <section className="card personal-survey-list" aria-labelledby="personal-survey-list-heading">
    <div className="section-heading"><div><p className="eyebrow">MY ASSIGNED SURVEYS</p><h2 id="personal-survey-list-heading">Surveys</h2></div></div>
    <nav className="survey-tabs" aria-label="Personal survey status">
      <Link href={tabHref("incomplete")} aria-current={tab === "incomplete" ? "page" : undefined}>
        Incomplete <span>{requirements.incompleteCount}</span></Link>
      <Link href={tabHref("completed")} aria-current={tab === "completed" ? "page" : undefined}>
        Completed <span>{requirements.completedCount}</span></Link>
    </nav>
    {rows.length ? <div className="dashboard-table-wrap"><table className="dashboard-project-table personal-survey-table"><thead><tr>
      <th>Course</th><th>Survey</th><th>Workflow status</th><th>SME</th><th>Year context</th>
      {tab === "completed" ? <><th>Submitted</th><th>Version</th><th>Review</th></> : <><th>State</th><th>Action</th></>}
    </tr></thead><tbody>{rows.map((row) => <tr key={`${row.task_id}:${row.reviewed_sme_identity_id ?? row.reviewed_wrike_user_id ?? "id"}:${row.submission_id ?? "new"}`}>
      <td data-label="Course"><strong>{row.course_name}</strong></td>
      <td data-label="Survey">{surveyTitle(row.survey_type)}</td>
      <td data-label="Workflow status">{row.workflow_status}</td>
      <td data-label="SME">{row.sme_name ?? "Unavailable"}</td>
      <td data-label="Year context">{row.publication_year ? `Publication ${row.publication_year}` : row.reporting_year ? `Reporting ${row.reporting_year}` : row.original_due_year ? `Original due ${row.original_due_year}` : "Unavailable"}</td>
      {tab === "completed" ? <>
        <td data-label="Submitted">{row.submitted_at ? new Date(row.submitted_at).toLocaleString() : "Unavailable"}</td>
        <td data-label="Version">Version {row.version_number ?? "Unavailable"}</td>
        <td data-label="Review">{row.submission_id && <Link className="button secondary"
          href={`/surveys/${row.submission_id}?returnTo=${encodeURIComponent(returnTo)}&readOnly=1`}>Review answers</Link>}</td>
      </> : <>
        <td data-label="State"><span className={`survey-status ${row.survey_state === "draft" ? "draft" : "unlocked"}`}>
          {row.survey_state === "draft" ? "Draft" : "Not started"}</span>
          {row.available_through ? <span className="survey-availability-date">
            Available through {row.available_through}
          </span> : null}</td>
        <td data-label="Action">{row.action_available === false
          ? <span className="survey-unavailable-explanation" role="status">{row.unavailable_reason ?? "This survey is not available yet."}</span>
          : row.submission_id
            ? <Link className="button secondary" href={`/surveys/${row.submission_id}?returnTo=${encodeURIComponent(returnTo)}`}>Continue survey</Link>
            : <PersonalSurveyAction taskId={row.task_id}
              reviewedSmeIdentityId={row.reviewed_sme_identity_id}
              reviewedWrikeUserId={row.reviewed_wrike_user_id}
              label="Take survey" returnTo={returnTo} />}</td>
      </>}
    </tr>)}</tbody></table></div>
      : <p className="empty">{tab === "completed" ? "You have not submitted any surveys yet." : "All currently assigned surveys are complete."}</p>}
  </section>;
}
