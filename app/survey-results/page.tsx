import { AppShell } from "@/components/app-shell";
import { SurveyResultsGrid, type SurveyResultRow } from "@/components/survey-results-grid";
import { requirePageCapability } from "@/lib/auth";
import { isAdministratorRole } from "@/lib/auth/roles";

export default async function SurveyResultsPage() {
  const { supabase, profile } = await requirePageCapability("view_surveys");
  const { data, error } = await supabase.rpc("survey_results_by_sme");
  const rows = (data ?? []) as SurveyResultRow[];
  return <AppShell isAdmin={isAdministratorRole(profile.access)}>
    <header className="page-header"><div><p className="eyebrow">COURSE DEVELOPMENT</p>
      <h1>Survey Results</h1>
      <p>Average ratings from submitted Course Development Debrief surveys, grouped by SME.</p></div></header>
    {error ? <p className="card notice error" role="alert">Survey results could not be loaded.</p>
      : <SurveyResultsGrid rows={rows} />}
  </AppShell>;
}
