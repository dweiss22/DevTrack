const REPORTING_COURSE_YEAR = /^((?:19|20|21)\d{2}) Courses$/i;

export function normalizeReportingCourseYear(values: readonly string[]) {
  const populated = values.map((value) => value.trim().replace(/\s+/g, " ")).filter(Boolean);
  if (!populated.length) return null;
  const years = populated.map((value) => value.match(REPORTING_COURSE_YEAR)?.[1]).filter((value): value is string => Boolean(value));
  if (years.length !== populated.length || new Set(years).size !== 1) return null;
  return Number(years[0]);
}

export function reportingCourseYearLabel(year: number) {
  return `${year} Courses`;
}
