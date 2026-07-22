import type { SupabaseClient } from "@supabase/supabase-js";
import { filtersForRpc, type ReportingFilters } from "@/lib/reporting/filters";
import { resolveResponsibleUsers, resolveTaskStatus, resolveTimelogCategory, type ResolvedTaskStatus, type ResolvedTimelogCategory, type ResolvedWrikeUser } from "@/lib/wrike/reference-data";
import type { VerticalState } from "@/lib/wrike/vertical-normalization";
import { projectLengthBenchmark, type ProjectLengthBenchmark, type ProjectLengthBenchmarkRow } from "@/lib/reporting/project-overview";

export type ReportingTaskRow = {
  task_id: string; title: string; status: string; status_name: string; status_reference: ResolvedTaskStatus; custom_status_id: string | null; responsible_wrike_ids: string[]; responsible_users: ResolvedWrikeUser[]; due_date: string | null; completed_at: string | null;
  planned_minutes: number | null; actual_minutes: number; updated_at_wrike: string | null;
  assignees: { id: string; name: string }[]; locations: { folderId: string | null; projectId: string | null; wrikeId: string; title: string; scope: string | null; resolved: boolean }[];
  vertical_state?: VerticalState;
  custom_values: Record<string, { title: string; values: string[]; conflict: boolean; sourceFieldIds: string[]; sourceTitles: string[]; normalizedVerticals?: string[] | null; verticalReportingCategory?: string | null; hasUnresolvedVertical?: boolean | null; unresolvedVerticalTokens?: string[] | null; verticalState?: VerticalState | null }>; total_count: number;
};
export type ReportingTimeRow = { entry_id: string; entry_date: string; minutes: number; category: string | null; category_name: string | null; category_reference: ResolvedTimelogCategory | null; comment: string | null; task_id: string; task_title: string; task_status: string; task_status_name: string; status_reference: ResolvedTaskStatus; user_id: string | null; user_wrike_id: string | null; user_name: string | null; user_reference: ResolvedWrikeUser | null; total_count: number };
export type TimeSummaryRow = { group_key: string; label: string; minutes: number; entry_count: number; wrike_user_id?: string | null; resolved?: boolean };

