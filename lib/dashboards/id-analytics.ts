import type { SupabaseClient } from "@supabase/supabase-js";

export type IdDevelopmentYear = {
  year: number;
  projectCount: number;
  averageMinutes: number | null;
  totalMinutes: number | null;
};

export type IdCategoryAverage = {
  name: string;
  averageMinutes: number;
  totalMinutes: number;
  percentage: number;
};

export type IdCategoryPeriod = {
  year: number | null;
  qualifyingProjectCount: number;
  totalMinutes: number;
  entryCount: number;
  categories: IdCategoryAverage[];
};

export type IdOtherIdentityYears = {
  wrikeUserId: string;
  displayName: string;
  points: { year: number; averageMinutes: number | null }[];
};

export type IdCurrentYearProgress = {
  year: number;
  startMinutes: number;
  currentAverageMinutes: number | null;
  asOfDate: string | null;
};

export type IdDashboardAnalytics = {
  timeDataSynchronized: boolean;
  developmentTimeByYear: IdDevelopmentYear[];
  categoryTime: {
    denominatorDefinition: string;
    allTime: IdCategoryPeriod;
    years: IdCategoryPeriod[];
  };
  otherIdentitiesByYear: IdOtherIdentityYears[];
  yAxisMaxMinutes: number | null;
  currentYearProgress: IdCurrentYearProgress | null;
};

export type IdDashboardAnalyticsResult =
  | { data: IdDashboardAnalytics; error: null }
  | { data: null; error: string };

const EMPTY_PERIOD: IdCategoryPeriod = {
  year: null,
  qualifyingProjectCount: 0,
  totalMinutes: 0,
  entryCount: 0,
  categories: [],
};

export const EMPTY_ID_DASHBOARD_ANALYTICS: IdDashboardAnalytics = {
  timeDataSynchronized: false,
  developmentTimeByYear: [],
  categoryTime: {
    denominatorDefinition: "Distinct ID-assigned projects on which the selected ID logged time, grouped by course reporting year.",
    allTime: EMPTY_PERIOD,
    years: [],
  },
  otherIdentitiesByYear: [],
  yAxisMaxMinutes: null,
  currentYearProgress: null,
};

export async function loadIdDashboardAnalytics(
  supabase: SupabaseClient,
  targetWrikeUserId: string,
): Promise<IdDashboardAnalyticsResult> {
  try {
    const { data, error } = await supabase.rpc("reporting_id_dashboard_analytics", {
      target_wrike_user_id: targetWrikeUserId,
    });
    if (error) {
      console.error("id_dashboard_analytics_failed", { code: error.code });
      return {
        data: null,
        error: error.code === "PGRST202" || error.code === "42883"
          ? "ID Dashboard analytics require the latest database migration."
          : "ID Dashboard analytics could not be loaded.",
      };
    }
    return { data: normalizeIdDashboardAnalytics(data), error: null };
  } catch {
    return { data: null, error: "ID Dashboard analytics could not be loaded." };
  }
}

export function normalizeIdDashboardAnalytics(value: unknown): IdDashboardAnalytics {
  if (!value || typeof value !== "object") return EMPTY_ID_DASHBOARD_ANALYTICS;
  const candidate = value as Partial<IdDashboardAnalytics>;
  const categoryTime = candidate.categoryTime;
  return {
    timeDataSynchronized: Boolean(candidate.timeDataSynchronized),
    developmentTimeByYear: Array.isArray(candidate.developmentTimeByYear)
      ? candidate.developmentTimeByYear.map((row) => ({
        year: Number(row.year),
        projectCount: Number(row.projectCount),
        averageMinutes: row.averageMinutes == null ? null : Number(row.averageMinutes),
        totalMinutes: row.totalMinutes == null ? null : Number(row.totalMinutes),
      }))
      : [],
    categoryTime: {
      denominatorDefinition: categoryTime?.denominatorDefinition
        ?? EMPTY_ID_DASHBOARD_ANALYTICS.categoryTime.denominatorDefinition,
      allTime: normalizeCategoryPeriod(categoryTime?.allTime, null),
      years: Array.isArray(categoryTime?.years)
        ? categoryTime.years.map((period) => normalizeCategoryPeriod(period, Number(period.year)))
        : [],
    },
    otherIdentitiesByYear: Array.isArray(candidate.otherIdentitiesByYear)
      ? candidate.otherIdentitiesByYear.map((identity) => ({
        wrikeUserId: String(identity.wrikeUserId),
        displayName: identity.displayName || "Instructional Designer",
        points: Array.isArray(identity.points)
          ? identity.points.map((point) => ({
            year: Number(point.year),
            averageMinutes: point.averageMinutes == null ? null : Number(point.averageMinutes),
          }))
          : [],
      }))
      : [],
    yAxisMaxMinutes: candidate.yAxisMaxMinutes == null ? null : Number(candidate.yAxisMaxMinutes),
    currentYearProgress: candidate.currentYearProgress == null ? null : {
      year: Number(candidate.currentYearProgress.year),
      startMinutes: Number(candidate.currentYearProgress.startMinutes),
      currentAverageMinutes: candidate.currentYearProgress.currentAverageMinutes == null
        ? null : Number(candidate.currentYearProgress.currentAverageMinutes),
      asOfDate: candidate.currentYearProgress.asOfDate ?? null,
    },
  };
}

export function categoryPeriodForYear(
  analytics: IdDashboardAnalytics,
  year: "all" | number,
) {
  if (year === "all") return analytics.categoryTime.allTime;
  return analytics.categoryTime.years.find((period) => period.year === year) ?? {
    ...EMPTY_PERIOD,
    year,
  };
}

function normalizeCategoryPeriod(value: unknown, fallbackYear: number | null): IdCategoryPeriod {
  if (!value || typeof value !== "object") return { ...EMPTY_PERIOD, year: fallbackYear };
  const period = value as Partial<IdCategoryPeriod>;
  return {
    year: period.year == null ? fallbackYear : Number(period.year),
    qualifyingProjectCount: Number(period.qualifyingProjectCount ?? 0),
    totalMinutes: Number(period.totalMinutes ?? 0),
    entryCount: Number(period.entryCount ?? 0),
    categories: Array.isArray(period.categories)
      ? period.categories.map((category) => ({
        name: category.name || "Uncategorized",
        averageMinutes: Number(category.averageMinutes ?? 0),
        totalMinutes: Number(category.totalMinutes ?? 0),
        percentage: Number(category.percentage ?? 0),
      })).filter((category) => category.totalMinutes > 0)
      : [],
  };
}
