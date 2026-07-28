import { createAdminClient } from "@/lib/supabase/admin";
import { WrikeClient } from "@/lib/wrike/client";
import { mergeNormalizedCustomFields } from "@/lib/wrike/custom-field-normalization";
import { loadCustomFieldManualMappings, persistNormalizedCustomFieldDefinitions, persistNormalizedTaskCustomFields } from "@/lib/wrike/custom-field-persistence";
import { resolveCustomFieldDisplayValue, type ResolvedCustomField } from "@/lib/wrike/metadata";
import { refreshWrikeSessionFor, wrikeSessionFor } from "@/lib/wrike/oauth";
import { CUSTOM_FIELD_DETAIL_VERIFICATION_VERSION, classifyVerticalState, customFieldsFingerprint, isTaskCustomFieldsDetailVerified, taskDetailsPath } from "@/lib/wrike/task-custom-fields";
import type { WrikeCustomFieldDefinition, WrikeTask } from "@/lib/wrike/types";
import type { VerticalState } from "@/lib/wrike/vertical-normalization";

type TaskRow = {
  id: string; wrike_id: string; title: string; raw_data: WrikeTask | null; enriched_metadata: Record<string, unknown> | null;
  custom_fields_sync_state: "complete" | "incomplete" | "unknown"; custom_fields_sync_diagnostics: Record<string, unknown> | null; vertical_state: VerticalState | null;
};

export type VerticalRepairResult = {
  examined: number; repaired: number; unchanged: number; unresolved: number; conflicting: number; failed: number;
  retained: number; stillIncomplete: number; hydrated: number; locallyReprocessed: number; hydrationRequests: number;
};

type PersistedVerticalRow = {
  task_id: string;
  normalized_verticals: string[] | null;
  unresolved_vertical_tokens: string[] | null;
  has_conflict: boolean | null;
  vertical_reporting_category: string | null;
};

export function persistedVerticalState(row: PersistedVerticalRow | null, syncState: TaskRow["custom_fields_sync_state"] = "complete"): VerticalState {
  if (syncState !== "complete") return "synchronization_incomplete";
  if (row?.has_conflict || (row?.unresolved_vertical_tokens?.length ?? 0) > 0) return "unrecognized";
  if (row?.vertical_reporting_category === "Cross Vertical") return "cross_vertical";
  if ((row?.normalized_verticals?.length ?? 0) > 0) return "resolved";
  return "missing";
}

export function verticalPersistenceMatches(expectedState: VerticalState, expectedVerticals: readonly string[], row: PersistedVerticalRow | null) {
  const actual = row?.normalized_verticals ?? [];
  return persistedVerticalState(row) === expectedState
    && expectedVerticals.length === actual.length
    && expectedVerticals.every((value, index) => value === actual[index]);
}

