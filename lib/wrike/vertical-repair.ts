import { createAdminClient } from "@/lib/supabase/admin";
import { WrikeClient } from "@/lib/wrike/client";
import { mergeNormalizedCustomFields } from "@/lib/wrike/custom-field-normalization";
import { loadCustomFieldManualMappings, persistNormalizedCustomFieldDefinitions, persistNormalizedTaskCustomFields } from "@/lib/wrike/custom-field-persistence";
import { resolveCustomFieldDisplayValue, type ResolvedCustomField } from "@/lib/wrike/metadata";
import { refreshWrikeSessionFor, wrikeSessionFor } from "@/lib/wrike/oauth";
import { classifyVerticalState, taskDetailsPath } from "@/lib/wrike/task-custom-fields";
import type { WrikeCustomFieldDefinition, WrikeTask } from "@/lib/wrike/types";
import type { VerticalState } from "@/lib/wrike/vertical-normalization";

type TaskRow = {
  id: string; wrike_id: string; title: string; raw_data: WrikeTask | null; enriched_metadata: Record<string, unknown> | null;
  custom_fields_sync_state: "complete" | "incomplete" | "unknown"; vertical_state: VerticalState | null;
};

export type VerticalRepairResult = {
  examined: number; repaired: number; unchanged: number; retained: number; stillIncomplete: number; hydrated: number; locallyReprocessed: number; hydrationRequests: number;
};

