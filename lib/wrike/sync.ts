import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { persistNormalizedCustomFieldDefinitions, persistNormalizedTaskCustomFields } from "@/lib/wrike/custom-field-persistence";
import { mergeNormalizedCustomFields } from "@/lib/wrike/custom-field-normalization";
import { wrikeSessionFor } from "@/lib/wrike/oauth";
import { WrikeClient } from "@/lib/wrike/client";
import { WRIKE_TASK_FIELDS } from "@/lib/wrike/task-fields";
import { isOutOfScopeWrikeFolder, scopedWrikeFolderIds } from "@/lib/wrike/selected-folders";
import type { WrikeCustomField, WrikeFolder, WrikeTask, WrikeTimeEntry, WrikeTimelogCategory, WrikeUser, WrikeWorkflow } from "@/lib/wrike/types";

export type SyncMode = "incremental" | "full";
type Trigger = "manual" | "scheduled" | "backfill";
type Scope = { id: string; scope_type: "account" | "space" | "folder" | "project" | "task" | "list"; source_ids: string[]; label: string };
type SyncOptions = { scopeIds?: string[]; mode?: SyncMode; trigger?: Trigger };

const nowIso = () => new Date().toISOString();
const date = (value?: string) => value ? new Date(value).toISOString() : null;
const day = (value?: string) => value ? value.slice(0, 10) : null;
export const entryMinutes = (entry: WrikeTimeEntry) => entry.minutes ?? Math.round((entry.hours ?? 0) * 60);
export const plannedMinutes = (task: WrikeTask) => typeof task.effortAllocation?.totalEffort === "number" ? Math.round(task.effortAllocation.totalEffort) : null;
export const allocatedMinutes = (task: WrikeTask) => typeof task.effortAllocation?.allocatedEffort === "number" ? Math.round(task.effortAllocation.allocatedEffort) : null;

const appendQuery = (path: string, values: Record<string, string | undefined>) => {
  const params = Object.entries(values).filter((entry): entry is [string, string] => Boolean(entry[1])).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
  return params ? `${path}${path.includes("?") ? "&" : "?"}${params}` : path;
};

export function taskPath(scope: Scope, sinceAt?: string) {
  const id = scope.source_ids[0];
  const base = scope.scope_type === "account" ? "/tasks"
    : scope.scope_type === "space" ? `/spaces/${encodeURIComponent(id)}/tasks`
    : scope.scope_type === "folder" || scope.scope_type === "project" ? `/folders/${encodeURIComponent(id)}/tasks`
    : `/tasks/${scope.source_ids.map(encodeURIComponent).join(",")}`;
  const searchable = ["account", "space", "folder", "project"].includes(scope.scope_type);
  return appendQuery(base, {
    fields: JSON.stringify(WRIKE_TASK_FIELDS),
    descendants: searchable && scope.scope_type !== "account" ? "true" : undefined,
    subTasks: searchable ? "true" : undefined,
    updatedDate: searchable && sinceAt ? JSON.stringify({ start: sinceAt }) : undefined
  });
}

async function fetchTaskTree(client: WrikeClient, rootIds: string[]) {
  const tasks: WrikeTask[] = [];
  const seen = new Set<string>();
  let pending = [...rootIds];
  while (pending.length) {
    const batch = pending.splice(0, 100).filter((id) => !seen.has(id));
    if (!batch.length) continue;
    batch.forEach((id) => seen.add(id));
    const response = await client.request<{ data: WrikeTask[] }>(appendQuery(`/tasks/${batch.map(encodeURIComponent).join(",")}`, { fields: JSON.stringify(WRIKE_TASK_FIELDS) }));
    tasks.push(...response.data);
    pending.push(...response.data.flatMap((task) => task.subTaskIds ?? []).filter((id) => !seen.has(id)));
  }
  return tasks;
}

async function fetchExactTasks(client: WrikeClient, taskIds: string[]) {
  const tasks: WrikeTask[] = [];
  for (let offset = 0; offset < taskIds.length; offset += 100) {
    const batch = taskIds.slice(offset, offset + 100);
    if (!batch.length) continue;
    const response = await client.request<{ data: WrikeTask[] }>(appendQuery(`/tasks/${batch.map(encodeURIComponent).join(",")}`, { fields: JSON.stringify(WRIKE_TASK_FIELDS) }));
    tasks.push(...response.data);
  }
  return tasks;
}

