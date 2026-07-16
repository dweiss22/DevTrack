import { AppShell } from "@/components/app-shell";
import { AdminPanel } from "@/components/admin-panel";
import { requireAdmin } from "@/lib/auth";
import { TASK_IMPORT_FOLDER_IDS } from "@/lib/wrike/folder-task-import";

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const { supabase, profile } = await requireAdmin(); const params = await searchParams;
  const [{ data: connection }, { data: folderRuns }] = await Promise.all([
    supabase.from("wrike_connections").select("status,account_name,api_host,token_expires_at,updated_at").eq("organization_id", profile.organization_id).maybeSingle(),
    supabase.from("wrike_folder_task_import_runs").select("id,status,folder_counts,task_count,error_summary,created_at").eq("organization_id", profile.organization_id).order("created_at", { ascending: false }).limit(10)
  ]);
  return <AppShell><header className="page-header"><div><p className="eyebrow">ADMINISTRATION</p><h1>Wrike folder task import</h1><p>Validate task ingestion first. Additional Wrike APIs will be added only after this data is confirmed.</p></div></header>{params.connected && <p className="notice">Wrike connected successfully. The task import has not run until you select the button below.</p>}{params.error && <p className="notice error">{params.error}</p>}<AdminPanel connection={connection} folderRuns={(folderRuns ?? []) as never} folderIds={TASK_IMPORT_FOLDER_IDS} /></AppShell>;
}
