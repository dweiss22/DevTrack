import { createAdminClient } from "@/lib/supabase/admin";
import { WrikeClient } from "@/lib/wrike/client";
import { folderTasksPath } from "@/lib/wrike/folder-task-import";
import { parseCustomFieldsResponse } from "@/lib/wrike/metadata";
import { refreshWrikeSessionFor, wrikeSessionFor } from "@/lib/wrike/oauth";
import { customFieldsFingerprint, customFieldsResponseState, taskDetailsPath } from "@/lib/wrike/task-custom-fields";
import type { WrikeCustomFieldDefinition, WrikeTask } from "@/lib/wrike/types";

const TASK_LIMIT = 10;
const SOURCE_FOLDER_LIMIT = 12;
const FOLDER_PAGE_LIMIT = 5;
const CONTEXT_FOLDER_LIMIT = 50;
const VALUE_STRING_LIMIT = 500;
const COLLECTION_LIMIT = 25;
const WRIKE_ID = /^[a-zA-Z0-9\-_:.=]{1,256}$/;

type TaskRow = {
  id: string;
  wrike_id: string;
  title: string;
  raw_data: WrikeTask | null;
  enriched_metadata: Record<string, unknown> | null;
  custom_fields_sync_state: string;
  custom_fields_verified_at: string | null;
  custom_fields_sync_diagnostics: Record<string, unknown> | null;
  vertical_state: string;
  last_folder_import_run_id: string | null;
};

type CustomFieldCarrier = { customFields?: { id: string; value: unknown }[]; [key: string]: unknown };

export function parseDiagnosticTaskIds(values: readonly string[]) {
  const taskIds = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (!taskIds.length) throw new Error("At least one Wrike task ID is required.");
  if (taskIds.length > TASK_LIMIT) throw new Error(`Custom-field diagnostics are limited to ${TASK_LIMIT} task IDs.`);
  if (taskIds.some((id) => !WRIKE_ID.test(id))) throw new Error("One or more Wrike task IDs are invalid.");
  return taskIds;
}

function safeValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return value.length > VALUE_STRING_LIMIT ? `${value.slice(0, VALUE_STRING_LIMIT)}…` : value;
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 3) return "[nested value omitted]";
  if (Array.isArray(value)) return value.slice(0, COLLECTION_LIMIT).map((item) => safeValue(item, depth + 1));
  if (typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .slice(0, COLLECTION_LIMIT)
    .map(([key, item]) => [key, safeValue(item, depth + 1)]));
  return String(value);
}

export function summarizeCustomFieldPayload(carrier: CustomFieldCarrier) {
  const task = carrier as WrikeTask;
  const fields = Array.isArray(carrier.customFields) ? carrier.customFields : [];
  return {
    hasOwnProperty: Object.prototype.hasOwnProperty.call(carrier, "customFields"),
    responseState: customFieldsResponseState(task),
    count: Array.isArray(carrier.customFields) ? carrier.customFields.length : null,
    fingerprint: customFieldsFingerprint(task),
    fields: fields.slice(0, 100).map((field) => ({ id: field.id, value: safeValue(field.value) })),
    fieldsTruncated: fields.length > 100
  };
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : "Unknown diagnostic request failure.").slice(0, 500);
}

function definitionEvidence(field: WrikeCustomFieldDefinition | Record<string, unknown>) {
  return {
    id: String(field.id ?? ""),
    title: String(field.title ?? field.id ?? "Unknown field"),
    type: typeof field.type === "string" ? field.type : null,
    scope: typeof field.spaceId === "string" ? "space" : "account",
    spaceId: typeof field.spaceId === "string" ? field.spaceId : null,
    inheritanceType: typeof field.inheritanceType === "string" ? field.inheritanceType : null,
    archived: field.archived === true
  };
}