export function verticalSnapshotChanged(previousState: VerticalState | null, previous: PersistedVerticalRow | null, nextState: VerticalState, next: PersistedVerticalRow | null) {
  return previousState !== nextState
    || JSON.stringify(previous?.normalized_verticals ?? []) !== JSON.stringify(next?.normalized_verticals ?? [])
    || JSON.stringify(previous?.unresolved_vertical_tokens ?? []) !== JSON.stringify(next?.unresolved_vertical_tokens ?? [])
    || Boolean(previous?.has_conflict) !== Boolean(next?.has_conflict);
}

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
    const [tasks, fields] = await Promise.all([
      loadAllRepairTasks(db, organizationId),
      loadAllRepairFields(db, organizationId)
    ]);
    const mappings = await loadCustomFieldManualMappings(db, organizationId);
    const definitions = new Map<string, WrikeCustomFieldDefinition>();
    for (const field of fields) if (!field.is_unresolved && field.raw_data && typeof field.raw_data === "object") definitions.set(field.wrike_id, field.raw_data as WrikeCustomFieldDefinition);
    const logicalIds = await persistNormalizedCustomFieldDefinitions(db, organizationId, fields.filter((field) => !field.is_unresolved || mappings.has(field.wrike_id)), startedAt);
    const verticalFieldId = logicalIds.get("vertical");
    const initialVerticals = await loadPersistedVerticals(db, tasks.map((task) => task.id), verticalFieldId);

    const completeTasks = tasks.filter((task) => task.custom_fields_sync_state === "complete"
      && task.raw_data
      && Array.isArray(task.raw_data.customFields)
      && isTaskCustomFieldsDetailVerified(task.raw_data, task.custom_fields_sync_diagnostics));
    const completeTaskIds = new Set(completeTasks.map((task) => task.id));
    const completeResolved = completeTasks.map((task) => resolveTask(task, task.raw_data!, definitions, mappings));
    await persistNormalizedTaskCustomFields(db, logicalIds, completeResolved.map((task) => ({ taskId: task.row.id, taskWrikeId: task.row.wrike_id, fields: task.normalized })), startedAt);

    const completeStats = await reconcileReadBack(db, organizationId, completeResolved, verticalFieldId, initialVerticals, startedAt);
    let { repaired, unchanged, unresolved, conflicting, failed } = completeStats;
    const failedProjects = [...completeStats.failedProjects];

    const incompleteTasks = tasks.filter((task) => !completeTaskIds.has(task.id));
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
        custom_fields_sync_diagnostics: {
          repairRunId: run.id,
          authoritative: true,
          selectedSource: "task_detail",
          repairedAt: startedAt,
          responseState: task.raw.customFields?.length ? "present" : "empty",
          detailVerificationVersion: CUSTOM_FIELD_DETAIL_VERIFICATION_VERSION,
          detailVerificationFingerprint: customFieldsFingerprint(task.raw),
          authoritativeFingerprint: customFieldsFingerprint(task.raw),
          customFieldCount: task.raw.customFields?.length ?? 0,
          customFieldIds: [...new Set((task.raw.customFields ?? []).map((field) => field.id))].sort()
        }
      });
      const hydratedStats = await reconcileReadBack(db, organizationId, hydratedResolved, verticalFieldId, initialVerticals, startedAt);
      repaired += hydratedStats.repaired;
      unchanged += hydratedStats.unchanged;
      unresolved += hydratedStats.unresolved;
      conflicting += hydratedStats.conflicting;
      failed += hydratedStats.failed;
      failedProjects.push(...hydratedStats.failedProjects);
    }

    const stillIncomplete = incompleteTasks.length - hydratedResolved.length;
    const retained = incompleteTasks.filter((task) => !hydratedById.has(task.wrike_id) && Array.isArray(task.raw_data?.customFields)).length;
    const unresolvedHydration = incompleteTasks.filter((task) => !hydratedById.has(task.wrike_id));
    for (const task of unresolvedHydration) {
      const { error } = await db.from("wrike_tasks").update({
        custom_fields_sync_state: "incomplete",
        vertical_state: "synchronization_incomplete",
        vertical_repaired_at: startedAt,
        custom_fields_sync_diagnostics: {
          ...(task.custom_fields_sync_diagnostics ?? {}),
          repairRunId: run.id,
          authoritative: false,
          selectedSource: Array.isArray(task.raw_data?.customFields) ? "prior" : "incomplete",
          retainedPrevious: Array.isArray(task.raw_data?.customFields),
          hydrationRequired: true,
          hydrationSucceeded: false,
          repairedAt: startedAt
        },
        updated_at: startedAt
      }).eq("id", task.id).eq("organization_id", organizationId);
      if (error) throw new Error(`Supabase could not preserve incomplete repaired task ${task.wrike_id}: ${error.message}`);
    }
    const result: VerticalRepairResult = {
      examined: tasks.length,
      repaired,
      unchanged,
      unresolved: unresolved + stillIncomplete,
      conflicting,
      failed,
      retained,
      stillIncomplete,
      hydrated: hydratedResolved.length,
      locallyReprocessed: completeResolved.length,
      hydrationRequests: Math.ceil(incompleteTasks.length / 100)
    };
    const { error: completionError } = await db.from("wrike_vertical_repair_runs").update({
      status: "succeeded", completed_at: new Date().toISOString(), ...snakeCounts(result),
      diagnostics: { repairMode: "explicit_admin", parserVersion: 2, detailBatchSize: 100, locallyReprocessed: result.locallyReprocessed, hydrated: result.hydrated, readBackVerified: true, failedProjects }
    }).eq("id", run.id);
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
  const verticalField = normalized.find((field) => field.normalizedKey === "vertical");
  const vertical = verticalField?.verticalNormalization;
  const state = verticalField?.conflict
    ? "unrecognized"
    : classifyVerticalState({ customFieldsSyncState: "complete", vertical, unresolvedCustomFieldDefinitions: false });
  return { row, raw, fields, normalized, state };
}

async function updateResolvedTask(db: ReturnType<typeof createAdminClient>, organizationId: string, task: ReturnType<typeof resolveTask>, updates: Record<string, unknown>) {
  const enriched = task.row.enriched_metadata && typeof task.row.enriched_metadata === "object" ? task.row.enriched_metadata : {};
  const { error } = await db.from("wrike_tasks").update({ ...updates, enriched_metadata: { ...enriched, customFields: task.fields, customFieldsNormalized: task.normalized }, updated_at: new Date().toISOString() }).eq("id", task.row.id).eq("organization_id", organizationId);
  if (error) throw new Error(`Supabase could not update repaired task ${task.row.wrike_id}: ${error.message}`);
}

function displayText(value: unknown) { return Array.isArray(value) ? value.map(String).join(", ") : value == null ? null : String(value); }
function optionValues(field: ResolvedCustomField) { return Array.isArray(field.displayValue) ? field.displayValue.map(String) : field.displayValue == null ? [] : [String(field.displayValue)]; }