export async function repairVerticalData(organizationId: string): Promise<VerticalRepairResult> {
  const db = createAdminClient();
  const leaseToken = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const { data: claimed, error: leaseError } = await db.rpc("claim_wrike_sync_lease", { target_organization_id: organizationId, target_token: leaseToken, lease_minutes: 30 });
  if (leaseError || !claimed) throw new Error("A Wrike import or data repair is already running for this organization.");

  const { data: run, error: runError } = await db.from("wrike_vertical_repair_runs").insert({ organization_id: organizationId, status: "running", started_at: startedAt }).select("id").single();
  if (runError) {
    await db.rpc("release_wrike_sync_lease", { target_organization_id: organizationId, target_token: leaseToken });
    throw new Error(`Supabase could not start the Vertical repair: ${runError.message}`);
  }

  try {
    const [{ data: taskData, error: taskError }, { data: fieldData, error: fieldError }] = await Promise.all([
      db.from("wrike_tasks").select("id,wrike_id,title,raw_data,enriched_metadata,custom_fields_sync_state,vertical_state").eq("organization_id", organizationId).eq("is_deleted", false),
      db.from("wrike_custom_fields").select("id,wrike_id,title,field_type,raw_data,is_unresolved").eq("organization_id", organizationId)
    ]);
    if (taskError) throw new Error(`Supabase could not load tasks for repair: ${taskError.message}`);
    if (fieldError) throw new Error(`Supabase could not load custom-field definitions for repair: ${fieldError.message}`);
    const tasks = (taskData ?? []) as TaskRow[];
    const fields = fieldData ?? [];
    const mappings = await loadCustomFieldManualMappings(db, organizationId);
    const definitions = new Map<string, WrikeCustomFieldDefinition>();
    for (const field of fields) if (!field.is_unresolved && field.raw_data && typeof field.raw_data === "object") definitions.set(field.wrike_id, field.raw_data as WrikeCustomFieldDefinition);
    const logicalIds = await persistNormalizedCustomFieldDefinitions(db, organizationId, fields.filter((field) => !field.is_unresolved || mappings.has(field.wrike_id)), startedAt);

    const completeTasks = tasks.filter((task) => task.custom_fields_sync_state === "complete" && Array.isArray(task.raw_data?.customFields));
    const completeResolved = completeTasks.map((task) => resolveTask(task, task.raw_data!, definitions, mappings));
    await persistNormalizedTaskCustomFields(db, logicalIds, completeResolved.map((task) => ({ taskId: task.row.id, taskWrikeId: task.row.wrike_id, fields: task.normalized })), startedAt);

    let repaired = 0;
    let unchanged = 0;
    for (const task of completeResolved) {
      if (task.state === task.row.vertical_state) unchanged++; else repaired++;
      await updateResolvedTask(db, organizationId, task, { vertical_state: task.state });
    }

    const incompleteTasks = tasks.filter((task) => task.custom_fields_sync_state !== "complete" || !Array.isArray(task.raw_data?.customFields));
    const hydratedById = new Map<string, WrikeTask>();
    if (incompleteTasks.length) {
      const session = await wrikeSessionFor(organizationId);
      const client = new WrikeClient(session.accessToken, session.apiBaseUrl, { onUnauthorized: async () => {
        const refreshed = await refreshWrikeSessionFor(organizationId);
        return { accessToken: refreshed.accessToken, apiBaseUrl: refreshed.apiBaseUrl };
      } });
      for (let offset = 0; offset < incompleteTasks.length; offset += 100) {
        const batch = incompleteTasks.slice(offset, offset + 100);
        try {
          const response = await client.request<{ data: WrikeTask[] }>(taskDetailsPath(batch.map((task) => task.wrike_id)));
          for (const task of response.data ?? []) if (Array.isArray(task.customFields)) hydratedById.set(task.id, task);
        } catch {
          // Per-task repair hydration is nonfatal. Existing values remain available and visibly incomplete.
        }
      }
    }

    const hydratedResolved = incompleteTasks.flatMap((row) => {
      const detail = hydratedById.get(row.wrike_id);
      if (!detail || !Array.isArray(detail.customFields)) return [];
      const raw = { ...(row.raw_data ?? {}), ...detail, customFields: detail.customFields } as WrikeTask;
      return [resolveTask(row, raw, definitions, mappings)];
    });
    if (hydratedResolved.length) {
      await persistNormalizedTaskCustomFields(db, logicalIds, hydratedResolved.map((task) => ({ taskId: task.row.id, taskWrikeId: task.row.wrike_id, fields: task.normalized })), startedAt);
      const hydratedIds = hydratedResolved.map((task) => task.row.id);
      for (let offset = 0; offset < hydratedIds.length; offset += 250) {
        const { error } = await db.from("wrike_task_custom_field_values").delete().in("task_id", hydratedIds.slice(offset, offset + 250));
        if (error) throw new Error(`Supabase could not reconcile repaired readable values: ${error.message}`);
      }
      const fieldIdByWrikeId = new Map(fields.map((field) => [field.wrike_id, field.id]));
      const values = hydratedResolved.flatMap((task) => task.fields.flatMap((field) => {
        const customFieldId = fieldIdByWrikeId.get(field.id);
        if (!customFieldId || field.rawValue == null) return [];
        return [{ task_id: task.row.id, custom_field_id: customFieldId, value: field.rawValue, display_value: field.displayValue, text_value: displayText(field.displayValue), option_ids: [], option_values: optionValues(field), resolved: field.resolved, updated_at: startedAt }];
      }));
      for (let offset = 0; offset < values.length; offset += 500) {
        const { error } = await db.from("wrike_task_custom_field_values").upsert(values.slice(offset, offset + 500), { onConflict: "task_id,custom_field_id" });
        if (error) throw new Error(`Supabase could not save repaired readable values: ${error.message}`);
      }
      for (const task of hydratedResolved) await updateResolvedTask(db, organizationId, task, {
        raw_data: task.raw,
        custom_fields_sync_state: "complete",
        custom_fields_verified_at: startedAt,
        custom_fields_sync_diagnostics: { repairRunId: run.id, authoritative: true, selectedSource: "task_detail", repairedAt: startedAt },
        vertical_state: task.state
      });
      repaired += hydratedResolved.length;
    }

    const stillIncomplete = incompleteTasks.length - hydratedResolved.length;
    const retained = incompleteTasks.filter((task) => !hydratedById.has(task.wrike_id) && Array.isArray(task.raw_data?.customFields)).length;
    const result: VerticalRepairResult = {
      examined: tasks.length,
      repaired,
      unchanged,
      retained,
      stillIncomplete,
      hydrated: hydratedResolved.length,
      locallyReprocessed: completeResolved.length,
      hydrationRequests: Math.ceil(incompleteTasks.length / 100)
    };
    const { error: completionError } = await db.from("wrike_vertical_repair_runs").update({ status: "succeeded", completed_at: new Date().toISOString(), ...snakeCounts(result), diagnostics: { repairMode: "explicit_admin", detailBatchSize: 100, locallyReprocessed: result.locallyReprocessed, hydrated: result.hydrated } }).eq("id", run.id);
    if (completionError) throw new Error(`Supabase could not persist the Vertical repair result: ${completionError.message}`);
    return result;
  } catch (error) {
    await db.from("wrike_vertical_repair_runs").update({ status: "failed", completed_at: new Date().toISOString(), error_summary: error instanceof Error ? error.message.slice(0, 1000) : "Vertical repair failed." }).eq("id", run.id);
    throw error;
  } finally {
    await db.rpc("release_wrike_sync_lease", { target_organization_id: organizationId, target_token: leaseToken });
  }
}

