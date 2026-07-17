import type { createAdminClient } from "@/lib/supabase/admin";
import { logWrikeEvent } from "@/lib/wrike/client";
import { normalizeWrikeCustomFieldTitle, type NormalizedCustomFieldValue } from "@/lib/wrike/custom-field-normalization";

type AdminClient = ReturnType<typeof createAdminClient>;
type SavedCustomField = { id: string; wrike_id: string; title: string };
type TaskNormalizedFields = { taskId: string; taskWrikeId: string; fields: NormalizedCustomFieldValue[] };

export type CustomFieldManualMapping = {
  id: string;
  wrikeId: string;
  action: "map_existing" | "create_new" | "ignore";
  normalizedFieldId: string | null;
  normalizedKey: string | null;
  normalizedTitle: string | null;
};

export async function loadCustomFieldManualMappings(db: AdminClient, organizationId: string) {
  const { data: mappings, error } = await db.from("wrike_manual_mappings")
    .select("id,wrike_id,action,target_normalized_field_id")
    .eq("organization_id", organizationId)
    .eq("reference_type", "custom_field");
  if (error) throw new Error(`Supabase could not load custom-field mappings: ${error.message}`);
  const targetIds = [...new Set((mappings ?? []).flatMap((mapping) => mapping.target_normalized_field_id ? [mapping.target_normalized_field_id] : []))];
  const { data: logicalFields, error: logicalError } = targetIds.length
    ? await db.from("wrike_normalized_custom_fields").select("id,normalized_key,title").eq("organization_id", organizationId).in("id", targetIds)
    : { data: [], error: null };
  if (logicalError) throw new Error(`Supabase could not load mapped logical fields: ${logicalError.message}`);
  const logicalById = new Map((logicalFields ?? []).map((field) => [field.id, field]));
  return new Map<string, CustomFieldManualMapping>((mappings ?? []).map((mapping) => {
    const logical = mapping.target_normalized_field_id ? logicalById.get(mapping.target_normalized_field_id) : null;
    return [mapping.wrike_id, {
      id: mapping.id,
      wrikeId: mapping.wrike_id,
      action: mapping.action,
      normalizedFieldId: mapping.target_normalized_field_id,
      normalizedKey: logical?.normalized_key ?? null,
      normalizedTitle: logical?.title ?? null
    }];
  }));
}

export async function persistNormalizedCustomFieldDefinitions(db: AdminClient, organizationId: string, fields: readonly SavedCustomField[], syncedAt: string) {
  const manualMappings = await loadCustomFieldManualMappings(db, organizationId);
  const automaticallyMappedFields = fields.filter((field) => !manualMappings.has(field.wrike_id));
  const byKey = new Map(automaticallyMappedFields.map((field) => {
    const normalized = normalizeWrikeCustomFieldTitle(field.title);
    return [normalized.normalizedKey, { normalized, field }] as const;
  }));
  const logicalRows = [...byKey.values()].map(({ normalized }) => ({
    organization_id: organizationId,
    normalized_key: normalized.normalizedKey,
    title: normalized.normalizedTitle,
    updated_at: syncedAt
  }));
  const { data: logicalFields, error: logicalError } = logicalRows.length
    ? await db.from("wrike_normalized_custom_fields").upsert(logicalRows, { onConflict: "organization_id,normalized_key" }).select("id,normalized_key")
    : { data: [], error: null };
  if (logicalError) throw new Error(`Supabase could not save normalized custom-field definitions: ${logicalError.message}`);
  const logicalIdByKey = new Map((logicalFields ?? []).map((field) => [field.normalized_key, field.id]));
  for (const mapping of manualMappings.values()) if (mapping.normalizedKey && mapping.normalizedFieldId) logicalIdByKey.set(mapping.normalizedKey, mapping.normalizedFieldId);
  const ignoredFieldIds = fields.filter((field) => manualMappings.get(field.wrike_id)?.action === "ignore").map((field) => field.id);
  if (ignoredFieldIds.length) {
    const { error } = await db.from("wrike_normalized_custom_field_sources").delete().in("custom_field_id", ignoredFieldIds);
    if (error) throw new Error(`Supabase could not remove ignored normalized custom-field sources: ${error.message}`);
  }
  const sourceRows = fields.flatMap((field) => {
    const normalized = normalizeWrikeCustomFieldTitle(field.title);
    const mapping = manualMappings.get(field.wrike_id);
    if (mapping?.action === "ignore") return [];
    const logicalId = mapping?.normalizedFieldId ?? logicalIdByKey.get(normalized.normalizedKey);
    return logicalId ? [{ normalized_field_id: logicalId, custom_field_id: field.id, source_designation: normalized.sourceDesignation, updated_at: syncedAt }] : [];
  });
  if (sourceRows.length) {
    const { error } = await db.from("wrike_normalized_custom_field_sources").upsert(sourceRows, { onConflict: "custom_field_id" });
    if (error) throw new Error(`Supabase could not save normalized custom-field source mappings: ${error.message}`);
  }
  return logicalIdByKey;
}

export async function persistNormalizedTaskCustomFields(
  db: AdminClient,
  logicalIdByKey: Map<string, string>,
  tasks: readonly TaskNormalizedFields[],
  syncedAt: string
) {
  const taskIds = [...new Set(tasks.map((task) => task.taskId))];
  for (let offset = 0; offset < taskIds.length; offset += 250) {
    const { error } = await db.from("wrike_task_normalized_custom_field_values").delete().in("task_id", taskIds.slice(offset, offset + 250));
    if (error) throw new Error(`Supabase could not reconcile normalized custom-field values: ${error.message}`);
  }
  const conflicts: { taskWrikeId: string; normalizedKey: string; normalizedTitle: string; sourceFieldIds: string[]; sourceTitles: string[]; displayValues: string[] }[] = [];
  const rows = tasks.flatMap((task) => task.fields.flatMap((field) => {
    const normalizedFieldId = logicalIdByKey.get(field.normalizedKey);
    if (!normalizedFieldId) return [];
    if (field.conflict) {
      const conflict = { taskWrikeId: task.taskWrikeId, normalizedKey: field.normalizedKey, normalizedTitle: field.normalizedTitle, sourceFieldIds: field.sourceFieldIds, sourceTitles: field.sourceTitles, displayValues: field.displayValues };
      conflicts.push(conflict);
      logWrikeEvent("warn", "wrike_custom_field_value_conflict", conflict);
    }
    return [{
      task_id: task.taskId,
      normalized_field_id: normalizedFieldId,
      display_values: field.displayValues,
      source_wrike_field_ids: field.sourceFieldIds,
      source_titles: field.sourceTitles,
      source_values: field.sources,
      has_conflict: field.conflict,
      conflict_metadata: field.conflictMetadata,
      synced_at: syncedAt,
      updated_at: syncedAt
    }];
  }));
  for (let offset = 0; offset < rows.length; offset += 500) {
    const { error } = await db.from("wrike_task_normalized_custom_field_values").upsert(rows.slice(offset, offset + 500), { onConflict: "task_id,normalized_field_id" });
    if (error) throw new Error(`Supabase could not save normalized custom-field values: ${error.message}`);
  }
  return { valueCount: rows.length, conflictCount: conflicts.length, conflicts };
}
