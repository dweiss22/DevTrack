import type { SupabaseClient } from "@supabase/supabase-js";
import { filtersForRpc, type ReportingFilters } from "@/lib/reporting/filters";
import { ONLINE_LEARNING_WORKFLOW_ID } from "@/lib/reporting/constants";
import { normalizeReportingCourseYear, reportingCourseYearLabel } from "@/lib/reporting/reporting-year";

export { ONLINE_LEARNING_WORKFLOW_ID } from "@/lib/reporting/constants";

export type DashboardMetrics = {
  totalProjects: number;
  activeProjects: number;
  completedProjects: number;
  stalledOrCanceledProjects: number;
  unresolvedStatusProjects: number;
  customFieldConflictProjects: number;
  unresolvedVerticalProjects: number;
  timeDataSynchronized: boolean;
};

export type ReportingYearCount = { label: string; sortYear: number; projects: number };
export type ReportingYearTime = { label: string; sortYear: number; projectCount: number; totalMinutes: number; averageMinutes: number | null; timeDataSynchronized: boolean };
export type ReportingYearStatus = {
  label: string;
  sortYear: number;
  stalledOrCanceled: number;
  active: number;
  completed: number;
  total: number;
  stalledStatuses: string[];
  activeStatuses: string[];
  completedStatuses: string[];
};
export type DashboardCategory = { name: string; projects: number };

export type DashboardAnalytics = {
  metrics: DashboardMetrics;
  projectsByReportingYear: ReportingYearCount[];
  averageTimeByReportingYear: ReportingYearTime[];
  projectsByStatus: ReportingYearStatus[];
  courseTypes: DashboardCategory[];
  authoringTools: DashboardCategory[];
  verticals: DashboardCategory[];
};

export type DashboardYearOption = { year: number; label: string; projectCount: number };
export type DashboardOverview = {
  metrics: Omit<DashboardMetrics, "timeDataSynchronized">;
  projectsByReportingYear: ReportingYearCount[];
  projectsByStatus: ReportingYearStatus[];
  courseTypes: DashboardCategory[];
  authoringTools: DashboardCategory[];
  verticals: DashboardCategory[];
};
export type DashboardTimeAnalytics = { averageTimeByReportingYear: ReportingYearTime[]; timeDataSynchronized: boolean };

export const EMPTY_DASHBOARD_ANALYTICS: DashboardAnalytics = {
  metrics: { totalProjects: 0, activeProjects: 0, completedProjects: 0, stalledOrCanceledProjects: 0, unresolvedStatusProjects: 0, customFieldConflictProjects: 0, unresolvedVerticalProjects: 0, timeDataSynchronized: false },
  projectsByReportingYear: [],
  averageTimeByReportingYear: [],
  projectsByStatus: [],
  courseTypes: [],
  authoringTools: [],
  verticals: []
};

export type DashboardAnalyticsFailure = {
  kind: "migration_required" | "permission_denied" | "query_failed";
  title: string;
  message: string;
  diagnosticCode: string | null;
};

export type DashboardAnalyticsResult = { data: DashboardAnalytics; error: null } | { data: null; error: DashboardAnalyticsFailure };
export type DashboardLoadResult<T> = { data: T; error: null } | { data: null; error: DashboardAnalyticsFailure };

function dashboardFailure(error: { message?: string; code?: string | null } | unknown, rpc: string): DashboardAnalyticsFailure {
  const candidate = error && typeof error === "object" ? error as { message?: string; code?: string | null } : {};
  const message = candidate.message?.toLocaleLowerCase() ?? "";
  if (candidate.code === "PGRST202" || candidate.code === "42883" || message.includes("schema cache") || message.includes("could not find the function")) return {
    kind: "migration_required", title: "Dashboard database migration required",
    message: "Apply all Supabase migrations through 202607200004, reload the PostgREST schema cache, and retry. Existing reporting data has not been replaced with zeroes.", diagnosticCode: candidate.code ?? null
  };
  if (candidate.code === "42501" || message.includes("permission denied")) return {
    kind: "permission_denied", title: "Dashboard reporting access was denied",
    message: "Confirm this account belongs to the reporting organization and can execute the reporting RPC.", diagnosticCode: candidate.code ?? null
  };
  const timeout = candidate.code === "57014" || message.includes("timeout") || message.includes("timed out") || message.includes("abort");
  return { kind: "query_failed", title: timeout ? "Dashboard query timed out" : "Dashboard reporting query failed", message: timeout
    ? `${rpc} exceeded the database or network time limit. Other Dashboard sections can still load; retry this section after reviewing server timing logs.`
    : `${rpc} could not complete. Review server timing logs using the diagnostic code. No zero values have been substituted.`, diagnosticCode: candidate.code ?? null };
}

async function timedRpc<T>(supabase: SupabaseClient, rpc: string, args?: Record<string, unknown>): Promise<DashboardLoadResult<T>> {
  const started = Date.now();
  try {
    const { data, error } = await supabase.rpc(rpc, args);
    const elapsedMs = Date.now() - started;
    if (error) {
      console.error("reporting_rpc_failed", { rpc, elapsedMs, code: error.code });
      return { data: null, error: dashboardFailure(error, rpc) };
    }
    console.info("reporting_rpc_completed", { rpc, elapsedMs });
    return { data: data as T, error: null };
  } catch (error) {
    const elapsedMs = Date.now() - started;
    console.error("reporting_rpc_exception", { rpc, elapsedMs, message: error instanceof Error ? error.message : "Unknown error" });
    return { data: null, error: dashboardFailure(error, rpc) };
  }
}