async function boundedFolderObservation(client: WrikeClient, folderId: string, taskIds: Set<string>) {
  const path = folderTasksPath(folderId);
  const records: WrikeTask[] = [];
  let nextPageToken: string | undefined;
  let pages = 0;
  let complete = false;
  try {
    while (pages < FOLDER_PAGE_LIMIT) {
      const token = nextPageToken ? `&nextPageToken=${encodeURIComponent(nextPageToken)}` : "";
      const page = await client.request<{ data: WrikeTask[]; nextPageToken?: string }>(`${path}&pageSize=100${token}`);
      pages++;
      records.push(...page.data.filter((task) => taskIds.has(task.id)));
      nextPageToken = page.nextPageToken;
      if (!nextPageToken) { complete = true; break; }
    }
    return { folderId, path, pages, scanComplete: complete, observations: records.map((task) => ({ taskId: task.id, title: task.title, payload: summarizeCustomFieldPayload(task) })), error: null };
  } catch (error) {
    return { folderId, path, pages, scanComplete: false, observations: records.map((task) => ({ taskId: task.id, title: task.title, payload: summarizeCustomFieldPayload(task) })), error: safeError(error) };
  }
}

function folderDetailsPath(folderIds: readonly string[]) {
  const fields = encodeURIComponent(JSON.stringify(["cascadingFields", "customColumnIds"]));
  return `/folders/${folderIds.map(encodeURIComponent).join(",")}?plainTextCustomFields=true&fields=${fields}`;
}

