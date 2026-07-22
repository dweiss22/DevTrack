import type { SupabaseClient } from "@supabase/supabase-js";

export type CustomFieldFilterOption = { id: string; name: string; values: string[] };
export type StatusFilterOption = { id: string; name: string; color: string | null; resolved: boolean };
export type CustomFieldOptionsResult = { data: CustomFieldFilterOption[]; error: null } | { data: []; error: { code: string | null; message: string } };
export type AccessibleProjectFacets = { customStatusIds: Set<string>; baseStatuses: Set<string>; verticalStates: Set<string> };

export async function loadStatusOptions(supabase: SupabaseClient, organizationId?: string): Promise<StatusFilterOption[]> {
  let query = supabase.from("wrike_workflow_statuses").select("wrike_id,title,color,is_unresolved").order("title");
  if (organizationId) query = query.eq("organization_id", organizationId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => ({ id: row.wrike_id, name: row.is_unresolved ? `Unresolved Wrike status ${row.wrike_id}` : row.title, color: row.color ?? null, resolved: !row.is_unresolved }));
}

export async function loadCustomFieldOptions(supabase: SupabaseClient): Promise<CustomFieldFilterOption[]> {
  const started = Date.now();
  const { data, error } = await supabase.rpc("reporting_custom_field_options");
  const elapsedMs = Date.now() - started;
  if (error) {
    console.error("reporting_custom_field_options_failed", { elapsedMs, code: error.code });
    throw error;
  }
  console.info("reporting_custom_field_options_completed", { elapsedMs });
  const grouped = new Map<string, CustomFieldFilterOption>();
  for (const row of (data ?? []) as { normalized_field_id: string; normalized_title: string; value: string | null }[]) {
    const existing = grouped.get(row.normalized_field_id);
    if (existing) {
      if (row.value && !existing.values.includes(row.value)) existing.values.push(row.value);
    } else grouped.set(row.normalized_field_id, { id: row.normalized_field_id, name: row.normalized_title, values: row.value ? [row.value] : [] });
  }
  return [...grouped.values()].sort((left, right) => left.name.localeCompare(right.name)).map((field) => ({ ...field, values: field.values.sort((left, right) => left.localeCompare(right)) }));
}

export async function loadCustomFieldOptionsResult(supabase: SupabaseClient): Promise<CustomFieldOptionsResult> {
  try {
    return { data: await loadCustomFieldOptions(supabase), error: null };
  } catch (error) {
    const candidate = error && typeof error === "object" ? error as { code?: string | null; message?: string } : {};
    return { data: [], error: { code: candidate.code ?? null, message: candidate.message ?? "Custom-field filter options could not be loaded." } };
  }
}

export async function loadAccessibleProjectFacets(supabase: SupabaseClient): Promise<AccessibleProjectFacets> {
  const facets: AccessibleProjectFacets = { customStatusIds: new Set(), baseStatuses: new Set(), verticalStates: new Set() };
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from("wrike_tasks")
      .select("custom_status_id,status,vertical_state")
      .eq("is_deleted", false)
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    for (const row of data ?? []) {
      if (row.custom_status_id) facets.customStatusIds.add(row.custom_status_id);
      else if (row.status) facets.baseStatuses.add(row.status);
      if (row.vertical_state) facets.verticalStates.add(row.vertical_state);
    }
    if ((data ?? []).length < pageSize) break;
  }
  return facets;
}

export async function loadReportingOptions(supabase: SupabaseClient, organizationId: string) {
  const [users, scopes, statuses, categories, folders, projects, customFields] = await Promise.all([
    supabase.from("wrike_users").select("id,wrike_id,display_name,is_unresolved").eq("organization_id", organizationId).eq("is_active", true).order("display_name"),
    supabase.from("wrike_sync_scopes").select("id,label").eq("organization_id", organizationId).eq("is_active", true).order("label"),
    loadStatusOptions(supabase, organizationId),
    supabase.from("wrike_timelog_categories").select("wrike_id,title,is_unresolved").eq("organization_id", organizationId).order("title"),
    supabase.from("wrike_folders").select("id,wrike_id,title,is_unresolved").eq("organization_id", organizationId).is("deleted_at", null).order("title"),
    supabase.from("wrike_projects").select("id,title").eq("organization_id", organizationId).is("deleted_at", null).order("title"),
    loadCustomFieldOptions(supabase)
  ]);
  return {
    users: (users.data ?? []).map((row) => ({ id: row.id, name: row.is_unresolved ? row.wrike_id : row.display_name, wrikeId: row.wrike_id, resolved: !row.is_unresolved })),
    scopes: (scopes.data ?? []).map((row) => ({ id: row.id, name: row.label })),
    statuses,
    categories: (categories.data ?? []).map((row) => ({ id: row.wrike_id, name: row.is_unresolved ? `Unresolved Wrike category ${row.wrike_id}` : row.title })),
    folders: (folders.data ?? []).map((row) => ({ id: row.id, name: row.is_unresolved ? `Unresolved Wrike folder ${row.wrike_id}` : row.title })),
    projects: (projects.data ?? []).map((row) => ({ id: row.id, name: row.title })),
    customFields
  };
}