async function latestSince(db: ReturnType<typeof createAdminClient>, scopeId: string) {
  const { data } = await db.from("wrike_sync_runs").select("completed_at").eq("scope_id", scopeId).in("status", ["succeeded", "partial"]).order("completed_at", { ascending: false }).limit(1).maybeSingle();
  if (!data?.completed_at) return undefined;
  return new Date(new Date(data.completed_at).getTime() - 5 * 60_000).toISOString();
}

async function upsertUsers(organizationId: string, accountId: string | null, users: WrikeUser[]) {
  const db = createAdminClient();
  if (!users.length) return new Map<string, string>();
  const { data, error } = await db.from("wrike_users").upsert(users.map((user) => ({
    organization_id: organizationId,
    wrike_id: user.id,
    first_name: user.firstName ?? null,
    last_name: user.lastName ?? null,
    display_name: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.id,
    email: (user.profiles?.find((profile) => profile.accountId === accountId) ?? user.profiles?.[0])?.email ?? null,
    raw_data: user,
    is_active: !user.deleted,
    deleted_at: user.deleted ? nowIso() : null,
    updated_at: nowIso()
  })), { onConflict: "organization_id,wrike_id" }).select("id,wrike_id");
  if (error) throw error;
  return new Map((data ?? []).map((user) => [user.wrike_id, user.id]));
}

