import type { SupabaseClient } from "@supabase/supabase-js";
import { filtersForRpc, type ReportingFilters } from "@/lib/reporting/filters";

export type ReportingTaskRow = {
  task_id: string; title: string; status: string; custom_status_id: string | null; due_date: string | null; completed_at: string | null;
  planned_minutes: number | null; actual_minutes: number; updated_at_wrike: string | null;
  assignees: { id: string; name: string }[]; locations: { folderId: string | null; projectId: string | null; wrikeId: string; title: string; scope: string | null; resolved: boolean }[];
  custom_values: Record<string, string | null>; total_count: number;
};
export type ReportingTimeRow = { entry_id: string; entry_date: string; minutes: number; category: string | null; comment: string | null; task_id: string; task_title: string; task_status: string; user_id: string | null; user_name: string | null; total_count: number };
export type TimeSummaryRow = { group_key: string; label: string; minutes: number; entry_count: number };

export async function loadTaskRows(supabase: SupabaseClient, filters: ReportingFilters) {
  const { data, error } = await supabase.rpc("reporting_task_rows", { filters: filtersForRpc(filters), result_limit: filters.pageSize, result_offset: (filters.page - 1) * filters.pageSize });
  if (error) throw error;
  return (data ?? []) as ReportingTaskRow[];
}

export async function loadTimeRows(supabase: SupabaseClient, filters: ReportingFilters) {
  const { data, error } = await supabase.rpc("reporting_time_rows", { filters: filtersForRpc(filters), result_limit: filters.pageSize, result_offset: (filters.page - 1) * filters.pageSize });
  if (error) throw error;
  return (data ?? []) as ReportingTimeRow[];
}

export async function loadTimeSummary(supabase: SupabaseClient, filters: ReportingFilters, groupBy = "total") {
  const { data, error } = await supabase.rpc("reporting_time_summary", { filters: filtersForRpc(filters), group_by: groupBy });
  if (error) throw error;
  return (data ?? []) as TimeSummaryRow[];
}