export async function loadTaskRows(supabase: SupabaseClient, filters: ReportingFilters) {
  const { data, error } = await supabase.rpc("reporting_task_rows", { filters: filtersForRpc(filters), result_limit: filters.pageSize, result_offset: (filters.page - 1) * filters.pageSize });
  if (error) throw error;
  const rows = (data ?? []) as Omit<ReportingTaskRow, "status_name" | "status_reference" | "responsible_wrike_ids" | "responsible_users">[];
  if (!rows.length) return [];
  const locationFolderIds = [...new Set(rows.flatMap((row) => row.locations.flatMap((location) => location.folderId ? [location.folderId] : [])))];
  const [{ data: tasks }, { data: users }, { data: statuses }, { data: folders }, { data: verticalValues }] = await Promise.all([
    supabase.from("wrike_tasks").select("id,responsible_wrike_ids,vertical_state").in("id", rows.map((row) => row.task_id)),
    supabase.from("wrike_users").select("wrike_id,display_name,email,avatar_url,synced_at,is_active,is_unresolved,raw_data"),
    supabase.from("wrike_workflow_statuses").select("wrike_id,title,workflow_id,color,dashboard_classification,synced_at,is_unresolved"),
    locationFolderIds.length ? supabase.from("wrike_folders").select("id,title,is_unresolved").in("id", locationFolderIds) : Promise.resolve({ data: [], error: null }),
    supabase.from("wrike_task_normalized_custom_field_values")
      .select("task_id,display_values,has_conflict,source_wrike_field_ids,source_titles,normalized_verticals,vertical_reporting_category,has_unresolved_vertical,unresolved_vertical_tokens,normalized_field:wrike_normalized_custom_fields!inner(normalized_key)")
      .in("task_id", rows.map((row) => row.task_id))
      .eq("normalized_field.normalized_key", "vertical")
  ]);
  const responsibleByTask = new Map((tasks ?? []).map((task) => [task.id, task.responsible_wrike_ids ?? []]));
  const verticalStateByTask = new Map((tasks ?? []).map((task) => [task.id, task.vertical_state as VerticalState]));
  const verticalByTask = new Map((verticalValues ?? []).map((value) => [value.task_id, value]));
  const folderById = new Map((folders ?? []).map((folder) => [folder.id, folder]));
  return rows.map((row) => {
    const responsible_wrike_ids = responsibleByTask.get(row.task_id) ?? [];
    const responsible_users = resolveResponsibleUsers(responsible_wrike_ids, users ?? []);
    const status_reference = resolveTaskStatus(row.custom_status_id, row.status, statuses ?? []);
    const locations = row.locations.map((location) => {
      const folder = location.folderId ? folderById.get(location.folderId) : null;
      return folder ? { ...location, title: folder.title, resolved: !folder.is_unresolved } : location;
    });
    const verticalState = verticalStateByTask.get(row.task_id);
    const verticalValue = verticalByTask.get(row.task_id);
    const existingVertical = Object.entries(row.custom_values).find(([, field]) => field.title.trim().toLocaleLowerCase() === "vertical");
    const custom_values = verticalValue ? { ...row.custom_values, [existingVertical?.[0] ?? "__vertical"]: {
      title: "Vertical",
      values: verticalValue.display_values ?? existingVertical?.[1].values ?? [],
      conflict: verticalValue.has_conflict ?? existingVertical?.[1].conflict ?? false,
      sourceFieldIds: verticalValue.source_wrike_field_ids ?? existingVertical?.[1].sourceFieldIds ?? [],
      sourceTitles: verticalValue.source_titles ?? existingVertical?.[1].sourceTitles ?? [],
      normalizedVerticals: verticalValue.normalized_verticals ?? existingVertical?.[1].normalizedVerticals ?? [],
      verticalReportingCategory: verticalValue.vertical_reporting_category ?? existingVertical?.[1].verticalReportingCategory ?? null,
      hasUnresolvedVertical: verticalState ? ["missing", "unrecognized", "synchronization_incomplete"].includes(verticalState) : verticalValue.has_unresolved_vertical,
      unresolvedVerticalTokens: verticalValue.unresolved_vertical_tokens ?? existingVertical?.[1].unresolvedVerticalTokens ?? [],
      verticalState: verticalState ?? null
    } } : row.custom_values;
    return { ...row, custom_values, vertical_state: verticalState, locations, status_name: status_reference.name, status_reference, responsible_wrike_ids, responsible_users, assignees: responsible_users.map((user) => ({ id: user.wrikeUserId, name: user.fullName })) };
  });
}

export async function loadProjectLengthPercentiles(supabase: SupabaseClient, taskIds: readonly string[]): Promise<Map<string, ProjectLengthBenchmark>> {
  const result = await loadProjectLengthPercentilesResult(supabase, taskIds);
  if (result.error) throw result.error;
  return result.data;
}

export async function loadProjectLengthPercentilesResult(supabase: SupabaseClient, taskIds: readonly string[]): Promise<{ data: Map<string, ProjectLengthBenchmark>; error: null } | { data: Map<string, ProjectLengthBenchmark>; error: unknown }> {
  if (!taskIds.length) return { data: new Map<string, ProjectLengthBenchmark>(), error: null };
  const started = Date.now();
  try {
    const { data, error } = await supabase.rpc("reporting_project_length_percentiles", { target_task_ids: taskIds.slice(0, 200) });
    if (error) {
      console.error("reporting_project_percentiles_failed", { elapsedMs: Date.now() - started, code: error.code, message: error.message });
      return { data: new Map<string, ProjectLengthBenchmark>(), error };
    }
    console.info("reporting_project_percentiles_completed", { elapsedMs: Date.now() - started, requestedTasks: taskIds.length });
    return { data: new Map<string, ProjectLengthBenchmark>((data ?? []).flatMap((row: ProjectLengthBenchmarkRow & { task_id: string }) => {
      const benchmark = projectLengthBenchmark(row);
      return benchmark ? [[row.task_id, benchmark] as const] : [];
    })), error: null };
  } catch (error) {
    console.error("reporting_project_percentiles_exception", { elapsedMs: Date.now() - started, message: error instanceof Error ? error.message : "Unknown error" });
    return { data: new Map<string, ProjectLengthBenchmark>(), error };
  }
}

