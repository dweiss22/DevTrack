import { createAdminClient } from "@/lib/supabase/admin";
import { WrikeClient } from "@/lib/wrike/client";
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
import { wrikeSessionFor } from "@/lib/wrike/oauth";
import { allocatedMinutes, plannedMinutes } from "@/lib/wrike/sync";
import type { WrikeCustomFieldDefinition, WrikeFolderDefinition, WrikeTask } from "@/lib/wrike/types";

export const TASK_IMPORT_FOLDER_IDS = [
  "IEACHQK7I4UOEPFL",
  "IEACHQK7I4PGHAIF",
  "IEACHQK7I4QUZOFS",
  "IEACHQK7I45QZU3G",
  "IEACHQK7I4PGHAD7",
  "IEACHQK7I4SCO46Z",
  "IEACHQK7I4PGHBAC",
  "IEACHQK7I4N7GGRM",
  "IEACHQK7I4PGHACI",
  "IEACHQK7I4N7GGQ4",
  "IEACHQK7I4PGG7Z2",
  "IEACHQK7I4SCPAAB",
  "IEACHQK7I4N7GGRB"
] as const;

export const FOLDER_METADATA_ROOT_ID = "IEACHQK7I46YBWEN";
export const EXPECTED_LCT_FIELD_ID = "IEACHQK7JUAHNWFH";
const TASK_FIELDS = ["description", "responsibleIds", "parentIds", "superTaskIds", "subTaskIds", "customFields", "authorIds", "effortAllocation"];
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
};

export function folderTasksPath(folderId: string) {
  const params = new URLSearchParams({ descendants: "true", subTasks: "true", fields: JSON.stringify(TASK_FIELDS) });
  return `/folders/${encodeURIComponent(folderId)}/tasks?${params}`;
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
  const customFieldDefinitionsById = buildCustomFieldDefinitionsById(matchedFields);
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
  return { folderDefinitions: folderResponse.data, folderDefinitionsById, matchedFields, customFieldDefinitionsById, diagnostics };
}

export async function validateBeforeReset<T>(loadAndValidate: () => Promise<T>, reset: () => Promise<void>) {
  const validated = await loadAndValidate();
  await reset();
  return validated;
}