async function upsertMetadata(organizationId: string, client: WrikeClient, accountId: string | null) {
  const db = createAdminClient();
  const [users, spacesResponse, folders, workflowsResponse, customFieldsResponse, categoriesResponse] = await Promise.all([
    client.all<WrikeUser>("/contacts"),
    client.request<{ data: { id: string; title: string }[] }>("/spaces"),
    client.all<WrikeFolder>("/folders"),
    client.request<{ data: WrikeWorkflow[] }>("/workflows"),
    client.request<{ data: WrikeCustomField[] }>("/customfields"),
    client.request<{ data: WrikeTimelogCategory[] }>("/timelog_categories")
  ]);
  const spaces = spacesResponse.data; const workflows = workflowsResponse.data; const customFields = customFieldsResponse.data; const categories = categoriesResponse.data;
  const userMap = await upsertUsers(organizationId, accountId, users);
  const { data: savedSpaces, error: spaceError } = spaces.length ? await db.from("wrike_spaces").upsert(spaces.map((space) => ({ organization_id: organizationId, wrike_id: space.id, title: space.title, raw_data: space, updated_at: nowIso() })), { onConflict: "organization_id,wrike_id" }).select("id,wrike_id") : { data: [], error: null };
  if (spaceError) throw spaceError;
  const spaceMap = new Map((savedSpaces ?? []).map((space) => [space.wrike_id, space.id]));
  const scopedFolders = folders.filter((folder) => !isOutOfScopeWrikeFolder(folder.id));
  const { data: savedFolders, error: folderError } = scopedFolders.length ? await db.from("wrike_folders").upsert(scopedFolders.map((folder) => ({ organization_id: organizationId, wrike_id: folder.id, space_id: spaceMap.get(folder.id) ?? (folder.parentIds ?? []).map((parentId) => spaceMap.get(parentId)).find(Boolean) ?? null, title: folder.title, parent_wrike_ids: scopedWrikeFolderIds(folder.parentIds), is_project: Boolean(folder.project), raw_data: folder, updated_at: nowIso() })), { onConflict: "organization_id,wrike_id" }).select("id,wrike_id,is_project") : { data: [], error: null };
  if (folderError) throw folderError;
  const folderMap = new Map((savedFolders ?? []).map((folder) => [folder.wrike_id, folder.id]));
  const projectFolders = folders.filter((folder) => folder.project);
  const { data: savedProjects, error: projectError } = projectFolders.length ? await db.from("wrike_projects").upsert(projectFolders.map((folder) => ({ organization_id: organizationId, wrike_id: folder.id, folder_id: folderMap.get(folder.id), title: folder.title, status: folder.project?.status ?? null, owner_wrike_ids: folder.project?.ownerIds ?? [], raw_data: folder, updated_at: nowIso() })), { onConflict: "organization_id,wrike_id" }).select("id,wrike_id") : { data: [], error: null };
  if (projectError) throw projectError;
  const projectMap = new Map((savedProjects ?? []).map((project) => [project.wrike_id, project.id]));
  const statusRows = workflows.flatMap((workflow) => (workflow.customStatuses ?? []).map((status) => ({ organization_id: organizationId, wrike_id: status.id, workflow_id: workflow.id, title: status.name, status_group: status.group ?? null, raw_data: status, updated_at: nowIso() })));
  if (statusRows.length) { const { error } = await db.from("wrike_workflow_statuses").upsert(statusRows, { onConflict: "organization_id,wrike_id" }); if (error) throw error; }
  if (categories.length) { const { error } = await db.from("wrike_timelog_categories").upsert(categories.map((category) => ({ organization_id: organizationId, wrike_id: category.id, title: category.name ?? category.title ?? category.id, raw_data: category, updated_at: nowIso() })), { onConflict: "organization_id,wrike_id" }); if (error) throw error; }
  const { data: savedFields, error: customError } = customFields.length ? await db.from("wrike_custom_fields").upsert(customFields.map((field) => ({ organization_id: organizationId, wrike_id: field.id, title: field.title, field_type: field.type ?? null, raw_data: field, updated_at: nowIso() })), { onConflict: "organization_id,wrike_id" }).select("id,wrike_id,title,field_type") : { data: [], error: null };
  if (customError) throw customError;
  const normalizedFieldIdByKey = await persistNormalizedCustomFieldDefinitions(db, organizationId, savedFields ?? [], nowIso());
  const { data: enabled } = await db.from("wrike_enabled_custom_fields").select("custom_field_id").eq("organization_id", organizationId);
  if (!(enabled ?? []).length) {
    const lct = (savedFields ?? []).find((field) => field.title.trim().toLowerCase() === "[lct]");
    if (lct) await db.from("wrike_enabled_custom_fields").upsert({ organization_id: organizationId, custom_field_id: lct.id }, { onConflict: "organization_id,custom_field_id" });
  }
  const { data: enabledAfter } = await db.from("wrike_enabled_custom_fields").select("custom_field_id,wrike_custom_fields(id,wrike_id,field_type,raw_data)").eq("organization_id", organizationId);
  const enabledFieldMap = new Map<string, { id: string; type: string | null; title: string; options: Map<string,string> }>();
  for (const row of enabledAfter ?? []) {
    const field = row.wrike_custom_fields as unknown as { id: string; wrike_id: string; field_type: string | null; title?: string; raw_data: WrikeCustomField } | null;
    if (field) {
      const readableValues = [
        ...(field.raw_data.settings?.values ?? []),
        ...(field.raw_data.settings?.options ?? []).map((option) => option.value)
      ];
      enabledFieldMap.set(field.wrike_id, { id: field.id, type: field.field_type, title: field.title ?? field.raw_data.title, options: new Map(readableValues.map((value) => [value, value])) });
    }
  }
  return { userMap, spaceMap, folderMap, projectMap, enabledFieldMap, normalizedFieldIdByKey, userCount: users.length };
}

function normalizedCustomValue(value: unknown, type: string | null, options = new Map<string,string>()) {
  const scalar = Array.isArray(value) ? value.map(String) : value == null ? [] : [String(value)];
  const lowered = (type ?? "").toLowerCase();
  const numberValue = lowered.includes("numeric") || lowered.includes("currency") || lowered.includes("percentage") ? Number(scalar[0]) : Number.NaN;
  const dateValue = lowered.includes("date") && /^\d{4}-\d{2}-\d{2}/.test(scalar[0] ?? "") ? scalar[0].slice(0, 10) : null;
  return {
    text_value: scalar.map((item) => options.get(item) ?? item).join(", ") || null,
    numeric_value: Number.isFinite(numberValue) ? numberValue : null,
    date_value: dateValue,
    display_value: Array.isArray(value) ? scalar.map((item) => options.get(item) ?? item) : scalar.length ? options.get(scalar[0]) ?? scalar[0] : null,
    option_ids: [],
    option_values: lowered.includes("drop") || lowered.includes("select") ? scalar : [],
    resolved: true
  };
}

