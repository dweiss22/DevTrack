import type { SupabaseClient } from "@supabase/supabase-js";

export async function loadReportingOptions(supabase: SupabaseClient, organizationId: string) {
  const [users, scopes, statuses, categories, folders, projects, enabledFields] = await Promise.all([
    supabase.from("wrike_users").select("id,display_name").eq("organization_id", organizationId).eq("is_active", true).order("display_name"),
    supabase.from("wrike_sync_scopes").select("id,label").eq("organization_id", organizationId).eq("is_active", true).order("label"),
    supabase.from("wrike_workflow_statuses").select("title").eq("organization_id", organizationId).order("title"),
    supabase.from("wrike_timelog_categories").select("wrike_id,title").eq("organization_id", organizationId).order("title"),
    supabase.from("wrike_folders").select("id,title").eq("organization_id", organizationId).is("deleted_at", null).order("title"),
    supabase.from("wrike_projects").select("id,title").eq("organization_id", organizationId).is("deleted_at", null).order("title"),
    supabase.from("wrike_enabled_custom_fields").select("wrike_custom_fields(id,title)").eq("organization_id", organizationId)
  ]);
  const customFields = (enabledFields.data ?? []).flatMap((row) => {
    const field = row.wrike_custom_fields as unknown as { id: string; title: string } | null;
    return field ? [{ id: field.id, name: field.title }] : [];
  });
  return {
    users: (users.data ?? []).map((row) => ({ id: row.id, name: row.display_name })),
    scopes: (scopes.data ?? []).map((row) => ({ id: row.id, name: row.label })),
    statuses: [...new Set((statuses.data ?? []).map((row) => row.title))],
    categories: (categories.data ?? []).map((row) => ({ id: row.wrike_id, name: row.title })),
    folders: (folders.data ?? []).map((row) => ({ id: row.id, name: row.title })),
    projects: (projects.data ?? []).map((row) => ({ id: row.id, name: row.title })),
    customFields
  };
}