async function loadPersistedVerticals(
  db: ReturnType<typeof createAdminClient>,
  taskIds: string[],
  verticalFieldId?: string
) {
  const rows = new Map<string, PersistedVerticalRow>();
  if (!verticalFieldId) return rows;
  for (let offset = 0; offset < taskIds.length; offset += 250) {
    const batch = taskIds.slice(offset, offset + 250);
    if (!batch.length) continue;
    const { data, error } = await db.from("wrike_task_normalized_custom_field_values")
      .select("task_id,normalized_verticals,unresolved_vertical_tokens,has_conflict,vertical_reporting_category")
      .eq("normalized_field_id", verticalFieldId)
      .in("task_id", batch);
    if (error) throw new Error(`Supabase could not verify stored Vertical values: ${error.message}`);
    for (const row of data ?? []) rows.set(row.task_id, row as PersistedVerticalRow);
  }
  return rows;
}

async function reconcileReadBack(
  db: ReturnType<typeof createAdminClient>,
  organizationId: string,
  tasks: ReturnType<typeof resolveTask>[],
  verticalFieldId: string | undefined,
  initial: Map<string, PersistedVerticalRow>,
  repairedAt: string
) {
  const persisted = await loadPersistedVerticals(db, tasks.map((task) => task.row.id), verticalFieldId);
  let repaired = 0;
  let unchanged = 0;
  let unresolved = 0;
  let conflicting = 0;
  let failed = 0;
  const failedProjects: { projectTitle: string; wrikeTaskId: string; reason: string }[] = [];
  const taskUpdates: Record<string, unknown>[] = [];
  for (const task of tasks) {
    const row = persisted.get(task.row.id) ?? null;
    const state = persistedVerticalState(row);
    const expectedField = task.normalized.find((field) => field.normalizedKey === "vertical");
    const expectedVerticals = expectedField?.conflict ? [] : expectedField?.verticalNormalization?.normalizedVerticals ?? [];
    const actualVerticals = row?.normalized_verticals ?? [];
    const persistenceMatches = verticalPersistenceMatches(task.state, expectedVerticals, row);
    if (!persistenceMatches) {
      failed++;
      failedProjects.push({
        projectTitle: task.row.title,
        wrikeTaskId: task.row.wrike_id,
        reason: `Read-back mismatch: expected ${task.state} [${expectedVerticals.join(", ")}], stored ${state} [${actualVerticals.join(", ")}].`
      });
      continue;
    }
    taskUpdates.push(repairedTaskUpdate(task, { vertical_state: state, vertical_repaired_at: repairedAt }));
    const prior = initial.get(task.row.id) ?? null;
    const changed = verticalSnapshotChanged(task.row.vertical_state, prior, state, row);
    if (changed) repaired++; else unchanged++;
    if (state === "missing" || state === "unrecognized") unresolved++;
    if (row?.has_conflict) conflicting++;
  }
  for (let offset = 0; offset < taskUpdates.length; offset += 500) {
    const { error } = await db.rpc("repair_wrike_vertical_task_states", {
      target_organization_id: organizationId,
      task_updates: taskUpdates.slice(offset, offset + 500)
    });
    if (error) throw new Error(`Supabase could not persist verified Vertical task states: ${error.message}`);
  }
  return { repaired, unchanged, unresolved, conflicting, failed, failedProjects };
}

async function loadAllRepairTasks(db: ReturnType<typeof createAdminClient>, organizationId: string) {
  const rows: TaskRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.from("wrike_tasks")
      .select("id,wrike_id,title,raw_data,enriched_metadata,custom_fields_sync_state,custom_fields_sync_diagnostics,vertical_state")
      .eq("organization_id", organizationId).eq("is_deleted", false)
      .order("id").range(offset, offset + 999);
    if (error) throw new Error(`Supabase could not load tasks for repair: ${error.message}`);
    rows.push(...((data ?? []) as TaskRow[]));
    if ((data?.length ?? 0) < 1000) return rows;
  }
}

async function loadAllRepairFields(db: ReturnType<typeof createAdminClient>, organizationId: string) {
  const rows: { id: string; wrike_id: string; title: string; field_type: string | null; raw_data: Record<string, unknown> | null; is_unresolved: boolean }[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.from("wrike_custom_fields")
      .select("id,wrike_id,title,field_type,raw_data,is_unresolved")
      .eq("organization_id", organizationId).order("id").range(offset, offset + 999);
    if (error) throw new Error(`Supabase could not load custom-field definitions for repair: ${error.message}`);
    rows.push(...((data ?? []) as typeof rows));
    if ((data?.length ?? 0) < 1000) return rows;
  }
}

function repairedTaskUpdate(
  task: ReturnType<typeof resolveTask>,
  updates: Record<string, unknown>
) {
  const enriched = task.row.enriched_metadata && typeof task.row.enriched_metadata === "object" ? task.row.enriched_metadata : {};
  return {
    id: task.row.id,
    ...updates,
    enriched_metadata: { ...enriched, customFields: task.fields, customFieldsNormalized: task.normalized },
    updated_at: new Date().toISOString()
  };
}

function snakeCounts(result: VerticalRepairResult) {
  return {
    examined_count: result.examined,
    repaired_count: result.repaired,
    unchanged_count: result.unchanged,
    unresolved_count: result.unresolved,
    conflicting_count: result.conflicting,
    failed_count: result.failed,
    retained_count: result.retained,
    still_incomplete_count: result.stillIncomplete,
    hydration_request_count: result.hydrationRequests
  };
}
