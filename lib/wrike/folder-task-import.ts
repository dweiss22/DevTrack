import { createAdminClient } from "@/lib/supabase/admin";
import { WrikeClient } from "@/lib/wrike/client";
import { wrikeSessionFor } from "@/lib/wrike/oauth";
import { allocatedMinutes, plannedMinutes } from "@/lib/wrike/sync";
import type { WrikeTask } from "@/lib/wrike/types";

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

const TASK_FIELDS = ["description", "responsibleIds", "parentIds", "superTaskIds", "subTaskIds", "customFields", "authorIds", "effortAllocation"];
const iso = (value?: string) => value ? new Date(value).toISOString() : null;
const day = (value?: string) => value ? value.slice(0, 10) : null;

export function folderTasksPath(folderId: string) {
  const params = new URLSearchParams({ descendants: "true", subTasks: "true", fields: JSON.stringify(TASK_FIELDS) });
  return `/folders/${encodeURIComponent(folderId)}/tasks?${params}`;
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
  const byFolder = new Map<string, WrikeTask[]>();
  const uniqueTasks = new Map<string, WrikeTask>();

  for (const folderId of TASK_IMPORT_FOLDER_IDS) {
    try {
      const tasks = await client.all<WrikeTask>(folderTasksPath(folderId));
      byFolder.set(folderId, tasks);
      tasks.forEach((task) => uniqueTasks.set(task.id, task));
    } catch (error) {
      throw new Error(`Wrike folder ${folderId} failed: ${error instanceof Error ? error.message : "Unknown Wrike error"}`);
    }
  }

  const { error: resetError } = await db.rpc("reset_wrike_reporting_data", { target_organization_id: organizationId });
  if (resetError) throw new Error("Unable to reset existing Wrike data. Apply migration 202607160004 first.");

  const importedAt = new Date().toISOString();
  const tasks = [...uniqueTasks.values()];
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
      is_deleted: false,
      last_seen_at: importedAt,
      updated_at: importedAt
    }));
    const { data, error } = await db.from("wrike_tasks").upsert(rows, { onConflict: "organization_id,wrike_id" }).select("id,wrike_id");
    if (error) throw new Error(`Supabase could not save Wrike tasks: ${error.message}`);
    (data ?? []).forEach((task) => taskIdMap.set(task.wrike_id, task.id));
  }

  const mappings = [...byFolder.entries()].flatMap(([folderId, folderTasks]) => folderTasks.flatMap((task) => {
    const taskId = taskIdMap.get(task.id);
    return taskId ? [{ organization_id: organizationId, folder_wrike_id: folderId, task_id: taskId, imported_at: importedAt }] : [];
  }));
  for (let offset = 0; offset < mappings.length; offset += 500) {
    const { error } = await db.from("wrike_folder_task_imports").upsert(mappings.slice(offset, offset + 500), { onConflict: "organization_id,folder_wrike_id,task_id" });
    if (error) throw new Error(`Supabase could not save folder membership: ${error.message}`);
  }

  const folderCounts = Object.fromEntries([...byFolder.entries()].map(([folderId, folderTasks]) => [folderId, folderTasks.length]));
  const { error: runError } = await db.from("wrike_folder_task_import_runs").insert({ organization_id: organizationId, status: "succeeded", folder_counts: folderCounts, task_count: tasks.length });
  if (runError) throw new Error(`Tasks were saved, but the import summary failed: ${runError.message}`);
  return { taskCount: tasks.length, folderCounts, folderCount: TASK_IMPORT_FOLDER_IDS.length };
}
