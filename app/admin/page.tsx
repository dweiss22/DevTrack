import { AppShell } from "@/components/app-shell";
import { AdminPanel } from "@/components/admin-panel";
import { requireAdmin } from "@/lib/auth";
import { SELECTED_WRIKE_FOLDERS } from "@/lib/wrike/selected-folders";

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const { supabase, profile } = await requireAdmin(); const params = await searchParams;
  const [{ data: connection }, { data: folderRuns }] = await Promise.all([
    supabase.from("wrike_connections").select("status,account_name,api_host,oauth_scopes,token_expires_at,updated_at").eq("organization_id", profile.organization_id).maybeSingle(),
    supabase.from("wrike_folder_task_import_runs").select("id,status,folder_counts,timelog_folder_counts,task_count,unique_timelog_count,task_request_count,timelog_request_count,failed_folder_request_count,folder_failures,duration_ms,folder_definition_count,custom_field_definition_count,metadata_diagnostics,timelog_descendant_strategy,timelog_descendant_diagnostics,reference_data_diagnostics,reference_warning_count,custom_field_conflict_count,custom_field_normalization_diagnostics,error_summary,created_at").eq("organization_id", profile.organization_id).order("created_at", { ascending: false }).limit(10)
  ]);
  return <AppShell><header className="page-header"><div><p className="eyebrow">ADMINISTRATION</p><h1>Wrike folder import</h1><p>One validation-gated run imports tasks and timelogs from the configured folders while preserving source-folder relationships.</p></div></header>{params.connected && <p className="notice">Wrike connected successfully. The import has not run until you select the button below.</p>}{params.error && <p className="notice error">{params.error}</p>}<AdminPanel connection={connection} folderRuns={(folderRuns ?? []) as never} folders={[...SELECTED_WRIKE_FOLDERS]} /></AppShell>;
}
