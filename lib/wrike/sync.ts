import { createAdminClient } from "@/lib/supabase/admin";
import { accessTokenFor } from "@/lib/wrike/oauth";
import { WrikeClient } from "@/lib/wrike/client";
import type { WrikeTask, WrikeTimeEntry, WrikeUser } from "@/lib/wrike/types";

type Scope = { id: string; scope_type: "account" | "space" | "folder" | "project" | "task" | "list"; source_ids: string[] };
const date = (value?: string) => value ? new Date(value).toISOString() : null;
const day = (value?: string) => value ? value.slice(0, 10) : null;
const entryMinutes = (entry: WrikeTimeEntry) => entry.minutes ?? Math.round((entry.hours ?? 0) * 60);

function taskPath(scope: Scope) {
  const id = scope.source_ids[0];
  if (scope.scope_type === "account") return "/tasks";
  if (scope.scope_type === "space") return `/spaces/${encodeURIComponent(id)}/tasks`;
  if (scope.scope_type === "folder" || scope.scope_type === "project") return `/folders/${encodeURIComponent(id)}/tasks`;
  if (scope.scope_type === "task") return `/tasks/${encodeURIComponent(id)}/tasks`;
  return `/tasks?ids=${scope.source_ids.map(encodeURIComponent).join(",")}`;
}

async function upsertUsers(organizationId: string, client: WrikeClient) {
  const users = await client.all<WrikeUser>("/contacts");
  const db = createAdminClient();
  if (!users.length) return new Map<string, string>();
  const { data, error } = await db.from("wrike_users").upsert(users.map((user) => ({ organization_id: organizationId, wrike_id: user.id, first_name: user.firstName ?? null, last_name: user.lastName ?? null, display_name: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.id, email: user.profiles?.[0]?.email ?? null, raw_data: user, is_active: true, updated_at: new Date().toISOString() })), { onConflict: "organization_id,wrike_id" }).select("id,wrike_id");
  if (error) throw error;
  return new Map((data ?? []).map((u) => [u.wrike_id, u.id]));
}

export async function syncScope(organizationId: string, scopeId: string, trigger: "manual" | "scheduled" | "backfill" = "manual") {
  const db = createAdminClient();
  const { data: scope, error: scopeError } = await db.from("wrike_sync_scopes").select("id,scope_type,source_ids").eq("id", scopeId).eq("organization_id", organizationId).single();
  if (scopeError || !scope) throw new Error("The selected sync scope was not found.");
  const { data: run, error: runError } = await db.from("wrike_sync_runs").insert({ organization_id: organizationId, scope_id: scope.id, trigger, status: "running" }).select("id").single();
  if (runError || !run) throw runError ?? new Error("Unable to create sync run.");
  const failures: string[] = [];
  try {
    const client = new WrikeClient(await accessTokenFor(organizationId));
    const [users, tasks] = await Promise.all([upsertUsers(organizationId, client), client.all<WrikeTask>(taskPath(scope as Scope))]);
    const taskRows = tasks.map((task) => ({ organization_id: organizationId, wrike_id: task.id, title: task.title, description: task.description ?? null, permalink: task.permalink ?? null, status: task.status, workflow_id: task.workflowId ?? null, custom_status_id: task.customStatusId ?? null, importance: task.importance ?? null, created_at_wrike: date(task.createdDate), updated_at_wrike: date(task.updatedDate), start_date: day(task.dates?.start), due_date: day(task.dates?.due), completed_at: date(task.dates?.completed), parent_wrike_ids: task.parentIds ?? [], planned_minutes: typeof task.effortAllocation === "number" ? task.effortAllocation : null, raw_data: task, is_deleted: false, last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() }));
    const { data: savedTasks, error: tasksError } = taskRows.length ? await db.from("wrike_tasks").upsert(taskRows, { onConflict: "organization_id,wrike_id" }).select("id,wrike_id") : { data: [], error: null };
    if (tasksError) throw tasksError;
    const taskIds = new Map((savedTasks ?? []).map((task) => [task.wrike_id, task.id]));
    const assignments = tasks.flatMap((task) => (task.responsibleIds ?? []).flatMap((wrikeUserId) => users.get(wrikeUserId) ? [{ task_id: taskIds.get(task.id), user_id: users.get(wrikeUserId), assignment_type: "assignee" }] : []));
    if (assignments.length) { const { error } = await db.from("wrike_task_assignees").upsert(assignments, { onConflict: "task_id,user_id,assignment_type", ignoreDuplicates: true }); if (error) failures.push(`Assignees: ${error.message}`); }
    let entryCount = 0;
    for (const task of tasks) {
      try {
        const entries = await client.all<WrikeTimeEntry>(`/tasks/${encodeURIComponent(task.id)}/timelogs`);
        const rows = entries.map((entry) => ({ organization_id: organizationId, wrike_id: entry.id, task_id: taskIds.get(task.id), user_id: entry.userId ? users.get(entry.userId) ?? null : null, entry_date: day(entry.trackedDate), minutes: entryMinutes(entry), category: entry.categoryId ?? null, comment: entry.comment ?? null, created_at_wrike: date(entry.createdDate), updated_at_wrike: date(entry.updatedDate), raw_data: entry, is_deleted: false, updated_at: new Date().toISOString() }));
        if (rows.length) { const { error } = await db.from("wrike_time_entries").upsert(rows, { onConflict: "organization_id,wrike_id" }); if (error) failures.push(`Time entries for ${task.id}: ${error.message}`); else entryCount += rows.length; }
      } catch (error) { failures.push(`Time entries for ${task.id}: ${error instanceof Error ? error.message : "unknown error"}`); }
    }
    await db.from("wrike_sync_runs").update({ status: failures.length ? "partial" : "succeeded", completed_at: new Date().toISOString(), record_counts: { tasks: tasks.length, users: users.size, timeEntries: entryCount }, errors: failures }).eq("id", run.id);
    return { runId: run.id, tasks: tasks.length, users: users.size, timeEntries: entryCount, failures };
  } catch (error) {
    await db.from("wrike_sync_runs").update({ status: "failed", completed_at: new Date().toISOString(), error_summary: error instanceof Error ? error.message : "Unexpected sync failure", errors: failures }).eq("id", run.id);
    throw error;
  }
}