export async function importConfiguredFolderTasks(organizationId: string) {
  const db = createAdminClient();
  const leaseToken = crypto.randomUUID();
  const { data: claimed, error: leaseError } = await db.rpc("claim_wrike_sync_lease", { target_organization_id: organizationId, target_token: leaseToken, lease_minutes: 30 });
  if (leaseError) throw new Error(`Unable to acquire the import lock: ${leaseError.message}`);
  if (!claimed) throw new Error("Another Wrike import is already running. Wait for it to finish before trying again.");

  try {
    return await runFolderTaskImport(db, organizationId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown folder task import failure.";
    await db.from("wrike_folder_task_import_runs").insert({ organization_id: organizationId, status: "failed", error_summary: message.slice(0, 1000) });
    throw error;
  } finally {
    await db.rpc("release_wrike_sync_lease", { target_organization_id: organizationId, target_token: leaseToken });
  }
}

async function runFolderTaskImport(db: ReturnType<typeof createAdminClient>, organizationId: string) {
  const session = await wrikeSessionFor(organizationId);
  const client = new WrikeClient(session.accessToken, session.apiBaseUrl);
  const { metadata, byFolder, tasks, enrichedByTaskId } = await validateBeforeReset(async () => {
    const metadata = await fetchValidatedMetadata(client);
    const byFolder = new Map<string, WrikeTask[]>();
    const uniqueTasks = new Map<string, WrikeTask>();
    for (const folderId of TASK_IMPORT_FOLDER_IDS) {
      try {
        const folderTasks = await client.all<WrikeTask>(folderTasksPath(folderId));
        byFolder.set(folderId, folderTasks);
        folderTasks.forEach((task) => uniqueTasks.set(task.id, task));
      } catch (error) {
        throw new Error(`Wrike folder ${folderId} failed: ${error instanceof Error ? error.message : "Unknown Wrike error"}`);
      }
    }
    const tasks = [...uniqueTasks.values()];
    const enrichedByTaskId = new Map(tasks.map((task) => [task.id, enrichTaskMetadata(task, metadata.folderDefinitionsById, metadata.customFieldDefinitionsById)]));
    return { metadata, byFolder, tasks, enrichedByTaskId };
  }, async () => {
    const { error: resetError } = await db.rpc("reset_wrike_reporting_data", { target_organization_id: organizationId });
    if (resetError) throw new Error("Unable to reset existing Wrike data. Apply migrations through 202607160005 first.");
  });

  const importedAt = new Date().toISOString();
  const parentIdsByFolderId = new Map<string, string[]>();
  for (const parent of metadata.folderDefinitions) for (const childId of parent.childIds) parentIdsByFolderId.set(childId, [...(parentIdsByFolderId.get(childId) ?? []), parent.id]);

  const folderIdMap = new Map<string, string>();
  for (let offset = 0; offset < metadata.folderDefinitions.length; offset += 250) {
    const rows = metadata.folderDefinitions.slice(offset, offset + 250).map((folder) => ({
      organization_id: organizationId,
      wrike_id: folder.id,
      title: folder.title,
      parent_wrike_ids: parentIdsByFolderId.get(folder.id) ?? [],
      child_wrike_ids: folder.childIds,
      scope: folder.scope,
      is_project: Boolean(folder.project),
      raw_data: folder,
      deleted_at: null,
      updated_at: importedAt
    }));
    const { data, error } = await db.from("wrike_folders").upsert(rows, { onConflict: "organization_id,wrike_id" }).select("id,wrike_id");
    if (error) throw new Error(`Supabase could not save Wrike folder metadata: ${error.message}`);
    (data ?? []).forEach((folder) => folderIdMap.set(folder.wrike_id, folder.id));
  }

  const projectDefinitions = metadata.folderDefinitions.filter((folder): folder is WrikeFolderDefinition & { project: NonNullable<WrikeFolderDefinition["project"]> } => Boolean(folder.project));
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

  const { data: savedFields, error: fieldError } = await db.from("wrike_custom_fields").upsert(metadata.matchedFields.map((field) => ({
    organization_id: organizationId,
    wrike_id: field.id,
    title: field.title,
    field_type: field.type,
    raw_data: field,
    updated_at: importedAt
  })), { onConflict: "organization_id,wrike_id" }).select("id,wrike_id");
  if (fieldError) throw new Error(`Supabase could not save Wrike custom-field metadata: ${fieldError.message}`);
  const customFieldIdMap = new Map((savedFields ?? []).map((field) => [field.wrike_id, field.id]));
  if ((savedFields ?? []).length) {
    const { error } = await db.from("wrike_enabled_custom_fields").upsert((savedFields ?? []).map((field) => ({ organization_id: organizationId, custom_field_id: field.id })), { onConflict: "organization_id,custom_field_id" });
    if (error) throw new Error(`Supabase could not enable LCT custom fields: ${error.message}`);
  }

  const taskIdMap = new Map<string, string>();
  for (let offset = 0; offset < tasks.length; offset += 250) {
    const batch = tasks.slice(offset, offset + 250);
    const rows = batch.map((task) => ({
      organization_id: organizationId,
      wrike_id: task.id,
      title: task.title,
      description: task.description ?? null,
      permalink: task.permalink ?? null,
      status: task.status,
      workflow_id: task.workflowId ?? null,
      custom_status_id: task.customStatusId ?? null,
      importance: task.importance ?? null,
      created_at_wrike: iso(task.createdDate),
      updated_at_wrike: iso(task.updatedDate),
      start_date: day(task.dates?.start),
      due_date: day(task.dates?.due),
      completed_at: iso(task.dates?.completed),
      parent_wrike_ids: task.parentIds ?? [],
      super_task_wrike_ids: task.superTaskIds ?? [],
      task_type: task.dates?.type ?? null,
      planned_minutes: plannedMinutes(task),
      allocated_minutes: allocatedMinutes(task),
      raw_data: task,
      enriched_metadata: enrichedByTaskId.get(task.id),
      is_deleted: false,
      last_seen_at: importedAt,
      updated_at: importedAt
    }));
    const { data, error } = await db.from("wrike_tasks").upsert(rows, { onConflict: "organization_id,wrike_id" }).select("id,wrike_id");
    if (error) throw new Error(`Supabase could not save Wrike tasks: ${error.message}`);
    (data ?? []).forEach((task) => taskIdMap.set(task.wrike_id, task.id));
  }

  const locations = tasks.flatMap((task) => (task.parentIds ?? []).flatMap((wrikeLocationId) => {
    const taskId = taskIdMap.get(task.id);
    return taskId ? [{ task_id: taskId, folder_id: folderIdMap.get(wrikeLocationId) ?? null, project_id: projectIdMap.get(wrikeLocationId) ?? null, wrike_location_id: wrikeLocationId }] : [];
  }));
  for (let offset = 0; offset < locations.length; offset += 500) {
    const { error } = await db.from("wrike_task_locations").upsert(locations.slice(offset, offset + 500), { onConflict: "task_id,wrike_location_id" });
    if (error) throw new Error(`Supabase could not save task folder locations: ${error.message}`);
  }

  const customValues = tasks.flatMap((task) => (enrichedByTaskId.get(task.id)?.customFields ?? []).flatMap((field) => {
    const taskId = taskIdMap.get(task.id); const customFieldId = customFieldIdMap.get(field.id);
    if (!taskId || !customFieldId || !field.resolved || field.rawValue == null) return [];
    return [{
      task_id: taskId,
      custom_field_id: customFieldId,
      value: field.rawValue,
      display_value: field.displayValue,
      text_value: displayText(field.displayValue),
      option_ids: [],
      option_values: optionValues(field),
      resolved: true,
      updated_at: importedAt
    }];
  }));
  for (let offset = 0; offset < customValues.length; offset += 500) {
    const { error } = await db.from("wrike_task_custom_field_values").upsert(customValues.slice(offset, offset + 500), { onConflict: "task_id,custom_field_id" });
    if (error) throw new Error(`Supabase could not save readable custom-field values: ${error.message}`);
  }

  const mappings = [...byFolder.entries()].flatMap(([folderId, folderTasks]) => folderTasks.flatMap((task) => {
    const taskId = taskIdMap.get(task.id);
    return taskId ? [{ organization_id: organizationId, folder_wrike_id: folderId, folder_id: folderIdMap.get(folderId) ?? null, task_id: taskId, imported_at: importedAt }] : [];
  }));
  for (let offset = 0; offset < mappings.length; offset += 500) {
    const { error } = await db.from("wrike_folder_task_imports").upsert(mappings.slice(offset, offset + 500), { onConflict: "organization_id,folder_wrike_id,task_id" });
    if (error) throw new Error(`Supabase could not save folder membership: ${error.message}`);
  }

  const folderCounts = Object.fromEntries([...byFolder.entries()].map(([folderId, folderTasks]) => [folderId, folderTasks.length]));
  const { error: runError } = await db.from("wrike_folder_task_import_runs").insert({
    organization_id: organizationId,
    status: "succeeded",
    folder_counts: folderCounts,
    task_count: tasks.length,
    folder_definition_count: metadata.folderDefinitions.length,
    custom_field_definition_count: metadata.matchedFields.length,
    metadata_diagnostics: metadata.diagnostics
  });
  if (runError) throw new Error(`Tasks were saved, but the import summary failed: ${runError.message}`);
  return {
    taskCount: tasks.length,
    folderCounts,
    folderCount: TASK_IMPORT_FOLDER_IDS.length,
    folderDefinitionCount: metadata.folderDefinitions.length,
    customFieldDefinitionCount: metadata.matchedFields.length,
    matchedCustomFieldTitles: metadata.diagnostics.matchedFieldTitles,
    unfilteredFallbackRequired: metadata.diagnostics.unfilteredFallbackRequired,
    metadataDiagnostics: metadata.diagnostics
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