export async function loadDashboardYearOptions(supabase: SupabaseClient): Promise<DashboardLoadResult<DashboardYearOption[]>> {
  const result = await timedRpc<{ year: number; label: string; project_count: number }[]>(supabase, "reporting_dashboard_year_options");
  if (result.error) return result;
  return { data: (result.data ?? []).map((row) => ({ year: Number(row.year), label: row.label, projectCount: Number(row.project_count) })), error: null };
}

export function loadDashboardOverview(supabase: SupabaseClient, year: number) {
  return timedRpc<DashboardOverview>(supabase, "reporting_online_learning_dashboard_overview_v3", { target_year: year });
}

export function loadDashboardTimeAnalytics(supabase: SupabaseClient, year: number) {
  return timedRpc<DashboardTimeAnalytics>(supabase, "reporting_online_learning_dashboard_time_v3", { target_year: year });
}

export async function loadDashboardAnalyticsResult(supabase: SupabaseClient, filters: ReportingFilters): Promise<DashboardAnalyticsResult> {
  const { data, error } = await supabase.rpc("reporting_online_learning_dashboard_v2", { filters: filtersForRpc(filters) });
  if (!error) return { data: data ? data as DashboardAnalytics : EMPTY_DASHBOARD_ANALYTICS, error: null };
  const message = error.message.toLocaleLowerCase();
  if (error.code === "PGRST202" || error.code === "42883" || (message.includes("reporting_online_learning_dashboard_v2") && (message.includes("not find") || message.includes("does not exist")))) {
    return { data: null, error: {
      kind: "migration_required",
      title: "Dashboard database migration required",
      message: "Apply Supabase migration 202607170005_dashboard_analytics.sql, then reload the Dashboard. Existing project data has not been replaced with zeroes.",
      diagnosticCode: error.code ?? null
    } };
  }
  if (error.code === "42501" || message.includes("permission denied")) {
    return { data: null, error: {
      kind: "permission_denied",
      title: "Dashboard reporting access was denied",
      message: "Confirm the migration grants execute access to authenticated users and that this account belongs to the correct reporting organization.",
      diagnosticCode: error.code ?? null
    } };
  }
  return { data: null, error: {
    kind: "query_failed",
    title: "Dashboard analytics query failed",
    message: "The database function exists but could not complete. Review the server or Supabase database logs using the diagnostic code below.",
    diagnosticCode: error.code ?? null
  } };
}

export async function loadDashboardAnalytics(supabase: SupabaseClient, filters: ReportingFilters): Promise<DashboardAnalytics> {
  const result = await loadDashboardAnalyticsResult(supabase, filters);
  if (result.error) throw new Error(`${result.error.title}: ${result.error.message}`);
  return result.data;
}

export function normalizeReportingYear(values: readonly string[]) {
  return normalizeReportingCourseYear(values);
}

export { reportingCourseYearLabel };

export function normalizeDashboardValues(values: readonly string[]) {
  const byKey = new Map<string, string>();
  for (const value of values) {
    const display = value.trim().replace(/\s+/g, " ");
    if (!display) continue;
    const key = display.toLocaleLowerCase();
    if (!byKey.has(key)) byKey.set(key, display);
  }
  return [...byKey.values()];
}

export function dashboardCategory(values: readonly string[], multipleLabel: string) {
  const normalized = normalizeDashboardValues(values);
  if (!normalized.length) return "Unassigned";
  return normalized.length === 1 ? normalized[0] : multipleLabel;
}

export function averageProjectMinutes(projectMinutes: readonly number[]) {
  if (!projectMinutes.length) return null;
  return projectMinutes.reduce((sum, minutes) => sum + minutes, 0) / projectMinutes.length;
}

export type DashboardProjectSample = {
  workflowId: string | null;
  statusWorkflowId?: string | null;
  classification: "completed" | "active" | "stalled_or_canceled" | null;
  reportingValues?: string[];
  actualMinutes?: number;
};

export function isOnlineLearningProject(project: Pick<DashboardProjectSample, "workflowId" | "statusWorkflowId">) {
  return project.workflowId === ONLINE_LEARNING_WORKFLOW_ID || project.statusWorkflowId === ONLINE_LEARNING_WORKFLOW_ID;
}

export function effectiveDashboardClassification(classification: DashboardProjectSample["classification"]) {
  return classification === "completed" || classification === "stalled_or_canceled" ? classification : "active";
}

export function dashboardMetricCounts(projects: readonly DashboardProjectSample[]) {
  const included = projects.filter(isOnlineLearningProject);
  return {
    totalProjects: included.length,
    activeProjects: included.filter((project) => effectiveDashboardClassification(project.classification) === "active").length,
    completedProjects: included.filter((project) => effectiveDashboardClassification(project.classification) === "completed").length
  };
}

export function completedReportingYearAverages(projects: readonly DashboardProjectSample[]) {
  const grouped = new Map<string, { sortYear: number; minutes: number[] }>();
  for (const project of projects.filter((item) => isOnlineLearningProject(item) && effectiveDashboardClassification(item.classification) === "completed")) {
    const year = normalizeReportingYear(project.reportingValues ?? []);
    const label = year == null ? "Unassigned" : String(year);
    const group = grouped.get(label) ?? { sortYear: year ?? Number.MAX_SAFE_INTEGER, minutes: [] };
    group.minutes.push(project.actualMinutes ?? 0);
    grouped.set(label, group);
  }
  return [...grouped.entries()].map(([label, group]) => ({ label, sortYear: group.sortYear, projectCount: group.minutes.length, totalMinutes: group.minutes.reduce((sum, minutes) => sum + minutes, 0), averageMinutes: averageProjectMinutes(group.minutes)! })).sort((left, right) => left.sortYear - right.sortYear);
}