async function replaceTaskRelationships(organizationId: string, tasks: WrikeTask[], taskMap: Map<string, string>, metadata: Awaited<ReturnType<typeof upsertMetadata>>) {
  const db = createAdminClient();
  const taskIds = [...taskMap.values()];
  if (!taskIds.length) return [];
  await Promise.all([
    db.from("wrike_task_assignees").delete().in("task_id", taskIds),
    db.from("wrike_task_locations").delete().in("task_id", taskIds),
    db.from("wrike_task_custom_field_values").delete().in("task_id", taskIds)
  ]);
  const assignments = tasks.flatMap((task) => (task.responsibleIds ?? []).flatMap((wrikeUserId) => metadata.userMap.get(wrikeUserId) ? [{ task_id: taskMap.get(task.id), user_id: metadata.userMap.get(wrikeUserId), assignment_type: "assignee" }] : []));
  if (assignments.length) { const { error } = await db.from("wrike_task_assignees").insert(assignments); if (error) throw error; }
  const locations = tasks.flatMap((task) => scopedWrikeFolderIds(task.parentIds).map((parentId) => ({ task_id: taskMap.get(task.id), folder_id: metadata.folderMap.get(parentId) ?? null, project_id: metadata.projectMap.get(parentId) ?? null, wrike_location_id: parentId })));
  if (locations.length) { const { error } = await db.from("wrike_task_locations").upsert(locations, { onConflict: "task_id,wrike_location_id" }); if (error) throw error; }
  const values = tasks.flatMap((task) => (task.customFields ?? []).flatMap((fieldValue) => {
    const field = metadata.enabledFieldMap.get(fieldValue.id); const taskId = taskMap.get(task.id);
    return field && taskId ? [{ task_id: taskId, custom_field_id: field.id, value: fieldValue.value, ...normalizedCustomValue(fieldValue.value, field.type, field.options), updated_at: nowIso() }] : [];
  }));
  if (values.length) { const { error } = await db.from("wrike_task_custom_field_values").upsert(values, { onConflict: "task_id,custom_field_id" }); if (error) throw error; }
  await persistNormalizedTaskCustomFields(db, metadata.normalizedFieldIdByKey, tasks.flatMap((task) => {
    const taskId = taskMap.get(task.id); if (!taskId) return [];
    const fields = (task.customFields ?? []).flatMap((fieldValue) => {
      const field = metadata.enabledFieldMap.get(fieldValue.id); if (!field) return [];
      const normalized = normalizedCustomValue(fieldValue.value, field.type, field.options);
      return [{ id: fieldValue.id, title: field.title, type: field.type, rawValue: fieldValue.value, displayValue: normalized.display_value, resolved: true }];
    });
    return [{ taskId, taskWrikeId: task.id, fields: mergeNormalizedCustomFields(fields) }];
  }), nowIso());
  return taskIds;
}

async function saveScopeTasks(organizationId: string, scope: Scope, tasks: WrikeTask[], mode: SyncMode, metadata: Awaited<ReturnType<typeof upsertMetadata>>) {
  const db = createAdminClient();
  const rows = tasks.map((task) => ({ organization_id: organizationId, wrike_id: task.id, title: task.title, description: task.description ?? null, permalink: task.permalink ?? null, status: task.status, workflow_id: task.workflowId ?? null, custom_status_id: task.customStatusId ?? null, responsible_wrike_ids: task.responsibleIds ?? [], importance: task.importance ?? null, created_at_wrike: date(task.createdDate), updated_at_wrike: date(task.updatedDate), start_date: day(task.dates?.start), due_date: day(task.dates?.due), completed_at: date(task.dates?.completed), parent_wrike_ids: scopedWrikeFolderIds(task.parentIds), super_task_wrike_ids: task.superTaskIds ?? [], task_type: task.dates?.type ?? null, planned_minutes: plannedMinutes(task), allocated_minutes: allocatedMinutes(task), raw_data: task, is_deleted: false, last_seen_at: nowIso(), updated_at: nowIso() }));
  const { data: saved, error } = rows.length ? await db.from("wrike_tasks").upsert(rows, { onConflict: "organization_id,wrike_id" }).select("id,wrike_id") : { data: [], error: null };
  if (error) throw error;
  const taskMap = new Map((saved ?? []).map((task) => [task.wrike_id, task.id]));
  await replaceTaskRelationships(organizationId, tasks, taskMap, metadata);
  const links = [...taskMap.values()].map((taskId) => ({ scope_id: scope.id, task_id: taskId, last_seen_at: nowIso() }));
  if (links.length) { const { error: linkError } = await db.from("wrike_scope_tasks").upsert(links, { onConflict: "scope_id,task_id" }); if (linkError) throw linkError; }
  if (mode === "full") {
    const { data: currentLinks } = await db.from("wrike_scope_tasks").select("task_id").eq("scope_id", scope.id);
    const keep = new Set([...taskMap.values()]);
    const stale = (currentLinks ?? []).map((link) => link.task_id).filter((taskId) => !keep.has(taskId));
    if (stale.length) await db.from("wrike_scope_tasks").delete().eq("scope_id", scope.id).in("task_id", stale);
  }
  return taskMap;
}

