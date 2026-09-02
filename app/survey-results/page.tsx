import { AppShell } from "@/components/app-shell";
import { SurveyResultsGrid, type SurveyResultRow } from "@/components/survey-results-grid";
import { requirePageCapability } from "@/lib/auth";
import { isAdministratorRole } from "@/lib/auth/roles";
import { reportingFailure } from "@/lib/reporting/failure";

export default async function SurveyResultsPage() {
  const { supabase, profile } = await requirePageCapability("view_surveys");
  const { data, error } = await supabase.rpc("survey_results_by_sme");
  const rows = (data ?? []) as SurveyResultRow[];
  const failure = error ? reportingFailure(error, "Survey results", "202609010005_survey_results_by_sme.sql") : null;
  return <AppShell isAdmin={isAdministratorRole(profile.access)}>
    <header className="page-header"><div><p className="eyebrow">COURSE DEVELOPMENT</p>
      <h1>Survey Results</h1>
      <p>Average ratings from submitted Course Development Debrief surveys, grouped by SME.</p></div></header>
    {failure ? <section className="card dashboard-query-error" role="alert">
      <p className="eyebrow">SURVEY RESULTS DATA</p>
      <h2>{failure.title}</h2>
      <p>{failure.message}</p>
      {failure.diagnosticCode ? <p><strong>Database code:</strong> <code>{failure.diagnosticCode}</code></p> : null}
      {failure.technicalMessage ? <p><strong>Details:</strong> {failure.technicalMessage}</p> : null}
    </section> : <SurveyResultsGrid rows={rows} />}
  </AppShell>;
}
