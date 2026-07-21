export type ProjectTimeEntry = {
  id: string;
  sourceId: string;
  date: string;
  minutes: number;
  contributorId: string;
  contributorName: string;
  contributorResolved: boolean;
  categoryId: string;
  categoryName: string;
  categoryResolved: boolean;
  comment: string | null;
};

export type ProjectTimeFilters = { from?: string; to?: string; contributorId?: string; categoryId?: string };
export type TimeGrain = "day" | "week" | "month";
export type ProjectTimePoint = { key: string; label: string; minutes: number; hours: number; entries: number };

export function filterProjectTime(entries: readonly ProjectTimeEntry[], filters: ProjectTimeFilters) {
  return entries.filter((entry) => (!filters.from || entry.date >= filters.from)
    && (!filters.to || entry.date <= filters.to)
    && (!filters.contributorId || entry.contributorId === filters.contributorId)
    && (!filters.categoryId || entry.categoryId === filters.categoryId));
}

export function projectTimeMetrics(entries: readonly ProjectTimeEntry[]) {
  return {
    minutes: entries.reduce((total, entry) => total + entry.minutes, 0),
    entries: entries.length,
    contributors: new Set(entries.map((entry) => entry.contributorId)).size
  };
}

export function groupProjectTimeOverTime(entries: readonly ProjectTimeEntry[], grain: TimeGrain): ProjectTimePoint[] {
  const grouped = new Map<string, { minutes: number; entries: number }>();
  for (const entry of entries) {
    const key = grainKey(entry.date, grain);
    const current = grouped.get(key) ?? { minutes: 0, entries: 0 };
    current.minutes += entry.minutes;
    current.entries += 1;
    grouped.set(key, current);
  }
  return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => ({
    key,
    label: grainLabel(key, grain),
    minutes: value.minutes,
    hours: value.minutes / 60,
    entries: value.entries
  }));
}

export function groupProjectTimeByContributor(entries: readonly ProjectTimeEntry[]) {
  return groupProjectTime(entries, (entry) => ({ key: entry.contributorId, label: entry.contributorName, resolved: entry.contributorResolved }));
}

export function groupProjectTimeByCategory(entries: readonly ProjectTimeEntry[]) {
  return groupProjectTime(entries, (entry) => ({ key: entry.categoryId, label: entry.categoryName, resolved: entry.categoryResolved }));
}

export function projectTimeOptions(entries: readonly ProjectTimeEntry[], kind: "contributor" | "category") {
  const options = new Map<string, { id: string; label: string; resolved: boolean }>();
  for (const entry of entries) {
    const option = kind === "contributor"
      ? { id: entry.contributorId, label: entry.contributorName, resolved: entry.contributorResolved }
      : { id: entry.categoryId, label: entry.categoryName, resolved: entry.categoryResolved };
    options.set(option.id, option);
  }
  return [...options.values()].sort((left, right) => Number(right.resolved) - Number(left.resolved) || left.label.localeCompare(right.label));
}

function groupProjectTime(entries: readonly ProjectTimeEntry[], identify: (entry: ProjectTimeEntry) => { key: string; label: string; resolved: boolean }) {
  const grouped = new Map<string, { key: string; label: string; resolved: boolean; minutes: number; entries: number }>();
  for (const entry of entries) {
    const identity = identify(entry);
    const current = grouped.get(identity.key) ?? { ...identity, minutes: 0, entries: 0 };
    current.minutes += entry.minutes;
    current.entries += 1;
    grouped.set(identity.key, current);
  }
  return [...grouped.values()].map((row) => ({ ...row, hours: row.minutes / 60 })).sort((left, right) => right.minutes - left.minutes || left.label.localeCompare(right.label));
}

function grainKey(date: string, grain: TimeGrain) {
  if (grain === "day") return date;
  if (grain === "month") return date.slice(0, 7);
  const parsed = new Date(`${date}T00:00:00Z`);
  const day = parsed.getUTCDay() || 7;
  parsed.setUTCDate(parsed.getUTCDate() - day + 1);
  return parsed.toISOString().slice(0, 10);
}

function grainLabel(key: string, grain: TimeGrain) {
  if (grain === "month") return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}-01T00:00:00Z`));
  const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}T00:00:00Z`));
  return grain === "week" ? `Week of ${date}` : date;
}
