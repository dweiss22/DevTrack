import type { NormalizedCustomFieldValue } from "@/lib/wrike/custom-field-normalization";

export const PROJECT_TIMELINE_FIELD_KEYS = {
  projectEndDate: "project end date",
  publishedDate: "published date",
  lmsPublicationDate: "lms publication date",
} as const;

export type ProjectTimelineInput = {
  startDate?: string | null;
  originalDueDate?: string | null;
  currentDueDate?: string | null;
  projectEndDate?: string | null;
  publishedDate?: string | null;
  lmsPublicationDate?: string | null;
};

export type ProjectMilestoneKind = "actual" | "planned" | "completion" | "publication";

export type ProjectMilestone = {
  id: string;
  label: string;
  date: string;
  formattedDate: string;
  kind: ProjectMilestoneKind;
  kindLabel: string;
  position: number;
  lane: number;
};

const KIND_LABELS: Record<ProjectMilestoneKind, string> = {
  actual: "Project date",
  planned: "Planned date",
  completion: "Project completion",
  publication: "Publication",
};

export function normalizeProjectDate(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
  if (iso) return validDateParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const us = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return validDateParts(Number(us[3]), Number(us[1]), Number(us[2]));
  return null;
}

export function projectTimelineInputFromNormalizedFields(
  base: Pick<ProjectTimelineInput, "startDate" | "originalDueDate" | "currentDueDate">,
  fields: readonly NormalizedCustomFieldValue[],
): ProjectTimelineInput {
  const values = new Map(fields.map((field) => [field.normalizedKey, field]));
  const lmsPublicationCandidates = [
    values.get(PROJECT_TIMELINE_FIELD_KEYS.lmsPublicationDate),
    values.get("lms publication date [lct]"),
  ].filter((field): field is NormalizedCustomFieldValue => Boolean(field));
  return {
    ...base,
    projectEndDate: unambiguousValue(values.get(PROJECT_TIMELINE_FIELD_KEYS.projectEndDate)),
    publishedDate: unambiguousValue(values.get(PROJECT_TIMELINE_FIELD_KEYS.publishedDate)),
    lmsPublicationDate: unambiguousFieldsValue(lmsPublicationCandidates),
  };
}

export function buildProjectTimeline(input: ProjectTimelineInput): ProjectMilestone[] {
  const start = normalizeProjectDate(input.startDate);
  const originalDue = normalizeProjectDate(input.originalDueDate);
  const currentDue = normalizeProjectDate(input.currentDueDate);
  const end = normalizeProjectDate(input.projectEndDate);
  const published = normalizeProjectDate(input.publishedDate);
  const lmsPublished = normalizeProjectDate(input.lmsPublicationDate);
  const raw: Array<Omit<ProjectMilestone, "formattedDate" | "position" | "lane" | "kindLabel">> = [];

  if (start) raw.push({ id: "start", label: "Start", date: start, kind: "actual" });
  if (originalDue && currentDue && originalDue === currentDue) {
    raw.push({ id: "due", label: "Due Date", date: currentDue, kind: "planned" });
  } else {
    if (originalDue) raw.push({ id: "original-due", label: "Original Due", date: originalDue, kind: "planned" });
    if (currentDue) raw.push({ id: "current-due", label: "Current Due", date: currentDue, kind: "planned" });
  }
  if (end) raw.push({ id: "project-end", label: "Project End Date", date: end, kind: "completion" });
  if (published && lmsPublished && published === lmsPublished) {
    raw.push({ id: "publication", label: "Publication Date", date: published, kind: "publication" });
  } else {
    if (published) raw.push({ id: "published", label: "Published Date", date: published, kind: "publication" });
    if (lmsPublished) raw.push({ id: "lms-publication", label: "LMS Publication Date", date: lmsPublished, kind: "publication" });
  }

  raw.sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
  if (!raw.length) return [];
  const ordinals = raw.map((item) => dateOrdinal(item.date));
  const first = Math.min(...ordinals);
  const last = Math.max(...ordinals);
  const span = last - first;
  const lanePositions: number[] = [];

  return raw.map((item, index) => {
    const position = span === 0 ? 50 : ((ordinals[index] - first) / span) * 100;
    let lane = lanePositions.findIndex((prior) => position - prior >= 18);
    if (lane === -1) lane = lanePositions.length;
    lanePositions[lane] = position;
    return {
      ...item,
      formattedDate: formatProjectDate(item.date),
      kindLabel: KIND_LABELS[item.kind],
      position,
      lane,
    };
  });
}

export function formatProjectDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function unambiguousValue(field: NormalizedCustomFieldValue | undefined) {
  return !field?.conflict && field?.displayValues.length === 1 ? field.displayValues[0] : null;
}

function unambiguousFieldsValue(fields: readonly NormalizedCustomFieldValue[]) {
  if (fields.some((field) => field.conflict)) return null;
  const distinct = [...new Set(fields.flatMap((field) => field.displayValues))];
  return distinct.length === 1 ? distinct[0] : null;
}

function validDateParts(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dateOrdinal(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}
