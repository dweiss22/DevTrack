import { AppShell } from "@/components/app-shell";
import { AdminPanel } from "@/components/admin-panel";
import { requireAdmin } from "@/lib/auth";

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const { supabase, profile } = await requireAdmin(); const params = await searchParams;
  const [{ data: connection }, { data: scopes }, { data: runs }] = await Promise.all([supabase.from("wrike_connections").select("status,account_name,updated_at").eq("organization_id", profile.organization_id).maybeSingle(), supabase.from("wrike_sync_scopes").select("id,label,scope_type,source_ids,is_active").eq("organization_id", profile.organization_id).eq("is_active", true), supabase.from("wrike_sync_runs").select("id,status,started_at,record_counts,error_summary").eq("organization_id", profile.organization_id).order("started_at", { ascending: false }).limit(10)]);
  return <AppShell><header className="page-header"><div><p className="eyebrow">ADMINISTRATION</p><h1>Wrike data connection</h1><p>Choose the work area and maintain the data used in every report.</p></div></header>{params.connected && <p className="notice">Wrike was connected successfully.</p>}{params.error && <p className="notice error">{params.error}</p>}<AdminPanel connection={connection} scopes={scopes ?? []} runs={(runs ?? []) as never} /></AppShell>;
}
