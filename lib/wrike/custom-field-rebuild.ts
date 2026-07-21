import type { createAdminClient } from "@/lib/supabase/admin";
import { mergeNormalizedCustomFields } from "@/lib/wrike/custom-field-normalization";
import {
  loadCustomFieldManualMappings,
  persistNormalizedCustomFieldDefinitions,
  persistNormalizedTaskCustomFields
} from "@/lib/wrike/custom-field-persistence";
import { resolveCustomFieldDisplayValue, type ResolvedCustomField } from "@/lib/wrike/metadata";
import type { WrikeCustomFieldDefinition, WrikeTask } from "@/lib/wrike/types";
import { classifyVerticalState } from "@/lib/wrike/task-custom-fields";

type AdminClient = ReturnType<typeof createAdminClient>;

export async function rebuildNormalizedCustomFieldsFromRaw(db: AdminClient, organizationId: string, affectedWrikeFieldId?: string) {
  const rebuiltAt = new Date().toISOString();
  const [{ data: fields, error: fieldError }, { data: tasks, error: taskError }] = await Promise.all([
    db.from("wrike_custom_fields").select("id,wrike_id,title,field_type,raw_data,is_unresolved").eq("organization_id", organizationId),
    db.from("wrike_tasks").select("id,wrike_id,raw_data,enriched_metadata").eq("organization_id", organizationId).eq("is_deleted", false)
  ]);
  if (fieldError) throw new Error(`Supabase could not load custom fields for reprocessing: ${fieldError.message}`);
  if (taskError) throw new Error(`Supabase could not load tasks for custom-field reprocessing: ${taskError.message}`);
  const mappings = await loadCustomFieldManualMappings(db, organizationId);
  const definitions = new Map<string, WrikeCustomFieldDefinition>();
  for (const field of fields ?? []) {
    if (!field.is_unresolved && field.raw_data && typeof field.raw_data === "object" && typeof (field.raw_data as { id?: unknown }).id === "string") {
      definitions.set(field.wrike_id, field.raw_data as WrikeCustomFieldDefinition);
    }
  }
  const selectedTasks = (tasks ?? []).filter((task) => {
    const raw = task.raw_data as WrikeTask | null;
    if (!raw || !Array.isArray(raw.customFields)) return false;
    if (!affectedWrikeFieldId) return true;
    return raw.customFields.some((field) => field.id === affectedWrikeFieldId);
  });
  const normalizedSources = (fields ?? []).filter((field) => !field.is_unresolved || mappings.has(field.wrike_id));
  const logicalIdByKey = await persistNormalizedCustomFieldDefinitions(db, organizationId, normalizedSources, rebuiltAt);
  const taskFields = selectedTasks.map((task) => {
    const raw = task.raw_data as WrikeTask;
    const resolvedFields: ResolvedCustomField[] = (raw.customFields ?? []).map((field) => {
      const definition = definitions.get(field.id);
      const mapping = mappings.get(field.id);
      return {
        id: field.id,
        title: definition?.title ?? field.id,
        type: definition?.type ?? null,
        rawValue: field.value,
        displayValue: resolveCustomFieldDisplayValue(field.value, definition),
        resolved: Boolean(definition) || Boolean(mapping && mapping.action !== "ignore"),
        ignored: mapping?.action === "ignore",
        normalizedTitleOverride: mapping?.normalizedTitle ?? null,
        resolutionSource: mapping ? "manual_mapping" : definition ? "database" : "unresolved"
      };
    });
    return { taskId: task.id, taskWrikeId: task.wrike_id, fields: resolvedFields, normalized: mergeNormalizedCustomFields(resolvedFields), enriched: task.enriched_metadata };
  });
  const result = await persistNormalizedTaskCustomFields(db, logicalIdByKey, taskFields.map((task) => ({ taskId: task.taskId, taskWrikeId: task.taskWrikeId, fields: task.normalized })), rebuiltAt);
  for (const task of taskFields) {
    const enriched = task.enriched && typeof task.enriched === "object" ? task.enriched as Record<string, unknown> : {};
    const vertical = task.normalized.find((field) => field.normalizedKey === "vertical")?.verticalNormalization;
    const unresolvedVerticalDefinition = task.fields.some((field) => !field.resolved && field.title.trim().toLocaleLowerCase().includes("vertical"));
    const { error } = await db.from("wrike_tasks").update({
      enriched_metadata: { ...enriched, customFields: task.fields, customFieldsNormalized: task.normalized },
      vertical_state: classifyVerticalState({ customFieldsSyncState: "complete", vertical, unresolvedCustomFieldDefinitions: unresolvedVerticalDefinition }),
      updated_at: rebuiltAt
    }).eq("id", task.taskId).eq("organization_id", organizationId);
    if (error) throw new Error(`Supabase could not update reprocessed task ${task.taskWrikeId}: ${error.message}`);
  }
  return { affectedTaskCount: taskFields.length, normalizedValueCount: result.valueCount, conflictCount: result.conflictCount, rebuiltAt };
}
