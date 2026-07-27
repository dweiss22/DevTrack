import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PersonalSurveyAction } from "@/components/personal-survey-action";
import { requirePageCapability } from "@/lib/auth";
import { surveyTitle, type SurveyType } from "@/lib/surveys/domain";

type RequirementRow = {
  task_id: string; survey_type: SurveyType; reviewed_wrike_user_id: string | null;
  course_name: string; workflow_status: string; sme_name: string | null;
  reporting_year: number | null; publication_year: number | null; original_due_year: number | null;
  action_available?: boolean; unavailable_reason?: string | null;
  submission_id: string | null; survey_state: "not_started" | "draft" | "submitted";
  version_number: number | null; submitted_at?: string | null;
};

type Requirements = {
  incompleteCount: number; completedCount: number;
  incomplete: RequirementRow[]; completed: RequirementRow[];
};

export default async function SurveysPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { profile, supabase } = await requirePageCapability("view_personal_surveys");
  const tab = (await searchParams).tab === "completed" ? "completed" : "incomplete";
  const { data, error } = await supabase.rpc("survey_personal_requirements");
  const requirements = (data ?? {
    incompleteCount: 0, completedCount: 0, incomplete: [], completed: [],
  }) as Requirements;
  const rows = tab === "completed" ? requirements.completed : requirements.incomplete;
  const returnTo = `/surveys?tab=${tab}`;
  const dashboardHref = profile.role === "sme" ? "/sme-dashboard" : "/id-dashboard";
  return <AppShell>
    <header className="page-header"><div><p className="eyebrow">MY ASSIGNED SURVEYS</p><h1>Surveys</h1>
      <p>{profile.role === "sme" ? "Course debriefs for your exact SME assignments." : "SME reviews for courses assigned to your ID identity."}</p></div>
      <Link className="button secondary" href={dashboardHref}>Return to {profile.role === "sme" ? "SME" : "ID"} Dashboard</Link></header>
    <nav className="survey-tabs" aria-label="Personal survey status">
      <Link href="/surveys?tab=incomplete" aria-current={tab === "incomplete" ? "page" : undefined}>
        Incomplete <span>{requirements.incompleteCount}</span></Link>
      <Link href="/surveys?tab=completed" aria-current={tab === "completed" ? "page" : undefined}>
        Completed <span>{requirements.completedCount}</span></Link>
    </nav>
    {error ? <p className="card notice error" role="alert">Your assigned surveys could not be loaded. Confirm the latest database migration is applied.</p>
      : rows.length ? <div className="dashboard-table-wrap"><table className="dashboard-project-table personal-survey-table"><thead><tr>
        <th>Course</th><th>Survey</th><th>Workflow status</th><th>SME</th><th>Year context</th>
        {tab === "completed" ? <><th>Submitted</th><th>Version</th><th>Review</th></> : <><th>State</th><th>Action</th></>}
      </tr></thead><tbody>{rows.map((row) => <tr key={`${row.task_id}:${row.reviewed_wrike_user_id ?? profile.role}:${row.submission_id ?? "new"}`}>
        <td data-label="Course"><strong>{row.course_name}</strong></td>
        <td data-label="Survey">{surveyTitle(row.survey_type)}</td>
        <td data-label="Workflow status">{row.workflow_status}</td>
        <td data-label="SME">{row.sme_name ?? (profile.role === "sme" ? "You" : "Unavailable")}</td>
        <td data-label="Year context">{row.publication_year ? `Publication ${row.publication_year}` : row.reporting_year ? `Reporting ${row.reporting_year}` : row.original_due_year ? `Original due ${row.original_due_year}` : "Unavailable"}</td>
        {tab === "completed" ? <>
          <td data-label="Submitted">{row.submitted_at ? new Date(row.submitted_at).toLocaleString() : "Unavailable"}</td>
          <td data-label="Version">Version {row.version_number ?? "Unavailable"}</td>
          <td data-label="Review">{row.submission_id && <Link className="button secondary"
            href={`/surveys/${row.submission_id}?returnTo=${encodeURIComponent(returnTo)}&readOnly=1`}>Review answers</Link>}</td>
        </> : <>
          <td data-label="State"><span className={`survey-status ${row.survey_state === "draft" ? "draft" : "unlocked"}`}>
            {row.survey_state === "draft" ? "Draft" : "Not started"}</span></td>
          <td data-label="Action">{row.action_available === false
            ? <span className="survey-unavailable-explanation" role="status">{row.unavailable_reason ?? "This survey is not available yet."}</span>
            : row.submission_id
              ? <Link className="button secondary" href={`/surveys/${row.submission_id}?returnTo=${encodeURIComponent(returnTo)}`}>Continue survey</Link>
              : <PersonalSurveyAction taskId={row.task_id} reviewedWrikeUserId={row.reviewed_wrike_user_id}
                label="Take survey" returnTo={returnTo} />}</td>
        </>}
      </tr>)}</tbody></table></div>
      : <p className="card empty">{tab === "completed" ? "You have not submitted any surveys yet." : "All currently assigned surveys are complete."}</p>}
  </AppShell>;
}