export async function diagnoseWrikeTaskCustomFields(organizationId: string, requestedIds: readonly string[]) {
  const taskIds = parseDiagnosticTaskIds(requestedIds);
  const db = createAdminClient();
  const { data: storedTaskData, error: storedTaskError } = await db.from("wrike_tasks")
    .select("id,wrike_id,title,raw_data,enriched_metadata,custom_fields_sync_state,custom_fields_verified_at,custom_fields_sync_diagnostics,vertical_state,last_folder_import_run_id")
    .eq("organization_id", organizationId)
    .in("wrike_id", taskIds);
  if (storedTaskError) throw new Error(`Supabase could not load diagnostic task rows: ${storedTaskError.message}`);
  const storedTasks = (storedTaskData ?? []) as TaskRow[];
  const internalIds = storedTasks.map((task) => task.id);
  const [{ data: mappings, error: mappingsError }, { data: readable, error: readableError }, { data: normalized, error: normalizedError }] = await Promise.all([
    internalIds.length ? db.from("wrike_folder_task_imports").select("task_id,folder_wrike_id,imported_at").eq("organization_id", organizationId).in("task_id", internalIds) : Promise.resolve({ data: [], error: null }),
    internalIds.length ? db.from("wrike_task_custom_field_values").select("task_id,custom_field_id,value,display_value,text_value,resolved,updated_at").in("task_id", internalIds) : Promise.resolve({ data: [], error: null }),
    internalIds.length ? db.from("wrike_task_normalized_custom_field_values").select("task_id,normalized_field_id,display_values,source_wrike_field_ids,source_titles,source_values,has_conflict,normalized_verticals,vertical_reporting_category,has_unresolved_vertical,unresolved_vertical_tokens,synced_at").in("task_id", internalIds) : Promise.resolve({ data: [], error: null })
  ]);
  const storageError = mappingsError ?? readableError ?? normalizedError;
  if (storageError) throw new Error(`Supabase could not load diagnostic relationships: ${storageError.message}`);

  const session = await wrikeSessionFor(organizationId);
  const client = new WrikeClient(session.accessToken, session.apiBaseUrl, { onUnauthorized: async () => {
    const refreshed = await refreshWrikeSessionFor(organizationId);
    return { accessToken: refreshed.accessToken, apiBaseUrl: refreshed.apiBaseUrl };
  } });

  let detailTasks: WrikeTask[] = [];
  let detailError: string | null = null;
  try {
    const response = await client.request<{ data: WrikeTask[] }>(taskDetailsPath(taskIds));
    detailTasks = response.data ?? [];
  } catch (error) { detailError = safeError(error); }

  const sourceFolderIds = [...new Set((mappings ?? []).map((mapping) => mapping.folder_wrike_id))];
  const scannedSourceFolderIds = sourceFolderIds.slice(0, SOURCE_FOLDER_LIMIT);
  const folderObservations = await Promise.all(scannedSourceFolderIds.map((folderId) => boundedFolderObservation(client, folderId, new Set(taskIds))));

  const contextIds = [...new Set([
    ...storedTasks.flatMap((task) => task.raw_data?.parentIds ?? []),
    ...detailTasks.flatMap((task) => task.parentIds ?? [])
  ])].slice(0, CONTEXT_FOLDER_LIMIT);
  let contextFolders: CustomFieldCarrier[] = [];
  let contextError: string | null = null;
  if (contextIds.length) try {
    const response = await client.request<{ data: CustomFieldCarrier[] }>(folderDetailsPath(contextIds));
    contextFolders = response.data ?? [];
  } catch (error) { contextError = safeError(error); }

  let liveDefinitions: WrikeCustomFieldDefinition[] = [];
  let definitionError: string | null = null;
  try { liveDefinitions = parseCustomFieldsResponse(await client.request<unknown>("/customfields")).data; }
  catch (error) { definitionError = safeError(error); }

  const allFieldIds = [...new Set([
    ...storedTasks.flatMap((task) => task.raw_data?.customFields?.map((field) => field.id) ?? []),
    ...detailTasks.flatMap((task) => task.customFields?.map((field) => field.id) ?? []),
    ...folderObservations.flatMap((folder) => folder.observations.flatMap((observation) => observation.payload.fields.map((field) => field.id))),
    ...contextFolders.flatMap((folder) => folder.customFields?.map((field) => field.id) ?? [])
  ])];
  const { data: storedDefinitions, error: storedDefinitionsError } = allFieldIds.length
    ? await db.from("wrike_custom_fields").select("id,wrike_id,title,field_type,is_unresolved,raw_data,synced_at,last_resolution_error").eq("organization_id", organizationId).in("wrike_id", allFieldIds)
    : { data: [], error: null };
  if (storedDefinitionsError) throw new Error(`Supabase could not load diagnostic custom-field definitions: ${storedDefinitionsError.message}`);
  const savedDefinitionById = new Map((storedDefinitions ?? []).map((field) => [field.id, field]));
  const normalizedIds = [...new Set((normalized ?? []).map((field) => field.normalized_field_id))];
  const { data: normalizedDefinitions, error: normalizedDefinitionError } = normalizedIds.length
    ? await db.from("wrike_normalized_custom_fields").select("id,normalized_key,title").eq("organization_id", organizationId).in("id", normalizedIds)
    : { data: [], error: null };
  if (normalizedDefinitionError) throw new Error(`Supabase could not load diagnostic normalized definitions: ${normalizedDefinitionError.message}`);

  const liveDefinitionById = new Map(liveDefinitions.map((field) => [field.id, field]));
  const detailById = new Map(detailTasks.map((task) => [task.id, task]));
  const internalByWrikeId = new Map(storedTasks.map((task) => [task.wrike_id, task.id]));
  return {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    limits: { taskIds: TASK_LIMIT, sourceFolders: SOURCE_FOLDER_LIMIT, pagesPerSourceFolder: FOLDER_PAGE_LIMIT, contextFolders: CONTEXT_FOLDER_LIMIT },
    requests: { taskDetail: taskDetailsPath(taskIds), sourceFolderCount: scannedSourceFolderIds.length, sourceFoldersTruncated: sourceFolderIds.length > scannedSourceFolderIds.length },
    errors: { taskDetail: detailError, customFieldDefinitions: definitionError, contextFolders: contextError },
    tasks: taskIds.map((taskId) => {
      const stored = storedTasks.find((task) => task.wrike_id === taskId);
      const internalId = internalByWrikeId.get(taskId);
      const detail = detailById.get(taskId);
      const listObservations = folderObservations.flatMap((folder) => folder.observations.filter((observation) => observation.taskId === taskId).map((observation) => ({ folderId: folder.folderId, pagesScanned: folder.pages, scanComplete: folder.scanComplete, error: folder.error, payload: observation.payload })));
      const enriched = stored?.enriched_metadata;
      const enrichedFields = Array.isArray(enriched?.customFields) ? enriched.customFields : [];
      const enrichedNormalized = Array.isArray(enriched?.customFieldsNormalized) ? enriched.customFieldsNormalized : [];
      const relevantIds = new Set([
        ...(stored?.raw_data?.customFields?.map((field) => field.id) ?? []),
        ...(detail?.customFields?.map((field) => field.id) ?? []),
        ...listObservations.flatMap((observation) => observation.payload.fields.map((field) => field.id))
      ]);
      const listIds = new Set(listObservations.flatMap((observation) => observation.payload.fields.map((field) => field.id)));
      const detailIds = new Set(detail?.customFields?.map((field) => field.id) ?? []);
      const context = contextFolders.filter((folder) => (detail?.parentIds ?? stored?.raw_data?.parentIds ?? []).includes(String(folder.id ?? ""))).map((folder) => ({ id: folder.id, title: folder.title, payload: summarizeCustomFieldPayload(folder) }));
      return {
        taskId,
        title: detail?.title ?? stored?.title ?? null,
        sourceFolders: (mappings ?? []).filter((mapping) => mapping.task_id === internalId).map((mapping) => ({ folderId: mapping.folder_wrike_id, importedAt: mapping.imported_at })),
        acquisition: {
          persistedImportEvidence: stored?.custom_fields_sync_diagnostics ?? null,
          liveFolderObservations: listObservations,
          liveTaskDetail: detail ? summarizeCustomFieldPayload(detail) : null,
          contextFolders: context
        },
        selection: {
          listObservationDisagreement: new Set(listObservations.map((observation) => observation.payload.fingerprint)).size > 1,
          detailAddsFieldIds: [...detailIds].filter((id) => !listIds.has(id)).sort(),
          listOnlyFieldIds: [...listIds].filter((id) => !detailIds.has(id)).sort(),
          storedSelectedSource: stored?.custom_fields_sync_diagnostics?.selectedSource ?? null
        },
        storage: {
          rawData: stored?.raw_data ? summarizeCustomFieldPayload(stored.raw_data) : null,
          syncState: stored?.custom_fields_sync_state ?? null,
          verifiedAt: stored?.custom_fields_verified_at ?? null,
          verticalState: stored?.vertical_state ?? null,
          importRunId: stored?.last_folder_import_run_id ?? null,
          readableValues: (readable ?? []).filter((field) => field.task_id === internalId).map((field) => ({ ...field, value: safeValue(field.value), display_value: safeValue(field.display_value), definition: savedDefinitionById.get(field.custom_field_id)?.title ?? null })),
          normalizedValues: (normalized ?? []).filter((field) => field.task_id === internalId).map((field) => ({ ...field, source_values: safeValue(field.source_values), definition: (normalizedDefinitions ?? []).find((definition) => definition.id === field.normalized_field_id) ?? null })),
          enrichedCustomFields: safeValue(enrichedFields),
          enrichedNormalizedCustomFields: safeValue(enrichedNormalized)
        },
        definitions: [...relevantIds].sort().map((id) => {
          const saved = (storedDefinitions ?? []).find((field) => field.wrike_id === id);
          const live = liveDefinitionById.get(id);
          return {
            id,
            live: live ? definitionEvidence(live) : null,
            stored: saved ? { title: saved.title, type: saved.field_type, unresolved: saved.is_unresolved, syncedAt: saved.synced_at, lastResolutionError: saved.last_resolution_error, scope: saved.raw_data && typeof saved.raw_data === "object" ? definitionEvidence(saved.raw_data as Record<string, unknown>) : null } : null
          };
        })
      };
    })
  };
}
