import { AppShell } from "@/components/app-shell";
import { AdminPanel } from "@/components/admin-panel";
import type {
  HistoricalColumnMapping,
  HistoricalImportBatch,
  HistoricalImportIssue,
  HistoricalImportRow,
  HistoricalTemplate,
  HistoricalResolutionOptions,
  HistoricalResolutionAudit,
} from "@/components/historical-survey-imports";
import type { ImportConflict } from "@/components/import-conflict-review";
import { requirePageCapability } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { SELECTED_WRIKE_FOLDERS } from "@/lib/wrike/selected-folders";
import { canonicalCsvContract } from "@/lib/surveys/csv-contract";
import { surveyDefinitionSchema } from "@/lib/surveys/definition";

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const { supabase, profile } = await requirePageCapability("manage_data");
  const admin = createAdminClient();
  const params = await searchParams;
  const [
    { data: connection },
    { data: folderRuns },
    { data: unresolvedReferences },
    verticalDiagnostics,
    repairDiagnostics,
    { data: repairRuns },
    importConflicts,
    { data: historicalBatches },
    { data: historicalRows },
    { data: historicalIssues },
    { data: historicalMappings },
    { data: publishedSurveyVersions },
    { data: historicalProjectOptions },
    { data: historicalPrincipalOptions },
    { data: historicalWrikeUserOptions },
    { data: historicalResolutionAudit },
  ] = await Promise.all([
    admin.from("wrike_connections").select("status,account_name,api_host,oauth_scopes,token_expires_at,updated_at").eq("organization_id", profile.organization_id).maybeSingle(),
    admin.from("wrike_folder_task_import_runs").select("id,status,folder_counts,timelog_folder_counts,task_count,unique_timelog_count,task_request_count,timelog_request_count,failed_folder_request_count,folder_failures,duration_ms,folder_definition_count,custom_field_definition_count,metadata_diagnostics,timelog_descendant_strategy,timelog_descendant_diagnostics,reference_data_diagnostics,reference_warning_count,custom_field_conflict_count,custom_field_normalization_diagnostics,task_custom_field_diagnostics,unresolved_reference_count,reference_resolution_diagnostics,error_summary,created_at").eq("organization_id", profile.organization_id).order("created_at", { ascending: false }).limit(10),
    admin.from("wrike_unresolved_references").select("id,reference_type,wrike_id,sample_values,related_records,occurrence_count,resolution_attempts,first_encountered_at,last_encountered_at,last_attempted_at,last_error,resolution_status").eq("organization_id", profile.organization_id).eq("resolution_status", "unresolved").order("last_encountered_at", { ascending: false }),
    supabase.rpc("reporting_vertical_data_quality"),
    supabase.rpc("reporting_vertical_repair_diagnostics", { result_limit: 200 }),
    admin.from("wrike_vertical_repair_runs").select("id,status,examined_count,repaired_count,unchanged_count,unresolved_count,conflicting_count,failed_count,retained_count,still_incomplete_count,started_at,completed_at,error_summary").eq("organization_id", profile.organization_id).order("started_at", { ascending: false }).limit(10),
    admin.from("wrike_task_normalized_custom_field_values")
      .select("task_id,normalized_field_id,display_values,source_wrike_field_ids,source_titles,source_values,conflict_metadata,synced_at,task:wrike_tasks!inner(id,wrike_id,title,status,permalink,updated_at_wrike),normalized_field:wrike_normalized_custom_fields!inner(id,normalized_key,title)", { count: "exact" })
      .eq("has_conflict", true)
      .eq("task.organization_id", profile.organization_id)
      .eq("normalized_field.organization_id", profile.organization_id)
      .order("synced_at", { ascending: false })
      .limit(200),
    admin.from("survey_historical_import_batches")
      .select("id,source_filename,survey_type,source_timezone,status,summary,created_at,integrated_at,rolled_back_at")
      .eq("organization_id", profile.organization_id).order("created_at", { ascending: false }).limit(50),
    admin.from("survey_historical_import_rows")
      .select("id,batch_id,row_number,survey_type,raw_row,normalized_answers,match_diagnostics,matched_task_id,respondent_principal_id,reviewed_wrike_user_id,repeat_resolution,revision_order,row_status")
      .eq("organization_id", profile.organization_id).order("row_number", { ascending: true }).limit(2000),
    admin.from("survey_historical_import_issues")
      .select("id,batch_id,row_id,issue_code,severity,source_field,message,raw_value,candidates")
      .eq("organization_id", profile.organization_id).eq("resolution_status", "open").order("created_at", { ascending: true }).limit(5000),
    admin.from("survey_historical_import_column_mappings")
      .select("id,batch_id,original_heading,canonical_question_id,mapping_target,normalized_conversion,mapping_source")
      .eq("organization_id", profile.organization_id).order("column_ordinal", { ascending: true }).limit(2000),
    admin.from("survey_template_versions")
      .select("id,survey_type,version_number,definition,published_at")
      .eq("organization_id", profile.organization_id)
      .eq("version_origin", "published")
      .order("survey_type", { ascending: true })
      .order("version_number", { ascending: false }),
    admin.from("wrike_tasks").select("id,title,wrike_id").eq("organization_id", profile.organization_id).eq("is_deleted", false).order("title"),
    admin.from("application_user_principals").select("id,display_name,state").eq("organization_id", profile.organization_id).order("display_name"),
    admin.from("wrike_users").select("id,display_name,email").eq("organization_id", profile.organization_id).eq("is_unresolved", false).order("display_name"),
    admin.from("survey_historical_import_resolution_audit")
      .select("id,batch_id,row_id,action,previous_values,new_values,created_at")
      .eq("organization_id", profile.organization_id)
      .order("created_at", { ascending: false })
      .limit(5000),
  ]);
  const historicalTemplates = (publishedSurveyVersions ?? []).flatMap((version) => {
    const definition = surveyDefinitionSchema.safeParse(version.definition);
    return definition.success
      ? [{ id: version.id, ...canonicalCsvContract(definition.data, version.version_number, version.published_at) }]
      : [];
  }) as HistoricalTemplate[];

  return <AppShell isAdmin>
    <header className="page-header"><div><p className="eyebrow">ADMINISTRATIVE FUNCTIONS</p><h1>Data</h1><p>Manage synchronized Wrike data, historical survey imports, source folders, unresolved references, and run history.</p></div></header>
    {params.connected && <p className="notice" role="status">Wrike connected — ready to import.</p>}
    {params.error && <p className="notice error" role="alert">{params.error}</p>}
    <AdminPanel
      connection={connection}
      folderRuns={(folderRuns ?? []) as never}
      folders={[...SELECTED_WRIKE_FOLDERS]}
      unresolvedReferences={(unresolvedReferences ?? []) as never}
      verticalDiagnostics={({ quality: verticalDiagnostics.data ?? null, repair: repairDiagnostics.data ?? null }) as never}
      verticalDiagnosticsError={verticalDiagnostics.error?.message ?? repairDiagnostics.error?.message ?? null}
      repairRuns={(repairRuns ?? []) as never}
      importConflicts={(importConflicts.data ?? []) as unknown as ImportConflict[]}
      importConflictCount={importConflicts.count ?? 0}
      importConflictError={importConflicts.error?.message ?? null}
      historicalBatches={(historicalBatches ?? []) as HistoricalImportBatch[]}
      historicalRows={(historicalRows ?? []) as HistoricalImportRow[]}
      historicalIssues={(historicalIssues ?? []) as HistoricalImportIssue[]}
      historicalMappings={(historicalMappings ?? []) as HistoricalColumnMapping[]}
      historicalTemplates={historicalTemplates}
      historicalResolutionOptions={{
        projects: (historicalProjectOptions ?? []).map((item) => ({ id: item.id, label: item.title, detail: item.wrike_id })),
        principals: (historicalPrincipalOptions ?? []).map((item) => ({ id: item.id, label: item.display_name ?? "Unnamed retained principal", detail: item.state })),
        wrikeUsers: (historicalWrikeUserOptions ?? []).map((item) => ({ id: item.id, label: item.display_name, detail: item.email })),
      } satisfies HistoricalResolutionOptions}
      historicalResolutionAudit={(historicalResolutionAudit ?? []) as HistoricalResolutionAudit[]}
    />
  </AppShell>;
}
