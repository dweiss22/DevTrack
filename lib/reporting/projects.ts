import { filtersToQuery, type ReportingFilters } from "@/lib/reporting/filters";
import type { CustomFieldFilterOption } from "@/lib/reporting/options";

export type ProjectPersonOption = {
  wrikeId: string;
  name: string;
  resolved: boolean;
};

export type ProjectFilterFields = {
  reporting: CustomFieldFilterOption | null;
  owner: CustomFieldFilterOption | null;
  tool: CustomFieldFilterOption | null;
  courseType: CustomFieldFilterOption | null;
  vertical: CustomFieldFilterOption | null;
  sme: CustomFieldFilterOption | null;
  courseLength: CustomFieldFilterOption | null;
  legalReviewer: CustomFieldFilterOption | null;
};

const FIELD_PATTERNS = {
  reporting: /^(reporting|reporting year)$/i,
  owner: /^(instructional designer|course owner|project owner|owner|id)$/i,
  tool: /^(authoring tool|authoring tool used)$/i,
  courseType: /^(course type|course development type)$/i,
  vertical: /^vertical$/i,
  sme: /^(sme|smes|subject matter expert|subject matter experts)$/i,
  courseLength: /^(course length|course duration|estimated course length)$/i,
  legalReviewer: /^legal reviewer$/i
} satisfies Record<keyof ProjectFilterFields, RegExp>;

export const PROJECT_OVERVIEW_FIELD_ROLES = new Set<keyof ProjectFilterFields>(["reporting", "owner", "vertical", "courseLength", "tool", "sme", "legalReviewer"]);

export function projectFilterFields(options: readonly CustomFieldFilterOption[]): ProjectFilterFields {
  const find = (pattern: RegExp) => options.find((field) => pattern.test(field.name.trim())) ?? null;
  return {
    reporting: find(FIELD_PATTERNS.reporting),
    owner: find(FIELD_PATTERNS.owner),
    tool: find(FIELD_PATTERNS.tool),
    courseType: find(FIELD_PATTERNS.courseType),
    vertical: find(FIELD_PATTERNS.vertical),
    sme: find(FIELD_PATTERNS.sme),
    courseLength: find(FIELD_PATTERNS.courseLength),
    legalReviewer: find(FIELD_PATTERNS.legalReviewer)
  };
}

export function projectFieldRole(name: string): keyof ProjectFilterFields | null {
  const normalized = name.trim();
  return (Object.entries(FIELD_PATTERNS) as [keyof ProjectFilterFields, RegExp][]).find(([, pattern]) => pattern.test(normalized))?.[0] ?? null;
}

export function projectOverviewFieldKeys(fields: readonly { normalizedKey: string }[]) {
  return new Set(fields.flatMap((field) => {
    const role = projectFieldRole(field.normalizedKey);
    return role && PROJECT_OVERVIEW_FIELD_ROLES.has(role) ? [field.normalizedKey] : [];
  }));
}

export function reportingYearOptions(field: CustomFieldFilterOption | null) {
  const years = new Set<number>();
  for (const value of field?.values ?? []) {
    const match = value.trim().match(/^((?:19|20|21)\d{2}) Courses$/i);
    if (match) years.add(Number(match[1]));
  }
  return [...years].sort((left, right) => right - left);
}

export function projectPersonLabel(value: string, people: readonly ProjectPersonOption[]) {
  const person = people.find((candidate) => candidate.wrikeId === value);
  if (!person || !person.resolved) return `Unresolved Wrike user ${value}`;
  return person.name;
}

export function projectPersonOptions(field: CustomFieldFilterOption | null, people: readonly ProjectPersonOption[]) {
  return (field?.values ?? []).map((value) => ({
    value,
    label: projectPersonLabel(value, people),
    resolved: Boolean(people.find((person) => person.wrikeId === value)?.resolved)
  })).sort((left, right) => Number(right.resolved) - Number(left.resolved) || left.label.localeCompare(right.label));
}

export function projectContactValues(values: readonly string[], people: readonly ProjectPersonOption[]) {
  return values.map((value) => ({
    id: value,
    label: projectPersonLabel(value, people),
    resolved: Boolean(people.find((person) => person.wrikeId === value)?.resolved)
  }));
}

export function projectFilterHref(filters: ReportingFilters, changes: Record<string, string | number | boolean | null | undefined>, returnTo?: string) {
  const target: Record<string, unknown> = { ...filters, page: 1, customFields: { ...(filters.customFields ?? {}) } };
  for (const [key, value] of Object.entries(changes)) {
    if (key.startsWith("cf_")) {
      const id = key.slice(3);
      const custom = target.customFields as Record<string, string>;
      if (value == null || value === "") delete custom[id];
      else custom[id] = String(value);
      continue;
    }
    if (value == null || value === "") delete target[key];
    else target[key] = value;
  }
  if (!Object.keys(target.customFields as Record<string, string>).length) delete target.customFields;
  const query = new URLSearchParams(filtersToQuery(target as Partial<ReportingFilters>));
  if (returnTo) query.set("returnTo", returnTo);
  return `/projects${query.size ? `?${query}` : ""}`;
}

export function clearProjectFiltersHref(filters: ReportingFilters, returnTo?: string) {
  const query = new URLSearchParams(filtersToQuery({ sort: filters.sort, page: 1, pageSize: filters.pageSize }));
  if (returnTo) query.set("returnTo", returnTo);
  return `/projects?${query}`;
}

export function extractFieldYear(values: readonly string[]) {
  const years = new Set(values.map((value) => value.trim().match(/^((?:19|20|21)\d{2}) Courses$/i)?.[1]).filter((value): value is string => Boolean(value)));
  return years.size === 1 ? [...years][0] : null;
}
