export const MIN_PERCENTILE_COHORT_SIZE = 5;

function positiveMinutes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}

function parseCourseLengthString(source: string) {
  const value = source.trim().toLowerCase().replace(/\s+/g, " ");
  if (!value) return null;

  const clock = value.match(/^(\d{1,4}):([0-5]\d)(?:\s*(?:hours?|hrs?|h))?$/);
  if (clock) return positiveMinutes(Number(clock[1]) * 60 + Number(clock[2]));

  const hoursAndMinutes = value.match(/^(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\s*(?:and\s*)?(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)$/);
  if (hoursAndMinutes) return positiveMinutes(Number(hoursAndMinutes[1]) * 60 + Number(hoursAndMinutes[2]));

  const hours = value.match(/^(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)$/);
  if (hours) return positiveMinutes(Number(hours[1]) * 60);

  const minutes = value.match(/^(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)$/);
  if (minutes) return positiveMinutes(Number(minutes[1]));

  // A bare decimal is an observed Wrike representation for decimal hours.
  // Bare integers remain deliberately ambiguous and are not interpreted.
  if (/^\d+\.\d+$/.test(value)) return positiveMinutes(Number(value) * 60);
  return null;
}

export function parseCourseLengthMinutes(source: unknown): number | null {
  if (Array.isArray(source)) {
    const populated = source.filter((value) => value != null && String(value).trim() !== "");
    if (!populated.length) return null;
    const parsed = populated.map(parseCourseLengthMinutes);
    if (parsed.some((value) => value == null)) return null;
    const distinct = new Set(parsed as number[]);
    return distinct.size === 1 ? [...distinct][0] : null;
  }
  if (typeof source === "number") return Number.isInteger(source) ? null : positiveMinutes(source * 60);
  if (typeof source !== "string") return null;
  return parseCourseLengthString(source);
}

export function formatCourseLength(minutes: number | null) {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return null;
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const remaining = rounded % 60;
  return `${String(hours).padStart(2, "0")}:${String(remaining).padStart(2, "0")} hours`;
}

export function formatVerticalMembership(values: readonly string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].join(", ") || null;
}

export function percentileRankFromCounts(lowerCount: number, tieCount: number, cohortSize: number, minimum = MIN_PERCENTILE_COHORT_SIZE) {
  if (![lowerCount, tieCount, cohortSize].every(Number.isFinite) || cohortSize < minimum || tieCount < 1 || lowerCount < 0 || lowerCount + tieCount > cohortSize) return null;
  return 100 * (lowerCount + 0.5 * tieCount) / cohortSize;
}

export function percentileRank(targetMinutes: number | null, cohortMinutes: readonly number[], minimum = MIN_PERCENTILE_COHORT_SIZE) {
  if (targetMinutes == null || !Number.isFinite(targetMinutes)) return null;
  const valid = cohortMinutes.filter((value) => Number.isFinite(value) && value >= 0);
  const lower = valid.filter((value) => value < targetMinutes).length;
  const ties = valid.filter((value) => value === targetMinutes).length;
  return percentileRankFromCounts(lower, ties, valid.length, minimum);
}

export function formatOrdinal(value: number) {
  const rounded = Math.round(value);
  const mod100 = rounded % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[rounded % 10] ?? "th";
  return `${rounded}${suffix}`;
}

export type ProjectLengthBenchmarkRow = {
  length_minutes: number | string;
  target_minutes: number | string;
  cohort_average_minutes: number | string;
  cohort_size: number | string;
  lower_count: number | string;
  tie_count: number | string;
};

export type ProjectLengthBenchmark = {
  lengthMinutes: number;
  targetMinutes: number;
  cohortAverageMinutes: number;
  cohortSize: number;
  percentile: number | null;
};

export function projectLengthBenchmark(row: ProjectLengthBenchmarkRow | null): ProjectLengthBenchmark | null {
  if (!row) return null;
  const lengthMinutes = Number(row.length_minutes);
  const targetMinutes = Number(row.target_minutes);
  const cohortAverageMinutes = Number(row.cohort_average_minutes);
  const cohortSize = Number(row.cohort_size);
  const percentile = percentileRankFromCounts(Number(row.lower_count), Number(row.tie_count), cohortSize);
  if (![lengthMinutes, targetMinutes, cohortAverageMinutes, cohortSize].every(Number.isFinite) || lengthMinutes <= 0) return null;
  return { lengthMinutes, targetMinutes, cohortAverageMinutes, cohortSize, percentile };
}
