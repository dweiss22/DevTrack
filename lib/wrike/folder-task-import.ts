import { createAdminClient } from "@/lib/supabase/admin";
import { logWrikeEvent, WrikeApiError, WrikeClient } from "@/lib/wrike/client";
import { mapWithConcurrency } from "@/lib/wrike/concurrency";
import { loadCustomFieldManualMappings, persistNormalizedCustomFieldDefinitions, persistNormalizedTaskCustomFields } from "@/lib/wrike/custom-field-persistence";
import { normalizeWrikeCustomFieldTitle } from "@/lib/wrike/custom-field-normalization";
import { wrikeEndpoints } from "@/lib/wrike/endpoints";
import {
  buildCustomFieldDefinitionsById,
  buildFolderDefinitionsById,
  enrichTaskMetadata,
  isLctCustomField,
  parseCustomFieldsResponse,
  parseFolderTreeResponse,
  type EnrichedTaskMetadata
} from "@/lib/wrike/metadata";
import { refreshWrikeSessionFor, wrikeSessionFor } from "@/lib/wrike/oauth";
import { resolveResponsibleUsers, resolveTaskStatus, resolveTimelogCategory, syncEncounteredWrikeUsers, syncWrikeReferenceData, type ReferenceSyncDiagnostics } from "@/lib/wrike/reference-data";
import { uniqueWrikeIds, type WrikeUnresolvedReferenceInput } from "@/lib/wrike/reference-resolution";
import { isOutOfScopeWrikeFolder, scopedWrikeFolderIds, SELECTED_WRIKE_FOLDERS, SELECTED_WRIKE_FOLDER_BY_ID, SELECTED_WRIKE_FOLDER_IDS, type SelectedWrikeFolder } from "@/lib/wrike/selected-folders";
import { WRIKE_TASK_FIELDS } from "@/lib/wrike/task-fields";
import { CUSTOM_FIELD_DETAIL_VERIFICATION_VERSION, classifyVerticalState, customFieldsResponseState, resolveTaskCustomFields, taskDetailsPath, taskNeedsCustomFieldHydration, type TaskCustomFieldObservation } from "@/lib/wrike/task-custom-fields";
import { allocatedMinutes, plannedMinutes } from "@/lib/wrike/sync";
import { markResolvedWrikeReferences, upsertUnresolvedWrikeReferences } from "@/lib/wrike/unresolved-references";
import type { WrikeCustomFieldDefinition, WrikeFolderDefinition, WrikeTask, WrikeTimeEntry } from "@/lib/wrike/types";

export const TASK_IMPORT_FOLDER_IDS = SELECTED_WRIKE_FOLDER_IDS;
export const VERTICAL_COMPLETENESS_MIGRATION = "202607210001_vertical_completeness_and_repair.sql";

export const FOLDER_METADATA_ROOT_ID = "IEACHQK7I46YBWEN";
export const EXPECTED_LCT_FIELD_ID = "IEACHQK7JUAHNWFH";
export const TASK_FIELDS = WRIKE_TASK_FIELDS;
const LCT_MATCHING_RULE = "exact 'lct', prefix 'lct ', or prefix '[lct]'";
const iso = (value?: string) => value ? new Date(value).toISOString() : null;
const day = (value?: string) => value ? value.slice(0, 10) : null;

type SearchAttempt = { query: string | null; path: string; returnedCount: number; returnedTitles: string[]; containsExpectedField: boolean };
export type FolderImportMetadataDiagnostics = {
  folderRequest: string;
  folderResponseKind: string;
  folderDefinitionCount: number;
  customFieldSearches: SearchAttempt[];
  unfilteredFallbackRequired: boolean;
  matchingRule: string;
  matchedFieldCount: number;
  matchedFieldTitles: string[];
  referencedFieldCount?: number;
  unresolvedReferencedFieldIds?: string[];
};

export function folderTasksPath(folderId: string) {
  const params = new URLSearchParams({ descendants: "true", plainTextCustomFields: "true", subTasks: "true", fields: JSON.stringify(TASK_FIELDS) });
  return `/folders/${encodeURIComponent(folderId)}/tasks?${params}`;
}

export function folderTimelogsPath(folderId: string, descendants?: boolean) {
  const params = new URLSearchParams({ plainText: "true" });
  if (descendants !== undefined) params.set("descendants", String(descendants));
  return `/folders/${encodeURIComponent(folderId)}/timelogs?${params}`;
}

export type TaskRequestContract = { valid: true; descendants: true; plainTextCustomFields: true; subTasks: true; fields: string[] };
export type TaskRequestContractDiagnostics = TaskRequestContract & { verifiedFolderCount: number; folderIds: string[] };
export function verifyTaskRequestContract(folderId: string, path = folderTasksPath(folderId)): TaskRequestContract {
  const url = new URL(path, "https://wrike.invalid");
  if (url.pathname !== `/folders/${encodeURIComponent(folderId)}/tasks`) throw new Error(`Task request must use one selected folder ID in the URL path: ${folderId}.`);
  if (url.searchParams.has("folderId") || folderId.includes(",")) throw new Error("Task request cannot use a folderId query or comma-separated folder IDs.");
  if (url.searchParams.get("descendants") !== "true") throw new Error(`Task request must include descendants=true for ${folderId}.`);
  if (url.searchParams.get("plainTextCustomFields") !== "true") throw new Error(`Task request must include plainTextCustomFields=true for ${folderId}.`);
  if (url.searchParams.get("subTasks") !== "true") throw new Error(`Task request must include subTasks=true for ${folderId}.`);
  let fields: unknown;
  try { fields = JSON.parse(url.searchParams.get("fields") ?? "null"); } catch { throw new Error(`Task request fields must be valid JSON for ${folderId}.`); }
  if (!Array.isArray(fields) || TASK_FIELDS.some((field) => !fields.includes(field))) throw new Error(`Task request is missing required fields for ${folderId}.`);
  return { valid: true, descendants: true, plainTextCustomFields: true, subTasks: true, fields: [...TASK_FIELDS] };
}

export { mapWithConcurrency } from "@/lib/wrike/concurrency";

export function deduplicateByWrikeId<T extends { id: string }>(records: readonly T[]) {
  return [...new Map(records.map((record) => [record.id, record])).values()];
}

function scalarValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(scalarValues);
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).flatMap(scalarValues);
  return [value];
}

export function encounteredUserIds(tasks: readonly WrikeTask[], timelogs: readonly WrikeTimeEntry[], folders: readonly WrikeFolderDefinition[], customFields: Map<string, WrikeCustomFieldDefinition>) {
  const values: unknown[] = [];
  for (const task of tasks) {
    values.push(...(task.responsibleIds ?? []), ...(task.authorIds ?? []));
    for (const field of task.customFields ?? []) {
      const definition = customFields.get(field.id);
      if (definition?.type.toLocaleLowerCase() === "contacts") values.push(...scalarValues(field.value));
    }
  }
  for (const entry of timelogs) if (entry.userId) values.push(entry.userId);
  for (const folder of folders) values.push(...(folder.project?.ownerIds ?? []), folder.project?.authorId);
  return uniqueWrikeIds(values);
}

function searchAttempt(query: string | null, path: string, fields: WrikeCustomFieldDefinition[]): SearchAttempt {
  return {
    query,
    path,
    returnedCount: fields.length,
    returnedTitles: fields.map((field) => field.title).sort(),
    containsExpectedField: fields.some((field) => field.id === EXPECTED_LCT_FIELD_ID)
  };
}

