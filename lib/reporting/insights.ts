import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { filtersForRpc, filtersToQuery, parseReportingFilters, type ReportingFilters } from "@/lib/reporting/filters";
import type { StatusFilterOption } from "@/lib/reporting/options";
import { projectFilterValues, projectPersonLabel, type ProjectFilterFields, type ProjectPersonOption } from "@/lib/reporting/projects";
import { verticalStateLabel } from "@/lib/wrike/vertical-normalization";

export type HoursPeriod = { periodStart: string; label: string; minutes: number; cumulativeMinutes: number; projectCount: number };
export type HoursTimeseries = { totalCourses: number; totalMinutes: number; periods: HoursPeriod[] };

const rpcPeriodSchema = z.object({ periodStart: z.string(), minutes: z.coerce.number(), projectCount: z.coerce.number() });
const rpcResultSchema = z.object({ totalCourses: z.coerce.number(), totalMinutes: z.coerce.number(), periods: z.array(rpcPeriodSchema) });

export async function loadHoursTimeseries(supabase: SupabaseClient, filters: ReportingFilters) {
  const { data, error } = await supabase.rpc("reporting_hours_timeseries", { filters: filtersForRpc(filters) });
  if (error) throw error;
  const parsed = rpcResultSchema.parse(data);
  let running = 0;
  const periods = parsed.periods.map((period) => {
    running += period.minutes;
    return { periodStart: period.periodStart, label: periodLabel(period.periodStart), minutes: period.minutes, cumulativeMinutes: running, projectCount: period.projectCount };
  });
  return { totalCourses: parsed.totalCourses, totalMinutes: parsed.totalMinutes, periods } satisfies HoursTimeseries;
}

export function percentDifference(a: number, b: number) {
  if (a === 0 && b === 0) return 0;
  if (a === 0) return null;
  return ((b - a) / a) * 100;
}

export function hoursFromMinutes(minutes: number) {
  return minutes / 60;
}

/** Namespaces a set of reporting filters under a query-param prefix (e.g. "a_", "b_") so two
 * independent filter sets can share one URL query string without colliding on names like `cf_<id>`. */
export function prefixFilterParams(prefix: string, params: URLSearchParams) {
  const prefixed = new URLSearchParams();
  for (const [key, value] of params.entries()) prefixed.append(`${prefix}${key}`, value);
  return prefixed;
}

export function extractPrefixedValues(query: Record<string, string | string[] | undefined>, prefix: string) {
  const values: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(query)) if (key.startsWith(prefix)) values[key.slice(prefix.length)] = value;
  return values;
}

export function parsePrefixedReportingFilters(query: Record<string, string | string[] | undefined>, prefix: string): ReportingFilters {
  return parseReportingFilters(extractPrefixedValues(query, prefix));
}

export function prefixedFiltersToQuery(prefix: string, filters: Partial<ReportingFilters>) {
  return prefixFilterParams(prefix, new URLSearchParams(filtersToQuery(filters))).toString();
}

/** The Development Analytics page's three independent filter panels: the primary Feature 1
 * filters (unprefixed) and Feature 2's Metric A / Metric B filters. An empty prefix is not simply
 * "starts with nothing" here — it specifically means "does not belong to any other panel" — so
 * this list must stay in sync with the prefixes the page actually renders panels for. */
const INSIGHTS_PANEL_PREFIXES = ["", "a_", "b_"] as const;

function ownRawParams(query: Record<string, string | string[] | undefined>, prefix: string) {
  const otherPrefixes = INSIGHTS_PANEL_PREFIXES.filter((candidate) => candidate !== prefix && candidate !== "");
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    const belongsToThisPanel = prefix === "" ? !otherPrefixes.some((other) => key.startsWith(other)) : key.startsWith(prefix);
    if (!belongsToThisPanel) continue;
    for (const item of Array.isArray(value) ? value : value == null ? [] : [value]) params.append(key, item);
  }
  return params;
}

/** Query-string entries belonging to the OTHER filter panels (not `prefix`'s own panel), so one
 * panel's links and form submissions never drop another panel's selections. Because the primary
 * panel's prefix is "", its own params are identified by exclusion (not `a_`/`b_`-prefixed), not
 * by a literal `startsWith("")` check, which would otherwise match every key. */
export function foreignFilterParams(query: Record<string, string | string[] | undefined>, prefix: string) {
  const params = new URLSearchParams();
  for (const otherPrefix of INSIGHTS_PANEL_PREFIXES) {
    if (otherPrefix === prefix) continue;
    for (const [key, value] of ownRawParams(query, otherPrefix).entries()) params.append(key, value);
  }
  return params;
}

