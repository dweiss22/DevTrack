import { AppShell } from "@/components/app-shell";
import { AdminPanel } from "@/components/admin-panel";
import type { ImportConflict } from "@/components/import-conflict-review";
import { requirePageCapability } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { SELECTED_WRIKE_FOLDERS } from "@/lib/wrike/selected-folders";

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const { supabase, profile } = await requirePageCapability("manage_data");
  const admin = createAdminClient();
  const params = await searchParams;
  const [{ data: connection }, { data: folderRuns }, { data: unresolvedReferences }, verticalDiagnostics, { data: repairRuns }, importConflicts] = await Promise.all([
    admin.from("wrike_connections").select("status,account_name,api_host,oauth_scopes,token_expires_at,updated_at").eq("organization_id", profile.organization_id).maybeSingle(),
    admin.from("wrike_folder_task_import_runs").select("id,status,folder_counts,timelog_folder_counts,task_count,unique_timelog_count,task_request_count,timelog_request_count,failed_folder_request_count,folder_failures,duration_ms,folder_definition_count,custom_field_definition_count,metadata_diagnostics,timelog_descendant_strategy,timelog_descendant_diagnostics,reference_data_diagnostics,reference_warning_count,custom_field_conflict_count,custom_field_normalization_diagnostics,task_custom_field_diagnostics,unresolved_reference_count,reference_resolution_diagnostics,error_summary,created_at").eq("organization_id", profile.organization_id).order("created_at", { ascending: false }).limit(10),
    admin.from("wrike_unresolved_references").select("id,reference_type,wrike_id,sample_values,related_records,occurrence_count,resolution_attempts,first_encountered_at,last_encountered_at,last_attempted_at,last_error,resolution_status").eq("organization_id", profile.organization_id).eq("resolution_status", "unresolved").order("last_encountered_at", { ascending: false }),
    supabase.rpc("reporting_vertical_data_quality"),
    admin.from("wrike_vertical_repair_runs").select("id,status,examined_count,repaired_count,unchanged_count,retained_count,still_incomplete_count,started_at,completed_at,error_summary").eq("organization_id", profile.organization_id).order("started_at", { ascending: false }).limit(10),
    admin.from("wrike_task_normalized_custom_field_values")
      .select("task_id,normalized_field_id,display_values,source_wrike_field_ids,source_titles,source_values,conflict_metadata,synced_at,task:wrike_tasks!inner(id,wrike_id,title,status,permalink,updated_at_wrike),normalized_field:wrike_normalized_custom_fields!inner(id,normalized_key,title)", { count: "exact" })
      .eq("has_conflict", true)
      .eq("task.organization_id", profile.organization_id)
      .eq("normalized_field.organization_id", profile.organization_id)
      .order("synced_at", { ascending: false })
      .limit(200)
  ]);
  return <AppShell isAdmin><header className="page-header"><div><p className="eyebrow">ADMINISTRATIVE FUNCTIONS</p><h1>Data</h1><p>Manage synchronized Wrike data, source folders, unresolved references, and run history.</p></div></header>{params.connected && <p className="notice" role="status">Wrike connected — ready to import.</p>}{params.error && <p className="notice error" role="alert">{params.error}</p>}<AdminPanel connection={connection} folderRuns={(folderRuns ?? []) as never} folders={[...SELECTED_WRIKE_FOLDERS]} unresolvedReferences={(unresolvedReferences ?? []) as never} verticalDiagnostics={(verticalDiagnostics.data ?? null) as never} verticalDiagnosticsError={verticalDiagnostics.error?.message ?? null} repairRuns={(repairRuns ?? []) as never} importConflicts={(importConflicts.data ?? []) as unknown as ImportConflict[]} importConflictCount={importConflicts.count ?? 0} importConflictError={importConflicts.error?.message ?? null} /></AppShell>;
}