export async function fetchValidatedMetadata(client: WrikeClient) {
  const folderPath = wrikeEndpoints.folderChildren(FOLDER_METADATA_ROOT_ID);
  let folderResponse;
  try {
    folderResponse = parseFolderTreeResponse(await client.request<unknown>(folderPath));
  } catch (error) {
    throw new Error(`Wrike folder metadata validation failed for ${folderPath}: ${error instanceof Error ? error.message : "Unknown response error"}`);
  }
  const folderDefinitionsById = buildFolderDefinitionsById(folderResponse.data);
  if (!folderDefinitionsById.has(FOLDER_METADATA_ROOT_ID)) throw new Error(`Wrike folder metadata did not include root ${FOLDER_METADATA_ROOT_ID}.`);

  const fieldsById = new Map<string, WrikeCustomFieldDefinition>();
  const searches: SearchAttempt[] = [];
  for (const title of ["[LCT]", "LCT"]) {
    const path = wrikeEndpoints.customFields(title);
    try {
      const response = parseCustomFieldsResponse(await client.request<unknown>(path));
      response.data.forEach((field) => fieldsById.set(field.id, field));
      searches.push(searchAttempt(title, path, response.data));
    } catch (error) {
      throw new Error(`Wrike custom-field metadata validation failed for ${path}: ${error instanceof Error ? error.message : "Unknown response error"}`);
    }
  }

  let unfilteredFallbackRequired = false;
  if (!fieldsById.has(EXPECTED_LCT_FIELD_ID)) {
    unfilteredFallbackRequired = true;
    const path = wrikeEndpoints.customFields();
    try {
      const response = parseCustomFieldsResponse(await client.request<unknown>(path));
      response.data.forEach((field) => fieldsById.set(field.id, field));
      searches.push(searchAttempt(null, path, response.data));
    } catch (error) {
      throw new Error(`Wrike custom-field fallback validation failed for ${path}: ${error instanceof Error ? error.message : "Unknown response error"}`);
    }
  }

  const matchedFields = [...fieldsById.values()].filter(isLctCustomField).sort((left, right) => left.title.localeCompare(right.title));
  if (!matchedFields.some((field) => field.id === EXPECTED_LCT_FIELD_ID)) throw new Error(`Wrike custom-field metadata did not include required LCT field ${EXPECTED_LCT_FIELD_ID}.`);
  const allFields = [...fieldsById.values()].sort((left, right) => left.title.localeCompare(right.title));
  const customFieldDefinitionsById = buildCustomFieldDefinitionsById(allFields);
  const diagnostics: FolderImportMetadataDiagnostics = {
    folderRequest: folderPath,
    folderResponseKind: folderResponse.kind,
    folderDefinitionCount: folderResponse.data.length,
    customFieldSearches: searches,
    unfilteredFallbackRequired,
    matchingRule: LCT_MATCHING_RULE,
    matchedFieldCount: matchedFields.length,
    matchedFieldTitles: matchedFields.map((field) => field.title)
  };
  return { folderDefinitions: folderResponse.data, folderDefinitionsById, allFields, matchedFields, customFieldDefinitionsById, diagnostics };
}

export async function completeReferencedCustomFieldMetadata(
  client: WrikeClient,
  metadata: Awaited<ReturnType<typeof fetchValidatedMetadata>>,
  referencedFieldIds: readonly string[]
) {
  const missing = [...new Set(referencedFieldIds)].filter((id) => !metadata.customFieldDefinitionsById.has(id));
  metadata.diagnostics.referencedFieldCount = new Set(referencedFieldIds).size;
  if (!missing.length) {
    metadata.diagnostics.unresolvedReferencedFieldIds = [];
    return { metadata, warning: null as string | null };
  }
  const alreadyUnfiltered = metadata.diagnostics.customFieldSearches.some((attempt) => attempt.query === null);
  if (!alreadyUnfiltered) {
    const path = wrikeEndpoints.customFields();
    try {
      const response = parseCustomFieldsResponse(await client.request<unknown>(path));
      response.data.forEach((field) => metadata.customFieldDefinitionsById.set(field.id, field));
      metadata.diagnostics.customFieldSearches.push(searchAttempt(null, path, response.data));
      metadata.diagnostics.unfilteredFallbackRequired = true;
      metadata.allFields = [...metadata.customFieldDefinitionsById.values()].sort((left, right) => left.title.localeCompare(right.title));
      metadata.matchedFields = metadata.allFields.filter(isLctCustomField).sort((left, right) => left.title.localeCompare(right.title));
      metadata.diagnostics.matchedFieldCount = metadata.matchedFields.length;
      metadata.diagnostics.matchedFieldTitles = metadata.matchedFields.map((field) => field.title);
    } catch (error) {
      const warning = `Wrike could not retrieve the unfiltered custom-field definitions: ${error instanceof Error ? error.message : "Unknown response error"}`;
      metadata.diagnostics.unresolvedReferencedFieldIds = missing;
      return { metadata, warning };
    }
  }
  const unresolved = [...new Set(referencedFieldIds)].filter((id) => !metadata.customFieldDefinitionsById.has(id));
  metadata.diagnostics.unresolvedReferencedFieldIds = unresolved;
  return { metadata, warning: null as string | null };
}

export async function validateBeforeReset<T>(loadAndValidate: () => Promise<T>, reset: () => Promise<void>) {
  const validated = await loadAndValidate();
  await reset();
  return validated;
}

export async function importConfiguredFolderTasks(organizationId: string) {
  const db = createAdminClient();
  await requireVerticalCompletenessSchema(db);
  const leaseToken = crypto.randomUUID();
  const startedAt = new Date();
  const tracker: ImportTracker = {
    taskRequests: 0, taskRecords: 0, uniqueTasks: 0, duplicateTasks: 0,
    timelogRequests: 0, timelogRecords: 0, uniqueTimelogs: 0, duplicateTimelogs: 0,
    foldersProcessed: 0, failures: [], descendantStrategy: "unknown", descendantDiagnostics: {}, taskRequestContract: null,
    workflowRequests: 0, userRequests: 0, categoryRequests: 0, referenceDiagnostics: null, referenceWarningCount: 0,
    customFieldConflictCount: 0, customFieldNormalizationDiagnostics: {}, customFieldSyncDiagnostics: {}, unresolvedReferenceCount: 0, referenceResolutionDiagnostics: {}
  };
  const { data: claimed, error: leaseError } = await db.rpc("claim_wrike_sync_lease", { target_organization_id: organizationId, target_token: leaseToken, lease_minutes: 30 });
  if (leaseError) throw new Error(`Unable to acquire the import lock: ${leaseError.message}`);
  if (!claimed) throw new Error("Another Wrike import is already running. Wait for it to finish before trying again.");

  const { data: run, error: runStartError } = await db.from("wrike_folder_task_import_runs").insert({
    organization_id: organizationId,
    status: "running",
    started_at: startedAt.toISOString(),
    selected_folder_count: SELECTED_WRIKE_FOLDERS.length
  }).select("id").single();
  if (runStartError || !run) {
    await db.rpc("release_wrike_sync_lease", { target_organization_id: organizationId, target_token: leaseToken });
    throw new Error("Unable to start the combined import. Apply migrations through 202607170004_wrike_reference_resolution.sql first.");
  }
  logWrikeEvent("info", "folder_import_started", { runId: run.id, organizationId, selectedFolderCount: SELECTED_WRIKE_FOLDERS.length });
  try {
    return await runFolderTaskImport(db, organizationId, run.id, startedAt, tracker);
  } catch (error) {
    const completedAt = new Date();
    const message = error instanceof Error ? error.message : "Unknown folder task and timelog import failure.";
    await db.from("wrike_folder_task_import_runs").update(runSummary(tracker, startedAt, completedAt, {
      status: "failed",
      error_summary: message.slice(0, 1000)
    })).eq("id", run.id);
    logWrikeEvent("error", "folder_import_failed", { runId: run.id, organizationId, message, failures: tracker.failures });
    throw tracker.failures.length ? new FolderImportError(message, tracker.failures) : error;
  } finally {
    await db.rpc("release_wrike_sync_lease", { target_organization_id: organizationId, target_token: leaseToken });
  }
}

async function requireVerticalCompletenessSchema(db: ReturnType<typeof createAdminClient>) {
  const [taskSchema, runSchema, repairSchema] = await Promise.all([
    db.from("wrike_tasks").select("custom_fields_sync_state,custom_fields_verified_at,custom_fields_sync_diagnostics,vertical_state,last_folder_import_run_id").limit(0),
    db.from("wrike_folder_task_import_runs").select("task_custom_field_diagnostics").limit(0),
    db.from("wrike_vertical_repair_runs").select("id").limit(0)
  ]);
  const error = taskSchema.error ?? runSchema.error ?? repairSchema.error;
  if (error) throw new WrikeMigrationRequiredError(VERTICAL_COMPLETENESS_MIGRATION, error.message);
}

export class WrikeMigrationRequiredError extends Error {
  constructor(public migration: string, databaseMessage?: string) {
    super(`Associated Vertical database migration required. Apply Supabase migration ${migration}, reload the PostgREST schema cache, and retry the import.${databaseMessage ? ` Database response: ${databaseMessage}` : ""}`);
    this.name = "WrikeMigrationRequiredError";
  }
}

type FolderFailure = { operation: "tasks" | "timelogs"; folderId: string; folderTitle: string; requestFolderId: string; status: number | null; message: string };
export type DescendantStrategy = "unknown" | "folder_recursive" | "explicit_tree";
type ImportTracker = {
  taskRequests: number; taskRecords: number; uniqueTasks: number; duplicateTasks: number;
  timelogRequests: number; timelogRecords: number; uniqueTimelogs: number; duplicateTimelogs: number;
  foldersProcessed: number; failures: FolderFailure[]; descendantStrategy: DescendantStrategy;
  descendantDiagnostics: Record<string, unknown>; taskRequestContract: TaskRequestContractDiagnostics | null;
  workflowRequests: number; userRequests: number; categoryRequests: number;
  referenceDiagnostics: ReferenceSyncDiagnostics | null; referenceWarningCount: number;
  customFieldConflictCount: number; customFieldNormalizationDiagnostics: Record<string, unknown>;
  customFieldSyncDiagnostics: Record<string, unknown>;
  unresolvedReferenceCount: number; referenceResolutionDiagnostics: Record<string, unknown>;
};

