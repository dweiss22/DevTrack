import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requirePageCapability } from "@/lib/auth";
import { isAdministratorRole } from "@/lib/auth/roles";
import { surveyTitle, type SurveyType } from "@/lib/surveys/domain";

export default async function SurveysPage() {
  const { profile, supabase } = await requirePageCapability("view_surveys");
  const { data, error } = await supabase.from("survey_submissions").select(
    "id,survey_type,status,is_locked,revision_number,updated_at,context_snapshot"
  ).order("updated_at", { ascending: false }).limit(500);
  if (error) throw new Error("Survey responses could not be loaded.");
  return <AppShell isAdmin={isAdministratorRole(profile.role)}>
    <header className="page-header"><div><p className="eyebrow">COURSE DEVELOPMENT</p><h1>Surveys</h1><p>Draft, submitted, locked, and revision history within your authorized scope.</p></div></header>
    {(data ?? []).length ? <div className="admin-table-wrap"><table className="survey-list"><thead><tr><th>Survey</th><th>Course</th><th>SME</th><th>Status</th><th>Revision</th><th>Updated</th></tr></thead><tbody>
      {(data ?? []).map((row) => {
        const context = row.context_snapshot as Record<string, unknown>;
        const subject = (context.subject ?? {}) as Record<string, unknown>;
        return <tr key={row.id}><td><Link href={`/surveys/${row.id}`}>{surveyTitle(row.survey_type as SurveyType)}</Link></td>
          <td>{String(context.taskTitle ?? "Unavailable")}</td><td>{String(subject.name ?? "Unavailable")}</td>
          <td><span className={`survey-status ${row.status}`}>{row.status}</span> <span className={`survey-status ${row.is_locked ? "locked" : "unlocked"}`}>{row.is_locked ? "Locked" : "Editable"}</span></td>
          <td>{row.revision_number}</td><td>{new Date(row.updated_at).toLocaleString()}</td></tr>;
      })}
    </tbody></table></div> : <p className="card empty">No surveys are available in your authorized scope.</p>}
  </AppShell>;
}
