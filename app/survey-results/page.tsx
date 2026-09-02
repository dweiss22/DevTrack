import { AppShell } from "@/components/app-shell";
import { PerformanceRatingsGrid, type PerformanceRatingRow } from "@/components/survey-results-grid";
import { requirePageCapability } from "@/lib/auth";
import { isAdministratorRole } from "@/lib/auth/roles";
import { reportingFailure, type ReportingFailure } from "@/lib/reporting/failure";
import { ID_REVIEW_STATEMENTS, SME_DEBRIEF_STATEMENTS } from "@/lib/surveys/domain";

type SmePerformanceRow = {
  sme_identity_id: string | null; sme_name: string | null; submission_count: number | null;
  average_rating: number | null; statement_averages: (number | null)[] | null; unresolved_count: number;
};
type IdPerformanceRow = {
  id_wrike_user_id: string | null; id_name: string | null; id_email: string | null; mapping_status: string | null;
  submission_count: number | null; average_rating: number | null; statement_averages: (number | null)[] | null;
  unresolved_count: number;
};

export default async function SurveyResultsPage() {
  const { supabase, profile } = await requirePageCapability("view_surveys");
  const [{ data: smeData, error: smeError }, { data: idData, error: idError }] = await Promise.all([
    supabase.rpc("sme_performance_ratings"),
    supabase.rpc("id_performance_ratings"),
  ]);
  const smeRows = (smeData ?? []) as SmePerformanceRow[];
  const idRows = (idData ?? []) as IdPerformanceRow[];
  const smeFailure = smeError ? reportingFailure(smeError, "SME performance ratings", "202609020005_id_and_sme_performance_ratings.sql") : null;
  const idFailure = idError ? reportingFailure(idError, "ID performance ratings", "202609020005_id_and_sme_performance_ratings.sql") : null;
  const smeUnresolved = smeRows[0]?.unresolved_count ?? 0;
  const idUnresolved = idRows[0]?.unresolved_count ?? 0;
  return <AppShell isAdmin={isAdministratorRole(profile.access)}>
    <header className="page-header"><div><p className="eyebrow">COURSE DEVELOPMENT</p>
      <h1>Survey Results</h1>
      <p>Average ratings blended from live submissions and imported historical surveys.</p></div></header>
    <section className="card"><div className="section-heading"><div><p className="eyebrow">HOW SMES PERFORMED</p>
      <h2>SME Performance</h2></div></div>
      <p>Average ratings from ID Reviews of SME, grouped by SME.</p>
      {smeUnresolved > 0 && <p className="notice warning">{smeUnresolved} historical response{smeUnresolved === 1 ? "" : "s"} could not be matched to a known SME and are excluded.</p>}
      <ResultsSection failure={smeFailure} rows={smeRows.filter((row) => row.sme_identity_id !== null)} statements={ID_REVIEW_STATEMENTS}
        toRow={(row) => ({ subject_id: row.sme_identity_id as string, subject_name: row.sme_name as string, submission_count: row.submission_count as number, average_rating: row.average_rating, statement_averages: row.statement_averages })}
        emptyMessage="No submitted ID Reviews of SME yet." /></section>
    <section className="card"><div className="section-heading"><div><p className="eyebrow">HOW IDS PERFORMED</p>
      <h2>ID Performance</h2></div></div>
      <p>Average ratings from the SME's own Course Development Debrief, grouped by the ID responsible for the project.</p>
      {idUnresolved > 0 && <p className="notice warning">{idUnresolved} historical response{idUnresolved === 1 ? "" : "s"} could not be matched to a known ID and are excluded.</p>}
      <ResultsSection failure={idFailure} rows={idRows.filter((row) => row.id_wrike_user_id !== null)} statements={SME_DEBRIEF_STATEMENTS}
        toRow={(row) => ({ subject_id: row.id_wrike_user_id as string, subject_name: row.id_name as string, submission_count: row.submission_count as number, average_rating: row.average_rating, statement_averages: row.statement_averages })}
        emptyMessage="No submitted Course Development Debrief surveys yet." /></section>
  </AppShell>;
}

function ResultsSection<Row>({ failure, rows, statements, toRow, emptyMessage }: {
  failure: ReportingFailure | null; rows: Row[]; statements: readonly string[];
  toRow: (row: Row) => PerformanceRatingRow; emptyMessage: string;
}) {
  if (failure) return <div className="dashboard-query-error" role="alert">
    <h3>{failure.title}</h3>
    <p>{failure.message}</p>
    {failure.diagnosticCode ? <p><strong>Database code:</strong> <code>{failure.diagnosticCode}</code></p> : null}
    {failure.technicalMessage ? <p><strong>Details:</strong> {failure.technicalMessage}</p> : null}
  </div>;
  return <PerformanceRatingsGrid rows={rows.map(toRow)} statements={statements} emptyMessage={emptyMessage} />;
}