export class FolderImportError extends Error {
  constructor(message: string, public folderFailures: FolderFailure[]) { super(message); }
}

function safeFailure(operation: FolderFailure["operation"], source: SelectedWrikeFolder, requestFolderId: string, error: unknown): FolderFailure {
  return {
    operation,
    folderId: source.id,
    folderTitle: source.title,
    requestFolderId,
    status: error instanceof WrikeApiError ? error.status : null,
    message: (error instanceof Error ? error.message : "Unknown Wrike error").slice(0, 500)
  };
}

function runSummary(tracker: ImportTracker, startedAt: Date, completedAt: Date, extra: Record<string, unknown>) {
  return {
    ...extra,
    completed_at: completedAt.toISOString(),
    duration_ms: completedAt.getTime() - startedAt.getTime(),
    processed_folder_count: tracker.foldersProcessed,
    task_request_count: tracker.taskRequests,
    task_record_count: tracker.taskRecords,
    unique_task_count: tracker.uniqueTasks,
    duplicate_task_count: tracker.duplicateTasks,
    timelog_request_count: tracker.timelogRequests,
    timelog_record_count: tracker.timelogRecords,
    unique_timelog_count: tracker.uniqueTimelogs,
    duplicate_timelog_count: tracker.duplicateTimelogs,
    failed_folder_request_count: tracker.failures.length,
    folder_failures: tracker.failures,
    task_request_contract: tracker.taskRequestContract ?? {},
    timelog_descendant_strategy: tracker.descendantStrategy,
    timelog_descendant_diagnostics: tracker.descendantDiagnostics,
    reference_data_diagnostics: tracker.referenceDiagnostics ?? {},
    reference_warning_count: tracker.referenceWarningCount,
    custom_field_conflict_count: tracker.customFieldConflictCount,
    custom_field_normalization_diagnostics: tracker.customFieldNormalizationDiagnostics,
    task_custom_field_diagnostics: tracker.customFieldSyncDiagnostics,
    unresolved_reference_count: tracker.unresolvedReferenceCount,
    reference_resolution_diagnostics: tracker.referenceResolutionDiagnostics
  };
}

export function descendantFolderIds(rootId: string, definitions: WrikeFolderDefinition[]) {
  const children = new Map(definitions.map((folder) => [folder.id, folder.childIds ?? []]));
  const found = new Set<string>();
  const pending = [...(children.get(rootId) ?? [])];
  while (pending.length) {
    const id = pending.pop()!;
    if (found.has(id)) continue;
    found.add(id);
    pending.push(...(children.get(id) ?? []));
  }
  return [...found];
}

export function chooseTimelogDescendantStrategy(saved: unknown, recursiveEvidenceCount: number): DescendantStrategy {
  if (saved === "folder_recursive" || saved === "explicit_tree") return saved;
  return recursiveEvidenceCount > 0 ? "folder_recursive" : "explicit_tree";
}