async function syncTimelogs(organizationId: string, client: WrikeClient, metadata: Awaited<ReturnType<typeof upsertMetadata>>, sinceAt: string | undefined, full: boolean) {
  const db = createAdminClient();
  const { data: knownTasks, error: taskError } = await db.from("wrike_tasks").select("id,wrike_id").eq("organization_id", organizationId);
  if (taskError) throw taskError;
  const taskMap = new Map((knownTasks ?? []).map((task) => [task.wrike_id, task.id]));
  const path = appendQuery("/timelogs", { updatedDate: sinceAt ? JSON.stringify({ start: sinceAt }) : undefined, plainText: "true" });
  const entries = await client.all<WrikeTimeEntry>(path);
  const relevant = entries.filter((entry) => taskMap.has(entry.taskId));
  const rows = relevant.map((entry) => ({ organization_id: organizationId, wrike_id: entry.id, task_id: taskMap.get(entry.taskId), user_id: entry.userId ? metadata.userMap.get(entry.userId) ?? null : null, entry_date: day(entry.trackedDate), minutes: entryMinutes(entry), category: entry.categoryId ?? null, comment: entry.comment ?? null, created_at_wrike: date(entry.createdDate), updated_at_wrike: date(entry.updatedDate), raw_data: entry, is_deleted: false, updated_at: nowIso() }));
  if (rows.length) { const { error } = await db.from("wrike_time_entries").upsert(rows, { onConflict: "organization_id,wrike_id" }); if (error) throw error; }
  if (full) {
    const scopedTaskIds = new Set<string>();
    const { data: links } = await db.from("wrike_scope_tasks").select("task_id,wrike_sync_scopes!inner(is_active)").eq("wrike_sync_scopes.is_active", true);
    (links ?? []).forEach((link) => scopedTaskIds.add(link.task_id));
    const { data: savedEntries } = await db.from("wrike_time_entries").select("id,wrike_id,task_id").eq("organization_id", organizationId).eq("is_deleted", false);
    const seen = new Set(relevant.map((entry) => entry.id));
    const stale = (savedEntries ?? []).filter((entry) => scopedTaskIds.has(entry.task_id) && !seen.has(entry.wrike_id)).map((entry) => entry.id);
    if (stale.length) await db.from("wrike_time_entries").update({ is_deleted: true, updated_at: nowIso() }).in("id", stale);
  }
  return relevant.length;
}

async function markOrphanedTasksDeleted(organizationId: string) {
  const db = createAdminClient();
  const { data: tasks } = await db.from("wrike_tasks").select("id").eq("organization_id", organizationId).eq("is_deleted", false);
  const { data: links } = await db.from("wrike_scope_tasks").select("task_id,wrike_sync_scopes!inner(is_active)").eq("wrike_sync_scopes.is_active", true);
  const linked = new Set((links ?? []).map((link) => link.task_id));
  const orphaned = (tasks ?? []).map((task) => task.id).filter((taskId) => !linked.has(taskId));
  if (orphaned.length) await db.from("wrike_tasks").update({ is_deleted: true, updated_at: nowIso() }).in("id", orphaned);
}

