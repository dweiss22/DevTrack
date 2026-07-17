import type { SupabaseClient } from "@supabase/supabase-js";

export type CustomFieldFilterOption = { id: string; name: string; values: string[] };

export async function loadCustomFieldOptions(supabase: SupabaseClient): Promise<CustomFieldFilterOption[]> {
  const { data, error } = await supabase.rpc("reporting_custom_field_options");
  if (error) throw error;
  const grouped = new Map<string, CustomFieldFilterOption>();
  for (const row of (data ?? []) as { normalized_field_id: string; normalized_title: string; value: string }[]) {
    const existing = grouped.get(row.normalized_field_id);
    if (existing) {
      if (!existing.values.includes(row.value)) existing.values.push(row.value);
    } else grouped.set(row.normalized_field_id, { id: row.normalized_field_id, name: row.normalized_title, values: [row.value] });
  }
  return [...grouped.values()].sort((left, right) => left.name.localeCompare(right.name)).map((field) => ({ ...field, values: field.values.sort((left, right) => left.localeCompare(right)) }));
}

export async function loadReportingOptions(supabase: SupabaseClient, organizationId: string) {
  const [users, scopes, statuses, categories, folders, projects, customFields] = await Promise.all([
    supabase.from("wrike_users").select("id,display_name").eq("organization_id", organizationId).eq("is_active", true).order("display_name"),
    supabase.from("wrike_sync_scopes").select("id,label").eq("organization_id", organizationId).eq("is_active", true).order("label"),
    supabase.from("wrike_workflow_statuses").select("title").eq("organization_id", organizationId).order("title"),
    supabase.from("wrike_timelog_categories").select("wrike_id,title").eq("organization_id", organizationId).order("title"),
    supabase.from("wrike_folders").select("id,title").eq("organization_id", organizationId).is("deleted_at", null).order("title"),
    supabase.from("wrike_projects").select("id,title").eq("organization_id", organizationId).is("deleted_at", null).order("title"),
    loadCustomFieldOptions(supabase)
  ]);
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