export function insightsFilterHref(pathname: string, foreignParams: URLSearchParams, prefix: string, filters: ReportingFilters, changes: Record<string, string | number | boolean | readonly string[] | null | undefined>) {
  const target: Record<string, unknown> = { ...filters, customFields: { ...(filters.customFields ?? {}) } };
  for (const [key, value] of Object.entries(changes)) {
    if (key.startsWith("cf_")) {
      const id = key.slice(3);
      const custom = target.customFields as Record<string, string | readonly string[]>;
      if (value == null || value === "") delete custom[id];
      else custom[id] = Array.isArray(value) ? value : String(value);
      continue;
    }
    if (value == null || value === "") delete target[key];
    else target[key] = value;
  }
  if (!Object.keys(target.customFields as Record<string, string>).length) delete target.customFields;
  const own = prefixFilterParams(prefix, new URLSearchParams(filtersToQuery(target as Partial<ReportingFilters>)));
  const query = new URLSearchParams(foreignParams);
  for (const [key, value] of own.entries()) query.append(key, value);
  return `${pathname}${query.size ? `?${query}` : ""}`;
}

export function clearInsightsFiltersHref(pathname: string, foreignParams: URLSearchParams) {
  const query = new URLSearchParams(foreignParams);
  return `${pathname}${query.size ? `?${query}` : ""}`;
}

/** Swaps every query-param key namespaced under `prefixA` with `prefixB` (and vice versa),
 * leaving all other params untouched — used by Feature 2's "Swap A / B" control. */
export function swapPrefixedFiltersHref(pathname: string, query: Record<string, string | string[] | undefined>, prefixA: string, prefixB: string) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    const newKey = key.startsWith(prefixA) ? prefixB + key.slice(prefixA.length) : key.startsWith(prefixB) ? prefixA + key.slice(prefixB.length) : key;
    for (const item of Array.isArray(value) ? value : value == null ? [] : [value]) params.append(newKey, item);
  }
  return `${pathname}${params.size ? `?${params}` : ""}`;
}

/** A short, human label summarizing what a filter panel is currently scoped to (e.g. "2026 ·
 * Completed"), used to auto-title the Metric A / Metric B comparison panels instead of leaving
 * them as bare placeholders. Falls back to "All courses" when nothing is selected. */
export function summarizeReportingFilters(filters: ReportingFilters, context: { fields: ProjectFilterFields; statuses: readonly StatusFilterOption[]; people: readonly ProjectPersonOption[] }) {
  const parts: string[] = [];
  const years = filters.reportingYears?.length ? filters.reportingYears : filters.reportingYear != null ? [filters.reportingYear] : [];
  if (years.length === 1) parts.push(String(years[0]));
  else if (years.length > 1) parts.push(`${Math.min(...years)}–${Math.max(...years)}`);
  if (filters.statuses?.length === 1) parts.push(context.statuses.find((status) => status.id === filters.statuses![0])?.name ?? "1 status");
  else if (filters.statuses?.length) parts.push(`${filters.statuses.length} statuses`);
  const ownerValues = context.fields.owner ? projectFilterValues(filters.customFields?.[context.fields.owner.id]) : [];
  if (ownerValues.length === 1) parts.push(projectPersonLabel(ownerValues[0], context.people));
  else if (ownerValues.length) parts.push(`${ownerValues.length} designers`);
  if (parts.length < 2) {
    const toolValues = context.fields.tool ? projectFilterValues(filters.customFields?.[context.fields.tool.id]) : [];
    if (toolValues.length === 1) parts.push(toolValues[0]);
    else if (toolValues.length) parts.push(`${toolValues.length} tools`);
  }
  return parts.length ? parts.slice(0, 2).join(" · ") : "All courses";
}

export function verticalSelectionLabel(value: string) {
  if (value.startsWith("associated:")) return value.slice("associated:".length);
  if (value.startsWith("category:")) return value.slice("category:".length).replace("Cross Vertical", "Cross-Vertical");
  if (value.startsWith("state:")) return verticalStateLabel(value.slice("state:".length) as Parameters<typeof verticalStateLabel>[0]);
  return "Any Vertical issue";
}

/** The full, human-readable list of a filter panel's active selections (e.g. "Year: 2026",
 * "Designer: Jane Doe"), used to record what a chart's exported image was actually filtered to.
 * Unlike summarizeReportingFilters, this isn't truncated to a short title. */
export function activeReportingFilterLabels(filters: ReportingFilters, context: { fields: ProjectFilterFields; statuses: readonly StatusFilterOption[]; people: readonly ProjectPersonOption[] }): string[] {
  const labels: string[] = [];
  const years = filters.reportingYears?.length ? filters.reportingYears : filters.reportingYear != null ? [filters.reportingYear] : [];
  for (const year of years) labels.push(`Year: ${year}`);
  for (const statusId of filters.statuses ?? []) labels.push(`Status: ${context.statuses.find((status) => status.id === statusId)?.name ?? statusId}`);
  for (const [field, prefixLabel, contact] of [
    [context.fields.owner, "Designer", true], [context.fields.tool, "Tools", false],
    [context.fields.courseType, "Course Type", false], [context.fields.courseStyle, "Course Style", false], [context.fields.courseLength, "Course Length", false]
  ] as const) {
    if (!field) continue;
    for (const value of projectFilterValues(filters.customFields?.[field.id])) labels.push(`${prefixLabel}: ${contact ? projectPersonLabel(value, context.people) : value}`);
  }
  for (const selected of filters.verticalSelections ?? []) labels.push(`Vertical: ${verticalSelectionLabel(selected)}`);
  return labels;
}

function periodLabel(periodStart: string) {
  const date = new Date(`${periodStart}T00:00:00Z`);
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
}
