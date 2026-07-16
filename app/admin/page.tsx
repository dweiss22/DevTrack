import { AppShell } from "@/components/app-shell";
import { AdminPanel } from "@/components/admin-panel";
import { requireAdmin } from "@/lib/auth";

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const { supabase, profile } = await requireAdmin(); const params = await searchParams;
  const [{ data: connection }, { data: scopes }, { data: runs }, { data: groups }, { data: appUsers }, { data: wrikeUsers }, { data: fields }, { data: enabledFields }, { data: settings }, { data: audit }] = await Promise.all([
    supabase.from("wrike_connections").select("status,account_name,api_host,token_expires_at,updated_at").eq("organization_id", profile.organization_id).maybeSingle(),
    supabase.from("wrike_sync_scopes").select("id,label,scope_type,source_ids,is_active").eq("organization_id", profile.organization_id).eq("is_active", true),
    supabase.from("wrike_sync_runs").select("id,status,sync_mode,started_at,record_counts,error_summary").eq("organization_id", profile.organization_id).order("started_at", { ascending: false }).limit(10),
    supabase.from("reporting_groups").select("id,name,description,match_mode,reporting_group_members(application_user_id),reporting_group_scopes(scope_id),reporting_group_wrike_users(wrike_user_id)").eq("organization_id", profile.organization_id).order("name"),
    supabase.from("application_users").select("id,display_name").eq("organization_id", profile.organization_id).order("display_name"),
    supabase.from("wrike_users").select("id,display_name").eq("organization_id", profile.organization_id).eq("is_active", true).order("display_name"),
    supabase.from("wrike_custom_fields").select("id,title,field_type").eq("organization_id", profile.organization_id).order("title"),
    supabase.from("wrike_enabled_custom_fields").select("custom_field_id").eq("organization_id", profile.organization_id),
    supabase.from("organizations").select("timezone,reporting_access_enforced,ask_enabled,wrike_import_space_id").eq("id", profile.organization_id).single(),
    supabase.from("reporting_messages").select("id,content,created_at,user_id").eq("organization_id", profile.organization_id).eq("role", "user").order("created_at", { ascending: false }).limit(100)
  ]);
  const enabled = new Set((enabledFields ?? []).map((row) => row.custom_field_id));
  return <AppShell><header className="page-header"><div><p className="eyebrow">ADMINISTRATION</p><h1>Wrike data connection</h1><p>Import a configured Wrike Space, then control reporting access and auditing.</p></div></header>{params.connected && <p className="notice">Wrike was connected successfully. Run the Space import below to load reporting data.</p>}{params.error && <p className="notice error">{params.error}</p>}<AdminPanel connection={connection} scopes={scopes ?? []} runs={(runs ?? []) as never} groups={(groups ?? []) as never} appUsers={(appUsers ?? []).map((item) => ({ id: item.id, name: item.display_name ?? item.id }))} wrikeUsers={(wrikeUsers ?? []).map((item) => ({ id: item.id, name: item.display_name }))} customFields={(fields ?? []).map((field) => ({ ...field, enabled: enabled.has(field.id) }))} settings={settings ?? { timezone: "America/Chicago", reporting_access_enforced: false, ask_enabled: false, wrike_import_space_id: "IEACHQK7I46YBWEN" }} audit={audit ?? []} /></AppShell>;
}