function resolveTask(row: TaskRow, raw: WrikeTask, definitions: Map<string, WrikeCustomFieldDefinition>, mappings: Awaited<ReturnType<typeof loadCustomFieldManualMappings>>) {
  const fields: ResolvedCustomField[] = (raw.customFields ?? []).map((field) => {
    const definition = definitions.get(field.id);
    const mapping = mappings.get(field.id);
    return { id: field.id, title: definition?.title ?? field.id, type: definition?.type ?? null, rawValue: field.value, displayValue: resolveCustomFieldDisplayValue(field.value, definition), resolved: Boolean(definition) || Boolean(mapping && mapping.action !== "ignore"), ignored: mapping?.action === "ignore", normalizedTitleOverride: mapping?.normalizedTitle ?? null, resolutionSource: mapping ? "manual_mapping" : definition ? "database" : "unresolved" };
  });
  const normalized = mergeNormalizedCustomFields(fields);
  const vertical = normalized.find((field) => field.normalizedKey === "vertical")?.verticalNormalization;
  const unresolvedDefinition = fields.some((field) => !field.resolved && !field.ignored);
  const state = classifyVerticalState({ customFieldsSyncState: "complete", vertical, unresolvedCustomFieldDefinitions: unresolvedDefinition });
  return { row, raw, fields, normalized, state };
}

async function updateResolvedTask(db: ReturnType<typeof createAdminClient>, organizationId: string, task: ReturnType<typeof resolveTask>, updates: Record<string, unknown>) {
  const enriched = task.row.enriched_metadata && typeof task.row.enriched_metadata === "object" ? task.row.enriched_metadata : {};
  const { error } = await db.from("wrike_tasks").update({ ...updates, enriched_metadata: { ...enriched, customFields: task.fields, customFieldsNormalized: task.normalized }, updated_at: new Date().toISOString() }).eq("id", task.row.id).eq("organization_id", organizationId);
  if (error) throw new Error(`Supabase could not update repaired task ${task.row.wrike_id}: ${error.message}`);
}

function displayText(value: unknown) { return Array.isArray(value) ? value.map(String).join(", ") : value == null ? null : String(value); }
function optionValues(field: ResolvedCustomField) { return Array.isArray(field.displayValue) ? field.displayValue.map(String) : field.displayValue == null ? [] : [String(field.displayValue)]; }
function snakeCounts(result: VerticalRepairResult) { return { examined_count: result.examined, repaired_count: result.repaired, unchanged_count: result.unchanged, retained_count: result.retained, still_incomplete_count: result.stillIncomplete, hydration_request_count: result.hydrationRequests }; }
