import { normalizeProjectDate } from "@/lib/projects/timeline";

export type DashboardProjectOrderRow = {
  task_id: string;
  title: string;
  publication_date?: string | null;
  completed_at?: string | null;
  due_date?: string | null;
  original_due_date?: string | null;
  start_date?: string | null;
  updated_at_wrike?: string | null;
  reporting_year?: number | null;
  reviewed_sme_name?: string | null;
};

export function sortDashboardProjectsNewestFirst<T extends DashboardProjectOrderRow>(
  rows: readonly T[],
): T[] {
  return [...rows].sort((left, right) => {
    const recency = dashboardProjectRecency(right) - dashboardProjectRecency(left);
    if (recency) return recency;
    const title = left.title.localeCompare(right.title, undefined, { sensitivity: "base" });
    if (title) return title;
    const task = left.task_id.localeCompare(right.task_id);
    if (task) return task;
    return (left.reviewed_sme_name ?? "").localeCompare(right.reviewed_sme_name ?? "", undefined, {
      sensitivity: "base",
    });
  });
}

export function dashboardProjectRecency(row: DashboardProjectOrderRow): number {
  const projectDates = [
    row.publication_date,
    row.completed_at,
    row.due_date,
    row.original_due_date,
    row.start_date,
  ].map(dateTimestamp).filter((value): value is number => value != null);
  if (projectDates.length) return Math.max(...projectDates);
  if (row.reporting_year && Number.isInteger(row.reporting_year)) {
    return Date.UTC(row.reporting_year, 11, 31);
  }
  return dateTimestamp(row.updated_at_wrike) ?? Number.NEGATIVE_INFINITY;
}

function dateTimestamp(value: string | null | undefined) {
  const normalized = normalizeProjectDate(value);
  if (!normalized) return null;
  const [year, month, day] = normalized.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}
