import type { SupabaseClient } from "@supabase/supabase-js";
import { filtersForRpc, type ReportingFilters } from "@/lib/reporting/filters";
import { resolveResponsibleUsers, resolveTaskStatus, resolveTimelogCategory, type ResolvedWrikeUser } from "@/lib/wrike/reference-data";

export type ReportingTaskRow = {
  task_id: string; title: string; status: string; status_name: string; custom_status_id: string | null; responsible_wrike_ids: string[]; responsible_users: ResolvedWrikeUser[]; due_date: string | null; completed_at: string | null;
  planned_minutes: number | null; actual_minutes: number; updated_at_wrike: string | null;
  assignees: { id: string; name: string }[]; locations: { folderId: string | null; projectId: string | null; wrikeId: string; title: string; scope: string | null; resolved: boolean }[];
  custom_values: Record<string, { title: string; values: string[]; conflict: boolean; sourceFieldIds: string[]; sourceTitles: string[] }>; total_count: number;
};
export type ReportingTimeRow = { entry_id: string; entry_date: string; minutes: number; category: string | null; category_name: string | null; comment: string | null; task_id: string; task_title: string; task_status: string; task_status_name: string; user_id: string | null; user_wrike_id: string | null; user_name: string | null; total_count: number };
export type TimeSummaryRow = { group_key: string; label: string; minutes: number; entry_count: number };

export async function loadTaskRows(supabase: SupabaseClient, filters: ReportingFilters) {
  const { data, error } = await supabase.rpc("reporting_task_rows", { filters: filtersForRpc(filters), result_limit: filters.pageSize, result_offset: (filters.page - 1) * filters.pageSize });
  if (error) throw error;
  const rows = (data ?? []) as Omit<ReportingTaskRow, "status_name" | "responsible_wrike_ids" | "responsible_users">[];
  if (!rows.length) return [];
  const [{ data: tasks }, { data: users }, { data: statuses }] = await Promise.all([
    supabase.from("wrike_tasks").select("id,responsible_wrike_ids").in("id", rows.map((row) => row.task_id)),
    supabase.from("wrike_users").select("wrike_id,display_name,email,avatar_url,synced_at"),
    supabase.from("wrike_workflow_statuses").select("wrike_id,title")
  ]);
  const responsibleByTask = new Map((tasks ?? []).map((task) => [task.id, task.responsible_wrike_ids ?? []]));
  return rows.map((row) => {
    const responsible_wrike_ids = responsibleByTask.get(row.task_id) ?? [];
    const responsible_users = resolveResponsibleUsers(responsible_wrike_ids, users ?? []);
    return { ...row, status_name: resolveTaskStatus(row.custom_status_id, row.status, statuses ?? []).name, responsible_wrike_ids, responsible_users, assignees: responsible_users.map((user) => ({ id: user.wrikeUserId, name: user.fullName })) };
  });
}

export async function loadTimeRows(supabase: SupabaseClient, filters: ReportingFilters) {
  const { data, error } = await supabase.rpc("reporting_time_rows", { filters: filtersForRpc(filters), result_limit: filters.pageSize, result_offset: (filters.page - 1) * filters.pageSize });
  if (error) throw error;
  const rows = (data ?? []) as Omit<ReportingTimeRow, "category_name" | "task_status_name" | "user_wrike_id">[];
  if (!rows.length) return [];
  const [{ data: entries }, { data: users }, { data: categories }, { data: tasks }, { data: statuses }] = await Promise.all([
    supabase.from("wrike_time_entries").select("id,user_wrike_id").in("id", rows.map((row) => row.entry_id)),
    supabase.from("wrike_users").select("wrike_id,display_name,email,avatar_url,synced_at"),
    supabase.from("wrike_timelog_categories").select("wrike_id,title"),
    supabase.from("wrike_tasks").select("id,custom_status_id").in("id", rows.map((row) => row.task_id)),
    supabase.from("wrike_workflow_statuses").select("wrike_id,title")
  ]);
  const userWrikeIdByEntry = new Map((entries ?? []).map((entry) => [entry.id, entry.user_wrike_id]));
  const customStatusByTask = new Map((tasks ?? []).map((task) => [task.id, task.custom_status_id]));
  return rows.map((row) => {
    const user_wrike_id = userWrikeIdByEntry.get(row.entry_id) ?? null;
    const user = user_wrike_id ? resolveResponsibleUsers([user_wrike_id], users ?? [])[0] : null;
    return { ...row, category_name: resolveTimelogCategory(row.category, categories ?? [])?.name ?? null, task_status_name: resolveTaskStatus(customStatusByTask.get(row.task_id), row.task_status, statuses ?? []).name, user_wrike_id, user_name: user?.fullName ?? row.user_name ?? user_wrike_id };
  });
}

export async function loadTimeSummary(supabase: SupabaseClient, filters: ReportingFilters, groupBy = "total") {
  const { data, error } = await supabase.rpc("reporting_time_summary", { filters: filtersForRpc(filters), group_by: groupBy });
  if (error) throw error;
  return (data ?? []) as TimeSummaryRow[];
}