async function runFolderTaskImport(db: ReturnType<typeof createAdminClient>, organizationId: string, runId: string, startedAt: Date, tracker: ImportTracker) {
  const taskPaths = new Map(SELECTED_WRIKE_FOLDERS.map((source) => [source.id, folderTasksPath(source.id)]));
  const verifiedContracts = SELECTED_WRIKE_FOLDERS.map((source) => verifyTaskRequestContract(source.id, taskPaths.get(source.id)!));
  tracker.taskRequestContract = {
    ...verifiedContracts[0],
    verifiedFolderCount: verifiedContracts.length,
    folderIds: SELECTED_WRIKE_FOLDERS.map((source) => source.id)
  };
  const session = await wrikeSessionFor(organizationId);
  const client = new WrikeClient(session.accessToken, session.apiBaseUrl, {
    onUnauthorized: async () => {
      const refreshed = await refreshWrikeSessionFor(organizationId);
      return { accessToken: refreshed.accessToken, apiBaseUrl: refreshed.apiBaseUrl };
    },
    onRequest: ({ path }) => {
      if (/\/tasks(?:\/|\?|$)/.test(path)) tracker.taskRequests++;
      if (/\/timelogs(?:\?|$)/.test(path)) tracker.timelogRequests++;
      if (path === "/workflows") tracker.workflowRequests++;
      if (/^\/users\//.test(path)) tracker.userRequests++;
      if (/^\/timelog_categories(?:\?|$)/.test(path)) tracker.categoryRequests++;
    }
  });
  const references = await syncWrikeReferenceData(db, organizationId, session.connection.wrike_account_id ?? null, client);
  tracker.referenceDiagnostics = references.diagnostics;
  tracker.referenceDiagnostics.workflow.requests = tracker.workflowRequests;
  tracker.referenceDiagnostics.users.requested = tracker.userRequests;
  tracker.referenceDiagnostics.categories.requests = tracker.categoryRequests;
  tracker.referenceWarningCount = references.diagnostics.failures.length + references.diagnostics.users.nameMismatches.length;
  const metadata = await fetchValidatedMetadata(client);

  type FetchResult = { kind: "tasks"; source: SelectedWrikeFolder; records: WrikeTask[] } | { kind: "timelogs"; source: SelectedWrikeFolder; records: WrikeTimeEntry[] };
  const jobs = SELECTED_WRIKE_FOLDERS.flatMap((source) => [{ kind: "tasks" as const, source }, { kind: "timelogs" as const, source }]);
  const fetched = await mapWithConcurrency(jobs, 4, async (job): Promise<FetchResult | null> => {
    try {
      if (job.kind === "tasks") {
        const path = taskPaths.get(job.source.id)!;
        const { records } = await client.allWithStats<WrikeTask>(path);
        return { ...job, records };
      }
      const { records } = await client.allWithStats<WrikeTimeEntry>(folderTimelogsPath(job.source.id));
      return { ...job, records };
    } catch (error) {
      const failure = safeFailure(job.kind, job.source, job.source.id, error);
      tracker.failures.push(failure);
      logWrikeEvent("error", "folder_request_failed", failure);
      return null;
    }
  });
  if (tracker.failures.length) throw new Error(`${tracker.failures.length} selected-folder Wrike request(s) failed; existing reporting data was not changed.`);

  const taskByFolder = new Map<string, WrikeTask[]>();
  const timelogByFolder = new Map<string, WrikeTimeEntry[]>();
  for (const result of fetched) {
    if (!result) continue;
    if (result.kind === "tasks") taskByFolder.set(result.source.id, result.records);
    else timelogByFolder.set(result.source.id, result.records);
  }

  const topLevelTaskRecords = [...taskByFolder.values()].flat();
  const topLevelTimelogRecords = [...timelogByFolder.values()].flat();
  const observationsByTaskId = new Map<string, TaskCustomFieldObservation[]>();
  for (const [sourceFolderId, folderTasks] of taskByFolder) for (const task of folderTasks) {
    const observation = { task, sourceFolderId };
    const observations = observationsByTaskId.get(task.id);
    if (observations) observations.push(observation);
    else observationsByTaskId.set(task.id, [observation]);
  }
  const observedTaskIds = [...observationsByTaskId.keys()];
  const previousTaskByWrikeId = new Map<string, WrikeTask>();
  const previousCustomFieldsVerifiedAt = new Map<string, string | null>();
  const previousCustomFieldDiagnostics = new Map<string, unknown>();
  for (let offset = 0; offset < observedTaskIds.length; offset += 250) {
    const { data, error } = await db.from("wrike_tasks").select("wrike_id,raw_data,custom_fields_verified_at,custom_fields_sync_diagnostics").eq("organization_id", organizationId).in("wrike_id", observedTaskIds.slice(offset, offset + 250));
    if (error) throw new Error(`Supabase could not load prior task payloads: ${error.message}`);
    for (const task of data ?? []) {
      if (task.raw_data && typeof task.raw_data === "object") previousTaskByWrikeId.set(task.wrike_id, task.raw_data as WrikeTask);
      previousCustomFieldsVerifiedAt.set(task.wrike_id, task.custom_fields_verified_at);
      previousCustomFieldDiagnostics.set(task.wrike_id, task.custom_fields_sync_diagnostics);
    }
  }
  const hydrationIds = observedTaskIds.filter((taskId) => taskNeedsCustomFieldHydration(
    observationsByTaskId.get(taskId)!,
    previousTaskByWrikeId.get(taskId),
    previousCustomFieldDiagnostics.get(taskId)
  ));
  const detailByTaskId = new Map<string, WrikeTask>();
  const hydrationFailedIds = new Set<string>();
  for (let offset = 0; offset < hydrationIds.length; offset += 100) {
    const batch = hydrationIds.slice(offset, offset + 100);
    try {
      const response = await client.request<{ data: WrikeTask[] }>(taskDetailsPath(batch));
      for (const task of response.data) detailByTaskId.set(task.id, task);
      for (const taskId of batch) if (!detailByTaskId.has(taskId)) hydrationFailedIds.add(taskId);
    } catch (error) {
      batch.forEach((taskId) => hydrationFailedIds.add(taskId));
      logWrikeEvent("warn", "wrike_task_detail_hydration_failed", {
        taskCount: batch.length,
        status: error instanceof WrikeApiError ? error.status : null,
        message: error instanceof Error ? error.message : "Unknown task detail hydration error"
      });
    }
  }
  const resolvedTasks = observedTaskIds.map((taskId) => resolveTaskCustomFields(
    observationsByTaskId.get(taskId)!,
    detailByTaskId.get(taskId),
    previousTaskByWrikeId.get(taskId),
    previousCustomFieldDiagnostics.get(taskId)
  ));
  const resolutionByTaskId = new Map(resolvedTasks.map((resolved) => [resolved.task.id, resolved]));
  const tasks = resolvedTasks.map((resolved) => resolved.task);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const savedStrategy = session.connection.timelog_descendant_strategy as DescendantStrategy | undefined;
  let descendantEvidenceCount = 0;
  for (const source of SELECTED_WRIKE_FOLDERS) {
    const descendants = new Set(descendantFolderIds(source.id, metadata.folderDefinitions));
    for (const entry of timelogByFolder.get(source.id) ?? []) {
      const task = taskById.get(entry.taskId);
      if ((task?.parentIds ?? []).some((parentId) => descendants.has(parentId))) descendantEvidenceCount++;
    }
  }
  tracker.descendantStrategy = chooseTimelogDescendantStrategy(savedStrategy, descendantEvidenceCount);

  let descendantRecordsReceived = 0;
  let descendantRecordsMissingFromTop = 0;
  if (tracker.descendantStrategy === "explicit_tree") {
    const descendantJobs = SELECTED_WRIKE_FOLDERS.flatMap((source) => descendantFolderIds(source.id, metadata.folderDefinitions).map((requestFolderId) => ({ source, requestFolderId })));
    const descendantResults = await mapWithConcurrency(descendantJobs, 4, async ({ source, requestFolderId }) => {
      try {
        const { records } = await client.allWithStats<WrikeTimeEntry>(folderTimelogsPath(requestFolderId, false));
        descendantRecordsReceived += records.length;
        return { source, records };
      } catch (error) {
        const failure = safeFailure("timelogs", source, requestFolderId, error);
        tracker.failures.push(failure);
        logWrikeEvent("error", "descendant_timelog_request_failed", failure);
        return null;
      }
    });
    if (tracker.failures.length) throw new Error(`${tracker.failures.length} descendant-folder timelog request(s) failed; existing reporting data was not changed.`);
    const topIdsBySource = new Map([...timelogByFolder.entries()].map(([folderId, entries]) => [folderId, new Set(entries.map((entry) => entry.id))]));
    for (const result of descendantResults) {
      if (!result) continue;
      descendantRecordsMissingFromTop += result.records.filter((entry) => !topIdsBySource.get(result.source.id)?.has(entry.id)).length;
      timelogByFolder.set(result.source.id, deduplicateByWrikeId([...(timelogByFolder.get(result.source.id) ?? []), ...result.records]));
    }
  }
  tracker.descendantDiagnostics = {
    observedAt: new Date().toISOString(),
    descendantEvidenceCount,
    descendantRecordsReceived,
    descendantRecordsMissingFromTop,
    outcome: tracker.descendantStrategy === "folder_recursive" ? "Actual folder responses included timelogs linked to descendant tasks." : "No conclusive recursive evidence was observed; explicit descendant traversal was used."
  };
  const { error: strategyError } = await db.from("wrike_connections").update({
    timelog_descendant_strategy: tracker.descendantStrategy,
    timelog_descendant_verified_at: new Date().toISOString(),
    timelog_descendant_diagnostics: tracker.descendantDiagnostics
  }).eq("organization_id", organizationId);
  if (strategyError) throw new Error(`Supabase could not save descendant-timelog verification: ${strategyError.message}`);

  const allTimelogRecords = [...timelogByFolder.values()].flat();
  const timelogs = deduplicateByWrikeId(allTimelogRecords);
  tracker.taskRecords = topLevelTaskRecords.length;
  tracker.uniqueTasks = tasks.length;
  tracker.duplicateTasks = tracker.taskRecords - tracker.uniqueTasks;
  tracker.timelogRecords = topLevelTimelogRecords.length + descendantRecordsReceived;
  tracker.uniqueTimelogs = timelogs.length;
  tracker.duplicateTimelogs = tracker.timelogRecords - tracker.uniqueTimelogs;
  tracker.foldersProcessed = SELECTED_WRIKE_FOLDERS.length;
  const referencedCustomFieldIds = tasks.flatMap((task) => (task.customFields ?? []).map((field) => field.id));
  const completedMetadata = await completeReferencedCustomFieldMetadata(client, metadata, referencedCustomFieldIds);
  if (completedMetadata.warning) {
    tracker.referenceWarningCount++;
    logWrikeEvent("warn", "wrike_custom_field_reference_failed", { message: completedMetadata.warning, missingIds: metadata.diagnostics.unresolvedReferencedFieldIds });
  }
  const stillMissingFieldIds = [...new Set(referencedCustomFieldIds)].filter((id) => !metadata.customFieldDefinitionsById.has(id));
  if (stillMissingFieldIds.length) {
    const { data: priorFields, error } = await db.from("wrike_custom_fields").select("wrike_id,raw_data,is_unresolved").eq("organization_id", organizationId).in("wrike_id", stillMissingFieldIds);
    if (error) throw new Error(`Supabase could not load previously resolved custom fields: ${error.message}`);
    for (const field of priorFields ?? []) if (!field.is_unresolved && field.raw_data && typeof field.raw_data === "object") metadata.customFieldDefinitionsById.set(field.wrike_id, field.raw_data as WrikeCustomFieldDefinition);
    metadata.allFields = [...metadata.customFieldDefinitionsById.values()].sort((left, right) => left.title.localeCompare(right.title));
    metadata.diagnostics.unresolvedReferencedFieldIds = stillMissingFieldIds.filter((id) => !metadata.customFieldDefinitionsById.has(id));
  }
  const encounteredIds = encounteredUserIds(tasks, timelogs, metadata.folderDefinitions, metadata.customFieldDefinitionsById);
  const dynamicUsers = await syncEncounteredWrikeUsers(db, organizationId, session.connection.wrike_account_id ?? null, client, encounteredIds);
  const initialUserDiagnostics = references.diagnostics.users;
  references.userRows = dynamicUsers.rows;
  references.diagnostics.users = {
    ...dynamicUsers.diagnostics,
    requested: tracker.userRequests,
    received: initialUserDiagnostics.received + dynamicUsers.diagnostics.received,
    upserted: initialUserDiagnostics.upserted + dynamicUsers.diagnostics.upserted,
    fallbackCreated: initialUserDiagnostics.fallbackCreated + dynamicUsers.diagnostics.fallbackCreated,
    placeholderCreated: initialUserDiagnostics.placeholderCreated + dynamicUsers.diagnostics.placeholderCreated,
    failed: initialUserDiagnostics.failed + dynamicUsers.diagnostics.failed,
    failedIds: [...new Set([...initialUserDiagnostics.failedIds, ...dynamicUsers.diagnostics.failedIds])],
    nameMismatches: [...initialUserDiagnostics.nameMismatches, ...dynamicUsers.diagnostics.nameMismatches],
    durationMs: initialUserDiagnostics.durationMs + dynamicUsers.diagnostics.durationMs
  };
  references.diagnostics.failures.push(...dynamicUsers.failures);
  tracker.referenceWarningCount = references.diagnostics.failures.length + references.diagnostics.users.nameMismatches.length + (completedMetadata.warning ? 1 : 0);
  const manualMappings = await loadCustomFieldManualMappings(db, organizationId);
  const enrichmentMappings = new Map([...manualMappings].map(([wrikeId, mapping]) => [wrikeId, { action: mapping.action, normalizedTitle: mapping.normalizedTitle }]));
  const enrichedByTaskId = new Map(tasks.map((task) => [task.id, enrichTaskMetadata(task, metadata.folderDefinitionsById, metadata.customFieldDefinitionsById, enrichmentMappings)]));
  const verticalStateByTaskId = new Map(tasks.map((task) => {
    const enriched = enrichedByTaskId.get(task.id)!;
    const vertical = enriched.customFieldsNormalized.find((field) => field.normalizedKey === "vertical")?.verticalNormalization;
    const unresolvedDefinitions = enriched.customFields.some((field) => !field.resolved && !field.ignored);
    return [task.id, classifyVerticalState({
      customFieldsSyncState: resolutionByTaskId.get(task.id)?.syncState ?? "unknown",
      vertical,
      unresolvedCustomFieldDefinitions: unresolvedDefinitions
    })] as const;
  }));
  const initialStates = topLevelTaskRecords.map(customFieldsResponseState);
  tracker.customFieldSyncDiagnostics = {
    tasksDiscovered: tasks.length,
    initialResponses: {
      present: initialStates.filter((state) => state === "present").length,
      empty: initialStates.filter((state) => state === "empty").length,
      omitted: initialStates.filter((state) => state === "omitted").length,
      invalid: initialStates.filter((state) => state === "invalid").length
    },
    tasksRequiringHydration: hydrationIds.length,
    tasksHydrated: resolvedTasks.filter((task) => task.hydrationSucceeded).length,
    hydrationFailed: hydrationFailedIds.size,
    tasksRetainingPreviousCustomFields: resolvedTasks.filter((task) => task.retainedPrevious).length,
    tasksWithResponseDisagreement: resolvedTasks.filter((task) => task.disagreement).length,
    genuinelyEmptyCustomFields: resolvedTasks.filter((task) => task.authoritative && task.responseState === "empty").length,
    verticalStates: Object.fromEntries(["resolved", "cross_vertical", "missing", "unrecognized", "synchronization_incomplete"].map((state) => [state, [...verticalStateByTaskId.values()].filter((value) => value === state).length])),
    generalNormalizedToCrossVertical: [...enrichedByTaskId.values()].filter((enriched) => enriched.customFieldsNormalized.some((field) => field.normalizedKey === "vertical" && field.verticalNormalization?.crossVerticalTokens.some((token) => token.trim().toLocaleLowerCase() === "general"))).length,
    examples: resolvedTasks.filter((task) => task.syncState === "incomplete" || task.disagreement).slice(0, 25).map((task) => ({
      taskId: task.task.id,
      title: task.task.title,
      syncState: task.syncState,
      responseState: task.responseState,
      hydrationRequired: task.hydrationRequired,
      retainedPrevious: task.retainedPrevious,
      sourceFolderIds: task.observations.map((observation) => observation.sourceFolderId)
    })),
    examplesTruncated: resolvedTasks.filter((task) => task.syncState === "incomplete" || task.disagreement).length > 25
  };

  const importedAt = new Date().toISOString();
  const parentIdsByFolderId = new Map<string, string[]>();
  for (const parent of metadata.folderDefinitions) for (const childId of parent.childIds) parentIdsByFolderId.set(childId, [...(parentIdsByFolderId.get(childId) ?? []), parent.id]);

  const folderDefinitions = metadata.folderDefinitions.filter((folder) => !isOutOfScopeWrikeFolder(folder.id));
  for (const source of SELECTED_WRIKE_FOLDERS) if (!folderDefinitions.some((folder) => folder.id === source.id)) folderDefinitions.push({ id: source.id, title: source.title, childIds: [], scope: "Selected" });
  const referencedLocationIds = [...new Set(tasks.flatMap((task) => scopedWrikeFolderIds(task.parentIds)))];
  for (const folderId of referencedLocationIds) if (!folderDefinitions.some((folder) => folder.id === folderId)) folderDefinitions.push({ id: folderId, title: folderId, childIds: [], scope: "Unresolved", unresolvedReference: true });
  const { data: savedSpaces, error: savedSpacesError } = await db.from("wrike_spaces").select("id,wrike_id").eq("organization_id", organizationId);
  if (savedSpacesError) throw new Error(`Supabase could not load Wrike spaces: ${savedSpacesError.message}`);
  const spaceIdByWrikeId = new Map((savedSpaces ?? []).map((space) => [space.wrike_id, space.id]));
  const findSpaceWrikeId = (folderId: string) => {
    const pending = [folderId]; const visited = new Set<string>();
    while (pending.length) {
      const candidate = pending.shift()!;
      if (spaceIdByWrikeId.has(candidate)) return candidate;
      if (visited.has(candidate)) continue;
      visited.add(candidate);
      pending.push(...(parentIdsByFolderId.get(candidate) ?? []));
    }
    return null;
  };
  const folderIdMap = new Map<string, string>();
  for (let offset = 0; offset < folderDefinitions.length; offset += 250) {
    const rows = folderDefinitions.slice(offset, offset + 250).map((folder) => ({
      organization_id: organizationId,
      wrike_id: folder.id,
      space_id: spaceIdByWrikeId.get(findSpaceWrikeId(folder.id) ?? "") ?? null,
      title: SELECTED_WRIKE_FOLDER_BY_ID.get(folder.id)?.title ?? folder.title,
      parent_wrike_ids: parentIdsByFolderId.get(folder.id) ?? [],
      child_wrike_ids: folder.childIds,
      scope: folder.scope,
      is_project: Boolean(folder.project),
      raw_data: folder,
      is_unresolved: Boolean(folder.unresolvedReference),
      synced_at: folder.unresolvedReference ? null : importedAt,
      last_resolution_error: folder.unresolvedReference ? "Folder metadata was not returned by Wrike." : null,
      deleted_at: null,
      updated_at: importedAt
    }));
    const { data, error } = await db.from("wrike_folders").upsert(rows, { onConflict: "organization_id,wrike_id" }).select("id,wrike_id");
    if (error) throw new Error(`Supabase could not save Wrike folder metadata: ${error.message}`);
    (data ?? []).forEach((folder) => folderIdMap.set(folder.wrike_id, folder.id));
  }

  const projectDefinitions = folderDefinitions.filter((folder): folder is WrikeFolderDefinition & { project: NonNullable<WrikeFolderDefinition["project"]> } => Boolean(folder.project));
  const projectIdMap = new Map<string, string>();
  for (let offset = 0; offset < projectDefinitions.length; offset += 250) {
    const rows = projectDefinitions.slice(offset, offset + 250).map((folder) => ({
      organization_id: organizationId,
      wrike_id: folder.id,
      folder_id: folderIdMap.get(folder.id) ?? null,
      title: folder.title,
      status: folder.project.status ?? null,
      owner_wrike_ids: folder.project.ownerIds ?? [],
      author_wrike_id: folder.project.authorId ?? null,
      custom_status_id: folder.project.customStatusId ?? null,
      created_at_wrike: iso(folder.project.createdDate),
      raw_data: folder,
      deleted_at: null,
      updated_at: importedAt
    }));
    const { data, error } = await db.from("wrike_projects").upsert(rows, { onConflict: "organization_id,wrike_id" }).select("id,wrike_id");
    if (error) throw new Error(`Supabase could not save Wrike project metadata: ${error.message}`);
    (data ?? []).forEach((project) => projectIdMap.set(project.wrike_id, project.id));
  }

  const knownDefinitionRows = metadata.allFields.map((field) => {
    const normalized = normalizeWrikeCustomFieldTitle(field.title);
    return {
      organization_id: organizationId,
      wrike_id: field.id,
      title: field.title,
      original_title: field.title,
      field_type: field.type,
      allowed_values: [...(field.settings?.values ?? []), ...(field.settings?.options ?? []).map((option) => option.value)],
      source_designation: normalized.sourceDesignation,
      is_unresolved: false,
      has_manual_mapping: manualMappings.has(field.id),
      resolved_at: importedAt,
      synced_at: importedAt,
      last_resolution_attempt_at: importedAt,
      last_resolution_error: null,
      raw_data: field,
      updated_at: importedAt
    };
  });
  if (knownDefinitionRows.length) {
    const { error } = await db.from("wrike_custom_fields").upsert(knownDefinitionRows, { onConflict: "organization_id,wrike_id" });
    if (error) throw new Error(`Supabase could not save Wrike custom-field metadata: ${error.message}`);
  }
  const unresolvedFieldIds = [...new Set(referencedCustomFieldIds)].filter((id) => !metadata.customFieldDefinitionsById.has(id));
  if (unresolvedFieldIds.length) {
    const { error } = await db.from("wrike_custom_fields").upsert(unresolvedFieldIds.map((wrikeId) => ({
      organization_id: organizationId,
      wrike_id: wrikeId,
      title: wrikeId,
      original_title: null,
      is_unresolved: !manualMappings.has(wrikeId),
      has_manual_mapping: manualMappings.has(wrikeId),
      last_resolution_attempt_at: importedAt,
      last_resolution_error: completedMetadata.warning ?? "The custom-field definition was not returned by Wrike.",
      raw_data: { referenceSource: "unresolved_placeholder" },
      updated_at: importedAt
    })), { onConflict: "organization_id,wrike_id", ignoreDuplicates: true });
    if (error) throw new Error(`Supabase could not preserve unresolved Wrike custom fields: ${error.message}`);
  }
  const fieldIdsToLoad = [...new Set([...metadata.allFields.map((field) => field.id), ...referencedCustomFieldIds])];
  const { data: savedFields, error: fieldError } = fieldIdsToLoad.length
    ? await db.from("wrike_custom_fields").select("id,wrike_id,title,is_unresolved").eq("organization_id", organizationId).in("wrike_id", fieldIdsToLoad)
    : { data: [], error: null };
  if (fieldError) throw new Error(`Supabase could not load saved Wrike custom-field metadata: ${fieldError.message}`);
  const customFieldIdMap = new Map((savedFields ?? []).map((field) => [field.wrike_id, field.id]));
  const normalizedSources = (savedFields ?? []).filter((field) => !field.is_unresolved || manualMappings.has(field.wrike_id));
  const normalizedFieldIdByKey = await persistNormalizedCustomFieldDefinitions(db, organizationId, normalizedSources, importedAt);
  const matchedIds = new Set(metadata.matchedFields.map((field) => field.id));
  const enabledLctFields = (savedFields ?? []).filter((field) => matchedIds.has(field.wrike_id));
  if (enabledLctFields.length) {
    const { error } = await db.from("wrike_enabled_custom_fields").upsert(enabledLctFields.map((field) => ({ organization_id: organizationId, custom_field_id: field.id })), { onConflict: "organization_id,custom_field_id" });
    if (error) throw new Error(`Supabase could not enable LCT custom fields: ${error.message}`);
  }

  const taskIdMap = new Map<string, string>();
  const { data: previousMappings, error: previousMappingError } = await db.from("wrike_folder_task_imports").select("task_id").eq("organization_id", organizationId).in("folder_wrike_id", SELECTED_WRIKE_FOLDER_IDS);
  if (previousMappingError) throw new Error(`Supabase could not load existing task source folders: ${previousMappingError.message}`);
  for (let offset = 0; offset < tasks.length; offset += 250) {
    const batch = tasks.slice(offset, offset + 250);
    const rows = batch.map((task) => {
      const resolution = resolutionByTaskId.get(task.id)!;
      return {
      organization_id: organizationId,
      wrike_id: task.id,
      title: task.title,
      description: task.description ?? null,
      permalink: task.permalink ?? null,
      status: task.status,
      workflow_id: task.workflowId ?? null,
      custom_status_id: task.customStatusId ?? null,
      responsible_wrike_ids: task.responsibleIds ?? [],
      importance: task.importance ?? null,
      created_at_wrike: iso(task.createdDate),
      updated_at_wrike: iso(task.updatedDate),
      start_date: day(task.dates?.start),
      due_date: day(task.dates?.due),
      completed_at: iso(task.dates?.completed),
      parent_wrike_ids: scopedWrikeFolderIds(task.parentIds),
      super_task_wrike_ids: task.superTaskIds ?? [],
      task_type: task.dates?.type ?? null,
      planned_minutes: plannedMinutes(task),
      allocated_minutes: allocatedMinutes(task),
      raw_data: task,
      enriched_metadata: enrichedByTaskId.get(task.id),
      custom_fields_sync_state: resolution.syncState,
      custom_fields_verified_at: resolution.authoritative ? importedAt : previousCustomFieldsVerifiedAt.get(task.id) ?? null,
      custom_fields_sync_diagnostics: {
        runId,
        responseState: resolution.responseState,
        authoritative: resolution.authoritative,
        hydrationRequired: resolution.hydrationRequired,
        hydrationSucceeded: resolution.hydrationSucceeded,
        retainedPrevious: resolution.retainedPrevious,
        disagreement: resolution.disagreement,
        selectedSource: resolution.selectedSource,
        authoritativeFingerprint: resolution.authoritativeFingerprint,
        detailVerificationVersion: resolution.detailVerificationFingerprint ? CUSTOM_FIELD_DETAIL_VERIFICATION_VERSION : null,
        detailVerificationFingerprint: resolution.detailVerificationFingerprint,
        observations: resolution.observations,
        detail: resolution.detail,
        previous: resolution.previous
      },
      vertical_state: verticalStateByTaskId.get(task.id),
      last_folder_import_run_id: runId,
      is_deleted: false,
      last_seen_at: importedAt,
      updated_at: importedAt
      };
    });
    const { data, error } = await db.from("wrike_tasks").upsert(rows, { onConflict: "organization_id,wrike_id" }).select("id,wrike_id");
    if (error) throw new Error(`Supabase could not save Wrike tasks: ${error.message}`);
    (data ?? []).forEach((task) => taskIdMap.set(task.wrike_id, task.id));
  }

  const importedTaskIds = [...taskIdMap.values()];
  for (let offset = 0; offset < importedTaskIds.length; offset += 250) {
    const ids = importedTaskIds.slice(offset, offset + 250);
    const [{ error: locationDeleteError }, { error: assigneeDeleteError }] = await Promise.all([
      db.from("wrike_task_locations").delete().in("task_id", ids),
      db.from("wrike_task_assignees").delete().in("task_id", ids)
    ]);
    if (locationDeleteError || assigneeDeleteError) throw new Error("Supabase could not reconcile existing task metadata relationships.");
  }
  const authoritativeTaskIds = tasks.filter((task) => resolutionByTaskId.get(task.id)?.authoritative).flatMap((task) => {
    const id = taskIdMap.get(task.id);
    return id ? [id] : [];
  });
  for (let offset = 0; offset < authoritativeTaskIds.length; offset += 250) {
    const { error } = await db.from("wrike_task_custom_field_values").delete().in("task_id", authoritativeTaskIds.slice(offset, offset + 250));
    if (error) throw new Error("Supabase could not reconcile authoritative task custom fields.");
  }

  const referenceUserIdMap = new Map(references.userRows.flatMap((user) => user.id ? [[user.wrike_id, user.id] as const] : []));
  const assignments = tasks.flatMap((task) => (task.responsibleIds ?? []).flatMap((wrikeUserId) => {
    const taskId = taskIdMap.get(task.id); const userId = referenceUserIdMap.get(wrikeUserId);
    return taskId && userId ? [{ task_id: taskId, user_id: userId, assignment_type: "assignee" }] : [];
  }));
  for (let offset = 0; offset < assignments.length; offset += 500) {
    const { error } = await db.from("wrike_task_assignees").upsert(assignments.slice(offset, offset + 500), { onConflict: "task_id,user_id,assignment_type" });
    if (error) throw new Error(`Supabase could not save task assignees: ${error.message}`);
  }

  const locations = tasks.flatMap((task) => scopedWrikeFolderIds(task.parentIds).flatMap((wrikeLocationId) => {
    const taskId = taskIdMap.get(task.id);
    return taskId ? [{ task_id: taskId, folder_id: folderIdMap.get(wrikeLocationId) ?? null, project_id: projectIdMap.get(wrikeLocationId) ?? null, wrike_location_id: wrikeLocationId }] : [];
  }));
  for (let offset = 0; offset < locations.length; offset += 500) {
    const { error } = await db.from("wrike_task_locations").upsert(locations.slice(offset, offset + 500), { onConflict: "task_id,wrike_location_id" });
    if (error) throw new Error(`Supabase could not save task folder locations: ${error.message}`);
  }

  const customValues = tasks.filter((task) => resolutionByTaskId.get(task.id)?.authoritative).flatMap((task) => (enrichedByTaskId.get(task.id)?.customFields ?? []).flatMap((field) => {
    const taskId = taskIdMap.get(task.id); const customFieldId = customFieldIdMap.get(field.id);
    if (!taskId || !customFieldId || field.rawValue == null) return [];
    return [{
      task_id: taskId,
      custom_field_id: customFieldId,
      value: field.rawValue,
      display_value: field.displayValue,
      text_value: displayText(field.displayValue),
      option_ids: [],
      option_values: optionValues(field),
      resolved: field.resolved,
      updated_at: importedAt
    }];
  }));
  for (let offset = 0; offset < customValues.length; offset += 500) {
    const { error } = await db.from("wrike_task_custom_field_values").upsert(customValues.slice(offset, offset + 500), { onConflict: "task_id,custom_field_id" });
    if (error) throw new Error(`Supabase could not save readable custom-field values: ${error.message}`);
  }
  const normalizedResult = await persistNormalizedTaskCustomFields(db, normalizedFieldIdByKey, tasks.filter((task) => resolutionByTaskId.get(task.id)?.authoritative).flatMap((task) => {
    const taskId = taskIdMap.get(task.id); const fields = enrichedByTaskId.get(task.id)?.customFieldsNormalized;
    return taskId && fields ? [{ taskId, taskWrikeId: task.id, fields }] : [];
  }), importedAt);
  const verticalFieldId = normalizedFieldIdByKey.get("vertical");
  const incompleteTaskIds = tasks.filter((task) => verticalStateByTaskId.get(task.id) === "synchronization_incomplete").flatMap((task) => taskIdMap.get(task.id) ? [taskIdMap.get(task.id)!] : []);
  if (verticalFieldId) for (let offset = 0; offset < incompleteTaskIds.length; offset += 250) {
    const { error } = await db.from("wrike_task_normalized_custom_field_values").update({ has_unresolved_vertical: true, updated_at: importedAt }).eq("normalized_field_id", verticalFieldId).in("task_id", incompleteTaskIds.slice(offset, offset + 250));
    if (error) throw new Error(`Supabase could not project incomplete Vertical states: ${error.message}`);
  }
  tracker.customFieldConflictCount = normalizedResult.conflictCount;
  tracker.customFieldNormalizationDiagnostics = {
    logicalFieldCount: normalizedFieldIdByKey.size,
    normalizedTaskValueCount: normalizedResult.valueCount,
    conflictCount: normalizedResult.conflictCount,
    conflicts: normalizedResult.conflicts.slice(0, 100),
    conflictsTruncated: normalizedResult.conflicts.length > 100
  };

  const mappings = [...taskByFolder.entries()].flatMap(([folderId, folderTasks]) => folderTasks.flatMap((task) => {
    const taskId = taskIdMap.get(task.id);
    return taskId ? [{ organization_id: organizationId, folder_wrike_id: folderId, folder_id: folderIdMap.get(folderId) ?? null, task_id: taskId, imported_at: importedAt }] : [];
  }));
  for (let offset = 0; offset < mappings.length; offset += 500) {
    const { error } = await db.from("wrike_folder_task_imports").upsert(mappings.slice(offset, offset + 500), { onConflict: "organization_id,folder_wrike_id,task_id" });
    if (error) throw new Error(`Supabase could not save folder membership: ${error.message}`);
  }
  const { error: staleMappingError } = await db.from("wrike_folder_task_imports").delete().eq("organization_id", organizationId).in("folder_wrike_id", SELECTED_WRIKE_FOLDER_IDS).lt("imported_at", importedAt);
  if (staleMappingError) throw new Error(`Supabase could not reconcile stale task source folders: ${staleMappingError.message}`);
  const currentTaskIds = new Set(mappings.map((mapping) => mapping.task_id));
  const staleTaskIds = [...new Set((previousMappings ?? []).map((mapping) => mapping.task_id))].filter((taskId) => !currentTaskIds.has(taskId));
  for (let offset = 0; offset < staleTaskIds.length; offset += 250) {
    const { error } = await db.from("wrike_tasks").update({ is_deleted: true, updated_at: importedAt }).in("id", staleTaskIds.slice(offset, offset + 250));
    if (error) throw new Error(`Supabase could not mark unreconciled tasks deleted: ${error.message}`);
  }

  const referencedTaskWrikeIds = [...new Set(timelogs.map((entry) => entry.taskId).filter(Boolean))];
  for (let offset = 0; offset < referencedTaskWrikeIds.length; offset += 250) {
    const { data, error } = await db.from("wrike_tasks").select("id,wrike_id").eq("organization_id", organizationId).in("wrike_id", referencedTaskWrikeIds.slice(offset, offset + 250));
    if (error) throw new Error(`Supabase could not resolve timelog tasks: ${error.message}`);
    (data ?? []).forEach((task) => taskIdMap.set(task.wrike_id, task.id));
  }
  const userIdMap = new Map<string, string>(referenceUserIdMap);
  const referencedUserWrikeIds = [...new Set(timelogs.map((entry) => entry.userId).filter((id): id is string => Boolean(id)))];
  for (let offset = 0; offset < referencedUserWrikeIds.length; offset += 250) {
    const { data, error } = await db.from("wrike_users").select("id,wrike_id").eq("organization_id", organizationId).in("wrike_id", referencedUserWrikeIds.slice(offset, offset + 250));
    if (error) throw new Error(`Supabase could not resolve timelog users: ${error.message}`);
    (data ?? []).forEach((user) => userIdMap.set(user.wrike_id, user.id));
  }
  const timeEntryIdMap = new Map<string, string>();
  for (let offset = 0; offset < timelogs.length; offset += 250) {
    const rows = timelogs.slice(offset, offset + 250).map((entry) => {
      const hours = Number(entry.hours ?? ((entry.minutes ?? 0) / 60));
      return {
        organization_id: organizationId,
        wrike_id: entry.id,
        task_id: taskIdMap.get(entry.taskId) ?? null,
        task_wrike_id: entry.taskId,
        user_id: entry.userId ? userIdMap.get(entry.userId) ?? null : null,
        user_wrike_id: entry.userId ?? null,
        entry_date: day(entry.trackedDate),
        hours: Number.isFinite(hours) ? hours : 0,
        minutes: Number.isFinite(hours) ? Math.max(0, Math.round(hours * 60)) : 0,
        category: entry.categoryId ?? null,
        comment: entry.comment ?? null,
        created_at_wrike: iso(entry.createdDate),
        updated_at_wrike: iso(entry.updatedDate),
        raw_data: entry,
        is_deleted: false,
        updated_at: importedAt
      };
    });
    const { data, error } = await db.from("wrike_time_entries").upsert(rows, { onConflict: "organization_id,wrike_id" }).select("id,wrike_id");
    if (error) throw new Error(`Supabase could not save Wrike timelogs: ${error.message}`);
    (data ?? []).forEach((entry) => timeEntryIdMap.set(entry.wrike_id, entry.id));
  }
  const timelogMappings = [...timelogByFolder.entries()].flatMap(([folderId, entries]) => entries.flatMap((entry) => {
    const timeEntryId = timeEntryIdMap.get(entry.id);
    return timeEntryId ? [{ organization_id: organizationId, folder_wrike_id: folderId, folder_id: folderIdMap.get(folderId) ?? null, time_entry_id: timeEntryId, imported_at: importedAt }] : [];
  }));
  for (let offset = 0; offset < timelogMappings.length; offset += 500) {
    const { error } = await db.from("wrike_folder_timelog_imports").upsert(timelogMappings.slice(offset, offset + 500), { onConflict: "organization_id,folder_wrike_id,time_entry_id" });
    if (error) throw new Error(`Supabase could not save timelog source folders: ${error.message}`);
  }

  const responsibleIds = tasks.flatMap((task) => task.responsibleIds ?? []);
  const resolvedResponsible = resolveResponsibleUsers(responsibleIds, references.userRows);
  const timelogUserResolutions = resolveResponsibleUsers(timelogs.flatMap((entry) => entry.userId ? [entry.userId] : []), references.userRows);
  const categoryResolutions = timelogs.flatMap((entry) => {
    const resolved = resolveTimelogCategory(entry.categoryId, references.categoryRows);
    return resolved ? [resolved] : [];
  });
  const statusResolutions = tasks.map((task) => resolveTaskStatus(task.customStatusId, task.status, references.statusRows));
  references.diagnostics.resolution = {
    taskResponsibleIds: responsibleIds.length,
    taskResponsibleResolved: resolvedResponsible.filter((item) => item.resolved).length,
    taskResponsibleUnresolved: resolvedResponsible.filter((item) => !item.resolved).length,
    timelogUsersResolved: timelogUserResolutions.filter((item) => item.resolved).length,
    timelogUsersUnresolved: timelogUserResolutions.filter((item) => !item.resolved).length,
    timelogCategoriesResolved: categoryResolutions.filter((item) => item.resolved).length,
    timelogCategoriesUnresolved: categoryResolutions.filter((item) => !item.resolved).length,
    taskStatusesResolved: statusResolutions.filter((item) => item.resolved).length,
    taskStatusesUnresolved: statusResolutions.filter((item) => !item.resolved).length
  };

  const unresolvedInputs: WrikeUnresolvedReferenceInput[] = [];
  for (const task of tasks) {
    const enriched = enrichedByTaskId.get(task.id);
    for (const field of enriched?.customFields ?? []) if (!field.resolved && !field.ignored) unresolvedInputs.push({
      referenceType: "custom_field",
      wrikeId: field.id,
      sampleValues: [field.rawValue],
      relatedRecords: [{ type: "task", id: task.id }],
      attempted: true,
      lastError: completedMetadata.warning ?? "The custom-field definition was not returned by Wrike."
    });
    for (const folder of enriched?.folders ?? []) if (!folder.resolved) unresolvedInputs.push({
      referenceType: "folder",
      wrikeId: folder.id,
      relatedRecords: [{ type: "task", id: task.id }],
      attempted: true,
      lastError: "Folder metadata was not returned by Wrike."
    });
    if (task.customStatusId && !resolveTaskStatus(task.customStatusId, task.status, references.statusRows).resolved) unresolvedInputs.push({
      referenceType: "custom_status",
      wrikeId: task.customStatusId,
      relatedRecords: [{ type: "task", id: task.id }],
      attempted: true,
      lastError: "The custom status was not returned by the workflow response."
    });
  }
  const userRowsByWrikeId = new Map(references.userRows.map((user) => [user.wrike_id, user]));
  const userFailuresById = new Map(references.diagnostics.failures.filter((failure) => failure.operation === "user" && failure.wrikeId).map((failure) => [failure.wrikeId!, failure.message]));
  for (const userId of encounteredIds) if (userRowsByWrikeId.get(userId)?.is_unresolved || !userRowsByWrikeId.has(userId)) unresolvedInputs.push({
    referenceType: "user",
    wrikeId: userId,
    attempted: true,
    lastError: userFailuresById.get(userId) ?? "The Wrike user could not be identified."
  });
  for (const entry of timelogs) if (entry.categoryId && !resolveTimelogCategory(entry.categoryId, references.categoryRows)?.resolved) unresolvedInputs.push({
    referenceType: "timelog_category",
    wrikeId: entry.categoryId,
    relatedRecords: [{ type: "timelog", id: entry.id }],
    attempted: true,
    lastError: "The timelog category was not returned by Wrike."
  });
  const { data: storedWorkflows, error: storedWorkflowError } = await db.from("wrike_workflows").select("wrike_id,is_unresolved").eq("organization_id", organizationId);
  if (storedWorkflowError) throw new Error(`Supabase could not load workflow references: ${storedWorkflowError.message}`);
  const knownWorkflowIds = new Set((storedWorkflows ?? []).filter((workflow) => !workflow.is_unresolved).map((workflow) => workflow.wrike_id));
  for (const task of tasks) if (task.workflowId && !knownWorkflowIds.has(task.workflowId)) unresolvedInputs.push({
    referenceType: "workflow",
    wrikeId: task.workflowId,
    relatedRecords: [{ type: "task", id: task.id }],
    attempted: true,
    lastError: "The workflow was not returned by Wrike."
  });
  const unresolvedResult = await upsertUnresolvedWrikeReferences(db, organizationId, unresolvedInputs, importedAt);
  tracker.unresolvedReferenceCount = unresolvedResult.unresolvedCount;

  const resolvedReferences = [
    ...metadata.allFields.map((field) => ({ referenceType: "custom_field" as const, wrikeId: field.id })),
    ...references.userRows.filter((user) => !user.is_unresolved).map((user) => ({ referenceType: "user" as const, wrikeId: user.wrike_id })),
    ...references.statusRows.filter((status) => !status.is_unresolved).map((status) => ({ referenceType: "custom_status" as const, wrikeId: status.wrike_id })),
    ...references.categoryRows.filter((category) => !category.is_unresolved).map((category) => ({ referenceType: "timelog_category" as const, wrikeId: category.wrike_id })),
    ...folderDefinitions.filter((folder) => !folder.unresolvedReference).map((folder) => ({ referenceType: "folder" as const, wrikeId: folder.id })),
    ...(storedWorkflows ?? []).filter((workflow) => !workflow.is_unresolved).map((workflow) => ({ referenceType: "workflow" as const, wrikeId: workflow.wrike_id })),
    ...references.spaces.map((space) => ({ referenceType: "space" as const, wrikeId: space.id })),
    ...[...manualMappings.values()].map((mapping) => ({ referenceType: "custom_field" as const, wrikeId: mapping.wrikeId, ignored: mapping.action === "ignore", manualMappingId: mapping.id }))
  ];
  await markResolvedWrikeReferences(db, organizationId, resolvedReferences, importedAt);
  const unresolvedByType = Object.fromEntries([...new Set(unresolvedInputs.map((input) => input.referenceType))].map((type) => [type, new Set(unresolvedInputs.filter((input) => input.referenceType === type).map((input) => input.wrikeId)).size]));
  tracker.referenceResolutionDiagnostics = {
    encounteredUsers: encounteredIds.length,
    referencedCustomFields: new Set(referencedCustomFieldIds).size,
    unresolvedByType,
    unresolvedUniqueCount: tracker.unresolvedReferenceCount,
    manualMappings: manualMappings.size,
    ignoredCustomFields: [...manualMappings.values()].filter((mapping) => mapping.action === "ignore").length
  };

  const folderCounts = Object.fromEntries([...taskByFolder.entries()].map(([folderId, folderTasks]) => [folderId, folderTasks.length]));
  const timelogFolderCounts = Object.fromEntries([...timelogByFolder.entries()].map(([folderId, entries]) => [folderId, entries.length]));
  const completedAt = new Date();
  const { error: runError } = await db.from("wrike_folder_task_import_runs").update(runSummary(tracker, startedAt, completedAt, {
    status: "succeeded",
    folder_counts: folderCounts,
    timelog_folder_counts: timelogFolderCounts,
    task_count: tasks.length,
    folder_definition_count: metadata.folderDefinitions.length,
    custom_field_definition_count: metadata.allFields.length,
    metadata_diagnostics: metadata.diagnostics
  })).eq("id", runId);
  if (runError) throw new Error(`Records were saved, but the import summary failed: ${runError.message}`);
  logWrikeEvent("info", "folder_import_completed", { runId, organizationId, tasks: tasks.length, timelogs: timelogs.length, referenceWarnings: tracker.referenceWarningCount, customFieldConflicts: tracker.customFieldConflictCount, durationMs: completedAt.getTime() - startedAt.getTime() });
  return {
    taskCount: tasks.length,
    timelogCount: timelogs.length,
    folderCounts,
    timelogFolderCounts,
    folderCount: SELECTED_WRIKE_FOLDERS.length,
    selectedFolders: SELECTED_WRIKE_FOLDERS,
    processedFolders: SELECTED_WRIKE_FOLDERS,
    foldersProcessed: tracker.foldersProcessed,
    taskRequestCount: tracker.taskRequests,
    taskRecordsReceived: tracker.taskRecords,
    duplicateTasksRemoved: tracker.duplicateTasks,
    timelogRequestCount: tracker.timelogRequests,
    timelogRecordsReceived: tracker.timelogRecords,
    duplicateTimelogsRemoved: tracker.duplicateTimelogs,
    failedFolderRequestCount: tracker.failures.length,
    folderFailures: tracker.failures,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    descendantStrategy: tracker.descendantStrategy,
    descendantDiagnostics: tracker.descendantDiagnostics,
    taskRequestContract: tracker.taskRequestContract,
    folderDefinitionCount: metadata.folderDefinitions.length,
    customFieldDefinitionCount: metadata.allFields.length,
    matchedCustomFieldTitles: metadata.diagnostics.matchedFieldTitles,
    unfilteredFallbackRequired: metadata.diagnostics.unfilteredFallbackRequired,
    metadataDiagnostics: metadata.diagnostics,
    referenceDataDiagnostics: references.diagnostics,
    referenceWarningCount: tracker.referenceWarningCount,
    customFieldConflictCount: tracker.customFieldConflictCount,
    customFieldNormalizationDiagnostics: tracker.customFieldNormalizationDiagnostics,
    customFieldSyncDiagnostics: tracker.customFieldSyncDiagnostics,
    unresolvedReferenceCount: tracker.unresolvedReferenceCount,
    referenceResolutionDiagnostics: tracker.referenceResolutionDiagnostics
  };
}

function displayText(value: unknown) {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map((item) => typeof item === "string" ? item : JSON.stringify(item)).join(", ");
  return typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : JSON.stringify(value);
}

function optionValues(field: EnrichedTaskMetadata["customFields"][number]) {
  const type = field.type?.toLocaleLowerCase() ?? "";
  if (!type.includes("drop") && !type.includes("select")) return [];
  const values = Array.isArray(field.rawValue) ? field.rawValue : [field.rawValue];
  return values.filter((value): value is string => typeof value === "string");
}
