import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ONLINE_LEARNING_WORKFLOW_ID } from "@/lib/reporting/constants";
import { loadCustomFieldOptions, type CustomFieldFilterOption, type StatusFilterOption } from "@/lib/reporting/options";
import { APPROVED_VERTICALS, VERTICAL_REPORTING_FILTER_OPTIONS } from "@/lib/wrike/vertical-normalization";

const optionalText = z.preprocess((value) => value === "" ? undefined : value, z.string().trim().max(200).optional());
const optionalDate = z.preprocess((value) => value === "" ? undefined : value, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional());
const optionalEnum = <T extends [string, ...string[]]>(values: T) => z.preprocess((value) => value === "" ? undefined : value, z.enum(values).optional());

export const developmentFiltersSchema = z.object({
  reportingYearMode: z.enum(["year", "missing"]).default("year"),
  reportingYear: z.coerce.number().int().min(1900).max(2199).optional(),
  q: optionalText,
  completionClassification: optionalEnum(["completed", "incomplete"]),
  developmentStatus: optionalText,
  assigneeIds: z.preprocess((value) => value ? [String(value)] : undefined, z.array(z.string()).optional()),
  folderIds: z.preprocess((value) => value ? [String(value)] : undefined, z.array(z.string()).optional()),
  projectIds: z.preprocess((value) => value ? [String(value)] : undefined, z.array(z.string()).optional()),
  priority: optionalText,
  dueFrom: optionalDate,
  dueTo: optionalDate,
  completedFrom: optionalDate,
  completedTo: optionalDate,
  timeState: optionalEnum(["with-time", "no-time"]),
  unresolvedOnly: z.preprocess((value) => value === "true" || value === "on", z.boolean().default(false)),
  verticalReportingCategory: optionalEnum([...VERTICAL_REPORTING_FILTER_OPTIONS]),
  associatedVertical: optionalEnum([...APPROVED_VERTICALS]),
  unresolvedVerticalOnly: z.preprocess((value) => value === "true" || value === "on", z.boolean().default(false)),
  customFields: z.record(z.string(), z.string().max(200)).optional(),
  sort: z.enum(["updated", "title", "status", "priority", "start", "due", "completed", "actual"]).default("updated"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(200).default(50)
});

export type DevelopmentFilters = z.infer<typeof developmentFiltersSchema>;
type SearchValues = Record<string, string | string[] | undefined>;

export function parseDevelopmentFilters(values: SearchValues, defaultYear?: number): DevelopmentFilters {
  const selection = typeof values.reportingSelection === "string" ? values.reportingSelection : undefined;
  const customFields = Object.fromEntries(Object.entries(values).filter(([key, value]) => key.startsWith("cf_") && typeof value === "string" && value.trim()).map(([key, value]) => [key.slice(3), value as string]));
  const normalized = {
    ...values,
    reportingYearMode: selection === "missing" ? "missing" : "year",
    reportingYear: selection?.startsWith("year:") ? selection.slice(5) : values.reportingYear ?? defaultYear,
    assigneeIds: first(values.assigneeIds), folderIds: first(values.folderIds), projectIds: first(values.projectIds),
    customFields: Object.keys(customFields).length ? customFields : undefined
  };
  const parsed = developmentFiltersSchema.safeParse(normalized);
  return parsed.success ? parsed.data : developmentFiltersSchema.parse({ reportingYear: defaultYear });
}

export function developmentFiltersToQuery(filters: Partial<DevelopmentFilters>) {
  const query = new URLSearchParams();
  if (filters.reportingYearMode === "missing") query.set("reportingSelection", "missing");
  else if (filters.reportingYear != null) query.set("reportingSelection", `year:${filters.reportingYear}`);
  for (const [key, value] of Object.entries(filters)) {
    if (value == null || value === "" || value === false || ["reportingYear", "reportingYearMode", "customFields"].includes(key)) continue;
    if (Array.isArray(value)) value.forEach((item) => query.append(key, String(item)));
    else query.set(key, String(value));
  }
  for (const [id, value] of Object.entries(filters.customFields ?? {})) if (value) query.set(`cf_${id}`, value);
  return query.toString();
}

export function filtersForDevelopmentRpc(filters: DevelopmentFilters) {
  const { page: _page, pageSize: _pageSize, ...rpc } = filters;
  return Object.fromEntries(Object.entries(rpc).filter(([, value]) => value !== undefined && value !== "" && value !== false && (!Array.isArray(value) || value.length)));
}

export type DevelopmentYearOption = { year: number; label: string; projects: number };
export type DevelopmentYearOptions = { years: DevelopmentYearOption[]; missingProjects: number; defaultYear?: number };
export type DevelopmentStatusMetric = { statusId: string; name: string; color: string | null; resolved: boolean; projects: number };
export type DevelopmentTimeMetric = { statusId: string; name: string; color: string | null; resolved: boolean; minutes: number; projectCount: number };
export type DevelopmentAnalytics = {
  metrics: { totalCourses: number; completedCourses: number; incompleteCourses: number; unmappedStatusCourses: number; totalMinutes: number };
  activeStatuses: DevelopmentStatusMetric[];
  hoursByStatus: DevelopmentTimeMetric[];
  timeStatusAttribution: "current_task_status" | "status_at_entry";
};
export type DevelopmentReference = { id: string; name: string; resolved: boolean };
export type DevelopmentProjectRow = {
  taskId: string; title: string; reportingYear: number | null;
  status: { id: string; name: string; color: string | null; resolved: boolean };
  completionClassification: "completed" | "incomplete"; statusUnmapped: boolean;
  assignees: DevelopmentReference[]; priority: string | null; startDate: string | null; dueDate: string | null; completedAt: string | null;
  actualMinutes: number; permalink: string | null; updatedAt: string | null; locations: DevelopmentReference[];
  customValues: Record<string, { title: string; values: string[]; conflict: boolean; normalizedVerticals?: string[] | null; verticalReportingCategory?: string | null; hasUnresolvedVertical?: boolean | null; unresolvedVerticalTokens?: string[] | null }>;
};
export type DevelopmentProjectResult = { rows: DevelopmentProjectRow[]; total: number };
export type DevelopmentLoadResult<T> = { data: T; error: null } | { data: null; error: { title: string; message: string; code: string | null } };
export type DevelopmentOptions = {
  statuses: StatusFilterOption[]; users: { id: string; name: string; wrikeId: string; resolved: boolean }[];
  folders: { id: string; name: string }[]; projects: { id: string; name: string }[]; customFields: CustomFieldFilterOption[];
};

export async function loadDevelopmentOptions(supabase: SupabaseClient, organizationId: string): Promise<DevelopmentLoadResult<DevelopmentOptions>> {
  const [statuses, users, folders, projects, customFields] = await Promise.all([
    supabase.from("wrike_workflow_statuses").select("wrike_id,title,color,is_unresolved").eq("organization_id", organizationId).eq("workflow_id", ONLINE_LEARNING_WORKFLOW_ID).order("title"),
    supabase.from("wrike_users").select("id,wrike_id,display_name,is_unresolved").eq("organization_id", organizationId).eq("is_active", true).order("display_name"),
    supabase.from("wrike_folders").select("id,wrike_id,title,is_unresolved").eq("organization_id", organizationId).is("deleted_at", null).order("title"),
    supabase.from("wrike_projects").select("id,title").eq("organization_id", organizationId).is("deleted_at", null).order("title"),
    loadCustomFieldOptions(supabase).then((data) => ({ data, error: null })).catch((error) => ({ data: null, error }))
  ]);
  const error = statuses.error ?? users.error ?? folders.error ?? projects.error ?? customFields.error;
  if (error) return failure("Development filter options could not be loaded", error);
  return { data: {
    statuses: (statuses.data ?? []).map((row) => ({ id: row.wrike_id, name: row.is_unresolved ? "Unknown Status" : row.title, color: row.color ?? null, resolved: !row.is_unresolved })),
    users: (users.data ?? []).map((row) => ({ id: row.id, wrikeId: row.wrike_id, name: row.is_unresolved ? "Unresolved user" : row.display_name, resolved: !row.is_unresolved })),
    folders: (folders.data ?? []).map((row) => ({ id: row.id, name: row.is_unresolved ? "Unresolved folder" : row.title })),
    projects: (projects.data ?? []).map((row) => ({ id: row.id, name: row.title })), customFields: customFields.data ?? []
  }, error: null };
}

export async function loadDevelopmentYearOptions(supabase: SupabaseClient): Promise<DevelopmentLoadResult<DevelopmentYearOptions>> {
  try {
    const { data, error } = await supabase.rpc("reporting_development_year_options");
    if (error) return failure("Reporting years could not be loaded", error);
    const rows = (data ?? []) as { reporting_year: number | null; project_count: number; missing_count: number }[];
    const years = rows.filter((row): row is typeof row & { reporting_year: number } => row.reporting_year != null).map((row) => ({ year: Number(row.reporting_year), label: `${row.reporting_year} Courses`, projects: Number(row.project_count) }));
    return { data: { years, missingProjects: Number(rows[0]?.missing_count ?? 0), defaultYear: years[0]?.year }, error: null };
  } catch (error) { return failure("Reporting years could not be loaded", errorFromUnknown(error)); }
}

export async function loadDevelopmentAnalytics(supabase: SupabaseClient, filters: DevelopmentFilters): Promise<DevelopmentLoadResult<DevelopmentAnalytics>> {
  try {
    const { data, error } = await supabase.rpc("reporting_development_analytics", { filters: analyticsFilters(filters) });
    if (error) return failure("Development analytics could not be loaded", error);
    return { data: data as DevelopmentAnalytics, error: null };
  } catch (error) { return failure("Development analytics could not be loaded", errorFromUnknown(error)); }
}

export async function loadDevelopmentProjects(supabase: SupabaseClient, filters: DevelopmentFilters): Promise<DevelopmentLoadResult<DevelopmentProjectResult>> {
  try {
  const { data, error } = await supabase.rpc("reporting_development_project_rows", { filters: filtersForDevelopmentRpc(filters), result_limit: filters.pageSize, result_offset: (filters.page - 1) * filters.pageSize });
  if (error) return failure("Development projects could not be loaded", error);
  const result = data as DevelopmentProjectResult | null;
  const rows = result?.rows ?? [];
  const { data: verticalRows, error: verticalError } = rows.length ? await supabase
    .from("wrike_task_normalized_custom_field_values")
    .select("task_id,normalized_verticals,vertical_reporting_category,has_unresolved_vertical,unresolved_vertical_tokens,normalized_field:wrike_normalized_custom_fields!inner(normalized_key)")
    .in("task_id", rows.map((row) => row.taskId))
    .eq("normalized_field.normalized_key", "vertical") : { data: [], error: null };
  if (verticalError) return failure("Development Vertical data could not be loaded", verticalError);
  const verticalByTask = new Map((verticalRows ?? []).map((value) => [value.task_id, value]));
  return { data: { rows: rows.map((row) => {
    const value = verticalByTask.get(row.taskId);
    const existing = Object.entries(row.customValues).find(([, field]) => field.title.trim().toLocaleLowerCase() === "vertical");
    const key = existing?.[0] ?? "__vertical";
    return { ...row, customValues: { ...row.customValues, [key]: {
      title: "Vertical", values: value?.normalized_verticals ?? existing?.[1].values ?? [], conflict: existing?.[1].conflict ?? false,
      normalizedVerticals: value?.normalized_verticals ?? [], verticalReportingCategory: value?.vertical_reporting_category ?? "Unresolved Vertical",
      hasUnresolvedVertical: value?.has_unresolved_vertical ?? true, unresolvedVerticalTokens: value?.unresolved_vertical_tokens ?? []
    } } };
  }), total: Number(result?.total ?? 0) }, error: null };
  } catch (error) { return failure("Development projects could not be loaded", errorFromUnknown(error)); }
}

export function resolveDevelopmentContactValues(rows: DevelopmentProjectRow[], users: { wrikeId?: string; name: string; resolved?: boolean }[], contactKeys: Set<string>) {
  const userById = new Map(users.flatMap((user) => user.wrikeId ? [[user.wrikeId, user] as const] : []));
  return rows.map((row) => ({ ...row, customValues: Object.fromEntries(Object.entries(row.customValues).map(([key, field]) => {
    if (!contactKeys.has(key)) return [key, field];
    return [key, { ...field, values: field.values.map((value) => userById.get(value)?.name ?? `Unresolved field value (${value})`) }];
  })) }));
}

export function completionPercentages(completed: number, incomplete: number) {
  const total = completed + incomplete;
  if (!total) return { completion: 0, incomplete: 0 };
  const completion = completed / total * 100;
  return { completion, incomplete: 100 - completion };
}

export function statusPercentage(value: number, total: number) { return total ? value / total * 100 : 0; }
export function usesCurrentStatusFallback(mode: DevelopmentAnalytics["timeStatusAttribution"]) { return mode === "current_task_status"; }
export function developmentFilterHref(filters: DevelopmentFilters, updates: Partial<DevelopmentFilters>) {
  return `/development?${developmentFiltersToQuery({ ...filters, ...updates, page: 1 })}`;
}

function analyticsFilters(filters: DevelopmentFilters) {
  return filtersForDevelopmentRpc(developmentFiltersSchema.parse({ reportingYearMode: filters.reportingYearMode, reportingYear: filters.reportingYear }));
}
function first(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }
function failure<T>(title: string, error: { message: string; code?: string | null }): DevelopmentLoadResult<T> {
  const missingMigration = error.code === "PGRST202" || error.code === "42883" || error.message.toLocaleLowerCase().includes("schema cache");
  return { data: null, error: { title: missingMigration ? "Development reporting migration required" : title, message: missingMigration
    ? "Apply all Supabase migrations through 202607200004 and reload the PostgREST schema cache. Existing reporting data has not been replaced with zeroes."
    : error.message, code: error.code ?? null } };
}
function errorFromUnknown(error: unknown) { return error instanceof Error ? { message: error.message } : { message: "The reporting request failed before the database returned a response." }; }
