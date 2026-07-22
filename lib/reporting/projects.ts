import { filtersToQuery, type ReportingFilters } from "@/lib/reporting/filters";
import type { CustomFieldFilterOption } from "@/lib/reporting/options";
import { verticalStateLabel, type VerticalState } from "@/lib/wrike/vertical-normalization";

export type ProjectPersonOption = {
  wrikeId: string;
  name: string;
  resolved: boolean;
  displayable?: boolean;
  verified?: boolean;
  verificationSource?: "wrike_contact" | "email_match" | "task_name" | "configured_fallback" | "manual_mapping" | "unresolved";
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
  owner: /^(instructional designer|course owner|project owner|owner|id|id assigned)$/i,
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

export function projectFilterValues(value: string | string[] | undefined) {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}

export function projectPersonLabel(value: string, people: readonly ProjectPersonOption[]) {
  return resolveProjectPerson(value, people).label;
}

export function projectPersonOptions(field: CustomFieldFilterOption | null, people: readonly ProjectPersonOption[]) {
  return (field?.values ?? []).map((value) => ({ value, ...resolveProjectPerson(value, people) }))
    .sort((left, right) => Number(right.resolved) - Number(left.resolved) || left.label.localeCompare(right.label));
}

export function projectContactValues(values: readonly string[], people: readonly ProjectPersonOption[]) {
  return values.map((value) => ({ id: value, ...resolveProjectPerson(value, people) }));
}

const WRIKE_USER_ID_PATTERN = /^KU[A-Z0-9]+$/i;

export function projectOverviewContactValues(values: readonly string[], people: readonly ProjectPersonOption[]) {
  return values.map((sourceValue) => {
    const value = sourceValue.trim();
    const personById = people.find((person) => person.wrikeId.toLocaleLowerCase() === value.toLocaleLowerCase());
    if (personById) {
      const readableName = projectPersonName(personById);
      if (readableName) return personDisplayState(personById.wrikeId, readableName, personById);
      return unavailablePersonState(personById.wrikeId);
    }
    const personByName = people.find((person) => person.name.trim().toLocaleLowerCase() === value.toLocaleLowerCase());
    if (personByName) return personDisplayState(value, personByName.name, personByName);
    if (WRIKE_USER_ID_PATTERN.test(value)) return unavailablePersonState(value);
    return { id: value, label: value, resolved: true, displayable: true, verified: false, verificationSource: "task_name" as const, referenceId: null };
  });
}

export function projectTableVerticalLabel(field: { values: string[]; normalizedVerticals?: string[] | null } | undefined, state?: VerticalState) {
  if (state === "cross_vertical") return "Cross-Vertical";
  const normalized = field?.normalizedVerticals?.filter(Boolean).join(", ");
  if (normalized) return normalized;
  const values = field?.values.filter(Boolean).join(", ");
  if (values) return values;
  return state && state !== "resolved" ? verticalStateLabel(state) : "—";
}

function resolveProjectPerson(sourceValue: string, people: readonly ProjectPersonOption[]) {
  const value = sourceValue.trim();
  const person = people.find((candidate) => candidate.wrikeId.toLocaleLowerCase() === value.toLocaleLowerCase())
    ?? people.find((candidate) => candidate.name.trim().toLocaleLowerCase() === value.toLocaleLowerCase());
  const name = person ? projectPersonName(person) : null;
  if (name) return { label: name, resolved: true, displayable: true, verified: person?.verified ?? false, verificationSource: person?.verificationSource ?? "task_name" as const };
  const displayable = !WRIKE_USER_ID_PATTERN.test(value);
  return { label: displayable ? value : `${value} — Name unavailable`, resolved: displayable, displayable, verified: false, verificationSource: displayable ? "task_name" as const : "unresolved" as const };
}

function projectPersonName(person: ProjectPersonOption) {
  const name = person.name.trim();
  if (!name || name.toLocaleLowerCase() === person.wrikeId.toLocaleLowerCase() || /^(?:unresolved|unverified) (?:wrike )?(?:user|person)\b/i.test(name)) return null;
  return name;
}

function personDisplayState(id: string, label: string, person: ProjectPersonOption) {
  return { id, label, resolved: true, displayable: true, verified: person.verified ?? person.resolved, verificationSource: person.verificationSource ?? (person.resolved ? "wrike_contact" as const : "task_name" as const), referenceId: null };
}

function unavailablePersonState(id: string) {
  return { id, label: id, resolved: false, displayable: false, verified: false, verificationSource: "unresolved" as const, referenceId: id };
}

export function projectFilterHref(filters: ReportingFilters, changes: Record<string, string | number | boolean | readonly string[] | null | undefined>, returnTo?: string) {
  const target: Record<string, unknown> = { ...filters, page: 1, customFields: { ...(filters.customFields ?? {}) } };
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
