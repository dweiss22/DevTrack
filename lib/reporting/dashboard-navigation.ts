import { ONLINE_LEARNING_WORKFLOW_ID } from "@/lib/reporting/constants";
import { filtersToQuery, type ReportingFilters } from "@/lib/reporting/filters";

export type DashboardClassification = "active" | "completed" | "stalled_or_canceled";
export type DashboardField = "course type" | "authoring tool" | "vertical";
export type DashboardDrilldown =
  | { kind: "year"; year: number; classification?: DashboardClassification }
  | { kind: "category"; field: DashboardField; value: string };

export function dashboardDrilldownHref(filters: ReportingFilters, drilldown: DashboardDrilldown) {
  const target: Partial<ReportingFilters> = {
    ...filters,
    page: 1,
    workflowIds: [ONLINE_LEARNING_WORKFLOW_ID]
  };
  if (drilldown.kind === "year") {
    target.reportingYear = drilldown.year;
    target.dashboardClassification = drilldown.classification;
  } else {
    target.dashboardField = drilldown.field;
    target.dashboardValue = drilldown.value;
  }
  const targetQuery = new URLSearchParams(filtersToQuery(target));
  const dashboardQuery = filtersToQuery(filters);
  targetQuery.set("returnTo", dashboardQuery ? `/?${dashboardQuery}` : "/");
  return `/projects?${targetQuery.toString()}`;
}

export function safeDashboardReturnTo(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate === "/" || candidate?.startsWith("/?") ? candidate : undefined;
}

export function safeProjectsReturnTo(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate === "/projects" || candidate?.startsWith("/projects?") ? candidate : undefined;
}

export function assignedDashboardRows<T, K extends keyof T>(rows: readonly T[], key: K) {
  return rows.filter((row) => String(row[key]).trim().toLocaleLowerCase() !== "unassigned");
}