export async function loadTimeRows(supabase: SupabaseClient, filters: ReportingFilters) {
  const { data, error } = await supabase.rpc("reporting_time_rows", { filters: filtersForRpc(filters), result_limit: filters.pageSize, result_offset: (filters.page - 1) * filters.pageSize });
  if (error) throw error;
  const rows = (data ?? []) as Omit<ReportingTimeRow, "category_name" | "category_reference" | "task_status_name" | "status_reference" | "user_wrike_id" | "user_reference">[];
  if (!rows.length) return [];
  const [{ data: entries }, { data: users }, { data: categories }, { data: tasks }, { data: statuses }] = await Promise.all([
    supabase.from("wrike_time_entries").select("id,user_wrike_id").in("id", rows.map((row) => row.entry_id)),
    supabase.from("wrike_users").select("wrike_id,display_name,email,avatar_url,synced_at,is_active,is_unresolved,raw_data"),
    supabase.from("wrike_timelog_categories").select("wrike_id,title,synced_at,is_unresolved"),
    supabase.from("wrike_tasks").select("id,custom_status_id").in("id", rows.map((row) => row.task_id)),
    supabase.from("wrike_workflow_statuses").select("wrike_id,title,workflow_id,color,dashboard_classification,synced_at,is_unresolved")
  ]);
  const userWrikeIdByEntry = new Map((entries ?? []).map((entry) => [entry.id, entry.user_wrike_id]));
  const customStatusByTask = new Map((tasks ?? []).map((task) => [task.id, task.custom_status_id]));
  return rows.map((row) => {
    const user_wrike_id = userWrikeIdByEntry.get(row.entry_id) ?? null;
    const user = user_wrike_id ? resolveResponsibleUsers([user_wrike_id], users ?? [])[0] : null;
    const category_reference = resolveTimelogCategory(row.category, categories ?? []);
    const status_reference = resolveTaskStatus(customStatusByTask.get(row.task_id), row.task_status, statuses ?? []);
    return { ...row, category_name: category_reference?.name ?? null, category_reference, task_status_name: status_reference.name, status_reference, user_wrike_id, user_name: user?.fullName ?? row.user_name ?? user_wrike_id, user_reference: user };
  });
}

export async function loadTimeSummary(supabase: SupabaseClient, filters: ReportingFilters, groupBy = "total") {
  const { data, error } = await supabase.rpc("reporting_time_summary", { filters: filtersForRpc(filters), group_by: groupBy });
  if (error) throw error;
  const rows = (data ?? []) as TimeSummaryRow[];
  if (groupBy !== "person" || !rows.length) return rows;
  const localIds = rows.map((row) => row.group_key).filter((id) => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id));
  const { data: users } = localIds.length ? await supabase.from("wrike_users").select("id,wrike_id,is_unresolved").in("id", localIds) : { data: [] };
  const usersById = new Map((users ?? []).map((user) => [user.id, user]));
  return rows.map((row) => {
    const user = usersById.get(row.group_key);
    return { ...row, wrike_user_id: user?.wrike_id ?? (/^[A-Z0-9]{8}$/.test(row.group_key) ? row.group_key : null), resolved: user ? !user.is_unresolved : false };
  });
}
