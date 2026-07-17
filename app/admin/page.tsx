import { AppShell } from "@/components/app-shell";
import { AdminPanel } from "@/components/admin-panel";
import { requireAdmin } from "@/lib/auth";
import { TASK_IMPORT_FOLDER_IDS } from "@/lib/wrike/folder-task-import";

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const { supabase, profile } = await requireAdmin(); const params = await searchParams;
  const [{ data: connection }, { data: folderRuns }, { data: configuredFolderRows }] = await Promise.all([
    supabase.from("wrike_connections").select("status,account_name,api_host,token_expires_at,updated_at").eq("organization_id", profile.organization_id).maybeSingle(),
    supabase.from("wrike_folder_task_import_runs").select("id,status,folder_counts,task_count,folder_definition_count,custom_field_definition_count,metadata_diagnostics,error_summary,created_at").eq("organization_id", profile.organization_id).order("created_at", { ascending: false }).limit(10),
    supabase.from("wrike_folders").select("wrike_id,title").eq("organization_id", profile.organization_id).in("wrike_id", [...TASK_IMPORT_FOLDER_IDS])
  ]);
  const folderTitles = new Map((configuredFolderRows ?? []).map((folder) => [folder.wrike_id, folder.title]));
  const configuredFolders = TASK_IMPORT_FOLDER_IDS.map((id) => ({ id, title: folderTitles.get(id) ?? null }));
  return <AppShell><header className="page-header"><div><p className="eyebrow">ADMINISTRATION</p><h1>Wrike task and metadata import</h1><p>One button validates the folder tree, LCT custom fields, and the configured task endpoints before replacing reporting data.</p></div></header>{params.connected && <p className="notice">Wrike connected successfully. The import has not run until you select the button below.</p>}{params.error && <p className="notice error">{params.error}</p>}<AdminPanel connection={connection} folderRuns={(folderRuns ?? []) as never} folders={configuredFolders} /></AppShell>;
}
