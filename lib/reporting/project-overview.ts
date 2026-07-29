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

  // Unitless integers and decimals remain deliberately ambiguous.
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
  if (typeof source === "number") return null;
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
  length_minutes: number | string | null;
  course_style: string | null;
  target_minutes: number | string | null;
  cohort_average_minutes: number | string | null;
  cohort_median_minutes: number | string | null;
  cohort_size: number | string | null;
  lower_count: number | string | null;
  tie_count: number | string | null;
  unavailable_reason: string | null;
};

export type ProjectLengthBenchmark = {
  lengthMinutes: number | null;
  courseStyle: string | null;
  targetMinutes: number | null;
  cohortAverageMinutes: number | null;
  cohortMedianMinutes: number | null;
  cohortSize: number;
  percentile: number | null;
  unavailableReason: string | null;
};

export function projectLengthBenchmark(row: ProjectLengthBenchmarkRow | null): ProjectLengthBenchmark | null {
  if (!row) return null;
  const lengthMinutes = nullableFiniteNumber(row.length_minutes);
  const targetMinutes = nullableFiniteNumber(row.target_minutes);
  const cohortAverageMinutes = nullableFiniteNumber(row.cohort_average_minutes);
  const cohortMedianMinutes = nullableFiniteNumber(row.cohort_median_minutes);
  const cohortSize = nullableFiniteNumber(row.cohort_size) ?? 0;
  const lowerCount = nullableFiniteNumber(row.lower_count);
  const tieCount = nullableFiniteNumber(row.tie_count);
  const unavailableReason = row.unavailable_reason
    ?? (!row.course_style || cohortMedianMinutes == null ? "benchmark_definition_outdated" : null);
  const percentile = unavailableReason == null && lowerCount != null && tieCount != null
    ? percentileRankFromCounts(lowerCount, tieCount, cohortSize)
    : null;
  return {
    lengthMinutes,
    courseStyle: row.course_style,
    targetMinutes,
    cohortAverageMinutes,
    cohortMedianMinutes,
    cohortSize,
    percentile,
    unavailableReason: percentile == null && unavailableReason == null
      ? "not_enough_completed_comparable_courses"
      : unavailableReason
  };
}

function nullableFiniteNumber(value: number | string | null) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

const BENCHMARK_UNAVAILABLE_MESSAGES: Record<string, string> = {
  project_deleted: "Project is deleted.",
  completion_status_unresolved: "Project completion status is unresolved.",
  wrong_workflow: "Project is outside the Online Learning workflow.",
  project_not_completed: "Project is not completed.",
  custom_fields_incomplete: "Course details are not fully synchronized.",
  course_length_missing: "Course Length is missing.",
  course_length_invalid: "Course Length is invalid.",
  course_length_ambiguous: "Course Length is ambiguous.",
  course_style_missing: "Course Style is missing.",
  course_style_unrecognized: "Course Style is not recognized.",
  course_style_ambiguous: "Course Style is ambiguous.",
  time_entry_data_incomplete: "Time-entry data is incomplete.",
  not_enough_completed_comparable_courses: "Not enough completed comparable courses.",
  benchmark_definition_outdated: "Benchmark data is temporarily unavailable."
};

export function projectBenchmarkUnavailableMessage(reason: string | null | undefined) {
  return reason
    ? BENCHMARK_UNAVAILABLE_MESSAGES[reason] ?? "Benchmark data is unavailable."
    : "Benchmark data is unavailable.";
}