export async function syncOrganization(organizationId: string, options: SyncOptions = {}) {
  const db = createAdminClient();
  const mode = options.mode ?? "incremental";
  const trigger = options.trigger ?? "manual";
  const leaseToken = crypto.randomUUID();
  const { data: claimed, error: leaseError } = await db.rpc("claim_wrike_sync_lease", { target_organization_id: organizationId, target_token: leaseToken, lease_minutes: 45 });
  if (leaseError || !claimed) throw new Error("A Wrike synchronization is already running for this organization.");
  const runs = new Map<string, string>();
  const results: { scopeId: string; tasks: number; status: string; error?: string }[] = [];
  const renewLease = async () => {
    const { data, error } = await db.rpc("claim_wrike_sync_lease", { target_organization_id: organizationId, target_token: leaseToken, lease_minutes: 45 });
    if (error || !data) throw new Error("The Wrike synchronization lease could not be renewed.");
  };
  try {
    let scopeQuery = db.from("wrike_sync_scopes").select("id,scope_type,source_ids,label").eq("organization_id", organizationId).eq("is_active", true);
    if (options.scopeIds?.length) scopeQuery = scopeQuery.in("id", options.scopeIds);
    const { data: scopes, error: scopeError } = await scopeQuery;
    if (scopeError) throw scopeError;
    if (!(scopes ?? []).length) throw new Error("No active Wrike sync scopes were found.");
    for (const scope of scopes as Scope[]) {
      const sinceAt = mode === "incremental" ? await latestSince(db, scope.id) : null;
      const { data: run, error } = await db.from("wrike_sync_runs").insert({ organization_id: organizationId, scope_id: scope.id, trigger, sync_mode: mode, status: "running", since_at: sinceAt }).select("id").single();
      if (error || !run) throw error ?? new Error("Unable to create a sync run.");
      runs.set(scope.id, run.id);
    }
    const session = await wrikeSessionFor(organizationId);
    const client = new WrikeClient(session.accessToken, session.apiBaseUrl);
    const metadata = await upsertMetadata(organizationId, client, session.connection.wrike_account_id ?? null);
    const sinceValues: string[] = [];
    for (const scope of scopes as Scope[]) {
      const runId = runs.get(scope.id)!;
      try {
        await renewLease();
        const sinceAt = mode === "incremental" ? await latestSince(db, scope.id) : undefined;
        if (sinceAt) sinceValues.push(sinceAt);
        const tasks = scope.scope_type === "task" ? await fetchTaskTree(client, scope.source_ids)
          : scope.scope_type === "list" ? await fetchExactTasks(client, scope.source_ids)
          : await client.all<WrikeTask>(taskPath(scope, sinceAt));
        await saveScopeTasks(organizationId, scope, tasks, mode, metadata);
        results.push({ scopeId: scope.id, tasks: tasks.length, status: "succeeded" });
        await db.from("wrike_sync_runs").update({ status: "succeeded", completed_at: nowIso(), record_counts: { tasks: tasks.length, users: metadata.userCount } }).eq("id", runId);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected scope failure";
        results.push({ scopeId: scope.id, tasks: 0, status: "failed", error: message });
        await db.from("wrike_sync_runs").update({ status: "failed", completed_at: nowIso(), error_summary: message }).eq("id", runId);
      }
    }
    const earliestSince = mode === "incremental" && sinceValues.length ? sinceValues.sort()[0] : undefined;
    let timeEntries = 0;
    try {
      await renewLease();
      timeEntries = await syncTimelogs(organizationId, client, metadata, earliestSince, mode === "full");
      for (const result of results.filter((item) => item.status === "succeeded")) {
        const runId = runs.get(result.scopeId)!;
        await db.from("wrike_sync_runs").update({ record_counts: { tasks: result.tasks, users: metadata.userCount, timeEntries } }).eq("id", runId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Timelog synchronization failed";
      for (const result of results.filter((item) => item.status === "succeeded")) {
        result.status = "partial"; result.error = message;
        await db.from("wrike_sync_runs").update({ status: "partial", error_summary: message, errors: [message] }).eq("id", runs.get(result.scopeId)!);
      }
    }
    if (mode === "full") await markOrphanedTasksDeleted(organizationId);
    return { mode, scopes: results, tasks: results.reduce((sum, result) => sum + result.tasks, 0), users: metadata.userCount, timeEntries, failures: results.filter((result) => result.status !== "succeeded").map((result) => result.error ?? "Sync failed") };
  } finally {
    await db.rpc("release_wrike_sync_lease", { target_organization_id: organizationId, target_token: leaseToken });
  }
}

export async function syncScope(organizationId: string, scopeId: string, trigger: Trigger = "manual", mode: SyncMode = "incremental") {
  return syncOrganization(organizationId, { scopeIds: [scopeId], trigger, mode });
}
