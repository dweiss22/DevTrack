import { AppShell } from "@/components/app-shell";
import {
  FinalizedHistoricalSurveyImports,
  type FinalizedImportBatch,
  type FinalizedImportIssue,
  type FinalizedImportRow,
} from "@/components/finalized-historical-survey-imports";
import { requirePageCapability } from "@/lib/auth";
import { hasCapability } from "@/lib/auth/roles";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function HistoricalSurveyImportsPage({ searchParams }: {
  searchParams: Promise<{ batch?: string; records?: string }>;
}) {
  const { profile } = await requirePageCapability("manage_data");
  const params = await searchParams;
  const admin = createAdminClient();
  const { data: batches, error: batchError } = await admin.from("survey_historical_import_batches")
    .select("id,source_filename,external_survey_type,survey_type,survey_versions,source_timezone,status,summary,created_at,finalized_at")
    .eq("organization_id", profile.organization_id)
    .order("created_at", { ascending: false })
    .limit(100);
  const selectedId = params.batch && (batches ?? []).some((batch) => batch.id === params.batch)
    ? params.batch
    : (batches ?? []).find((batch) => batch.external_survey_type)?.id ?? null;
  const activeBatch = (batches ?? []).find((batch) => batch.id === selectedId) ?? null;
  const [rowsResult, issuesResult, projectsResult, principalsResult, usersResult, responsesResult] = await Promise.all([
    selectedId ? admin.from("survey_historical_import_rows")
      .select("id,batch_id,row_number,external_survey_type,survey_version,source_response_id,effective_source_response_id,raw_row,normalized_answers,normalization_deltas,match_diagnostics,context_snapshot,matched_task_id,respondent_principal_id,reviewed_wrike_user_id,selected_for_import,duplicate_action,duplicate_target_response_id,explicit_unmatched,row_status,finalized_status,historical_response_id")
      .eq("organization_id", profile.organization_id).eq("batch_id", selectedId).order("row_number")
      : Promise.resolve({ data: [], error: null }),
    selectedId ? admin.from("survey_historical_import_issues")
      .select("id,row_id,issue_code,severity,source_field,message,raw_value,resolution_status")
      .eq("organization_id", profile.organization_id).eq("batch_id", selectedId).order("created_at")
      : Promise.resolve({ data: [], error: null }),
    admin.from("wrike_tasks").select("id,title,wrike_id").eq("organization_id", profile.organization_id)
      .eq("is_deleted", false).order("title").limit(10_000),
    admin.from("application_user_principals").select("id,display_name,state")
      .eq("organization_id", profile.organization_id).order("display_name").limit(10_000),
    admin.from("wrike_users").select("id,display_name,email").eq("organization_id", profile.organization_id)
      .eq("identity_verified", true).eq("is_unresolved", false).order("display_name").limit(10_000),
    selectedId ? admin.from("historical_survey_responses")
      .select("id,historical_course_name,survey_type,original_source_response_id,submitted_at,matched_task_id")
      .eq("organization_id", profile.organization_id).eq("import_batch_id", selectedId)
      .order("submitted_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);
  const loadError = batchError ?? rowsResult.error ?? issuesResult.error ?? projectsResult.error
    ?? principalsResult.error ?? usersResult.error ?? responsesResult.error;
  const responses = params.records === "unmatched"
    ? (responsesResult.data ?? []).filter((response) => !response.matched_task_id)
    : responsesResult.data ?? [];

  return <AppShell isAdmin>
    <header className="page-header"><div><p className="eyebrow">ADMINISTRATIVE FUNCTIONS</p>
      <h1>Historical Survey Imports</h1>
      <p>Validate, normalize, reconcile, and import approved pre-DevTrack survey CSV files.</p></div></header>
    {loadError
      ? <p className="card notice error" role="alert">Historical imports require the latest database migration. {loadError.message}</p>
      : <FinalizedHistoricalSurveyImports
        batches={(batches ?? []) as FinalizedImportBatch[]}
        activeBatch={activeBatch as FinalizedImportBatch | null}
        rows={(rowsResult.data ?? []) as FinalizedImportRow[]}
        issues={(issuesResult.data ?? []) as FinalizedImportIssue[]}
        projects={(projectsResult.data ?? []).map((row) => ({ id: row.id, label: row.title, detail: row.wrike_id }))}
        principals={(principalsResult.data ?? []).map((row) => ({
          id: row.id, label: row.display_name ?? "Unnamed retained principal", detail: row.state,
        }))}
        wrikeUsers={(usersResult.data ?? []).map((row) => ({ id: row.id, label: row.display_name, detail: row.email }))}
        historicalResponses={responses as never}
        canReplace={hasCapability(profile.access, "manage_surveys")}
      />}
  </AppShell>;
}
