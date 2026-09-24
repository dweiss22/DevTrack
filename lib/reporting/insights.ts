import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { filtersForRpc, filtersToQuery, parseReportingFilters, type ReportingFilters } from "@/lib/reporting/filters";

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

function periodLabel(periodStart: string) {
  const date = new Date(`${periodStart}T00:00:00Z`);
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
}
