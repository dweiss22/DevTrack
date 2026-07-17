import { reportingFiltersSchema, type ReportingFilters } from "@/lib/reporting/filters";

export type AskReference = { id: string; name: string };
export type AskCustomOption = { fieldId: string; fieldName: string; name: string };
export type AskReferences = {
  users: AskReference[];
  scopes: AskReference[];
  projects: AskReference[];
  statuses: (string | AskReference)[];
  customFields: AskReference[];
  customOptions: AskCustomOption[];
};
export type AskIntent = "list" | "count" | "time-total" | "time-average" | "time-breakdown" | "compare" | "unsupported";
export type ParsedAsk = { intent: AskIntent; filters: ReportingFilters; groupBy?: "person" | "task" | "status" | "project" | "day" | "week" | "month" | "custom"; clarification?: string[]; explanation: string };

const ymd = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: Date, amount: number) => new Date(date.getTime() + amount * 86_400_000);
function zonedToday(timeZone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(`${value.year}-${value.month}-${value.day}T00:00:00Z`);
}

export function relativeDateRange(message: string, timeZone: string, now = new Date()) {
  const text = message.toLowerCase(); const today = zonedToday(timeZone, now);
  if (/\btoday\b/.test(text)) return { from: ymd(today), to: ymd(today) };
  if (/\byesterday\b/.test(text)) { const date = addDays(today, -1); return { from: ymd(date), to: ymd(date) }; }
  const mondayOffset = (today.getUTCDay() + 6) % 7; const thisMonday = addDays(today, -mondayOffset);
  if (/\blast week\b/.test(text)) return { from: ymd(addDays(thisMonday, -7)), to: ymd(addDays(thisMonday, -1)) };
  if (/\bthis week\b/.test(text)) return { from: ymd(thisMonday), to: ymd(addDays(thisMonday, 6)) };
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  if (/\blast month\b/.test(text)) { const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)); return { from: ymd(start), to: ymd(addDays(monthStart, -1)) }; }
  if (/\bthis month\b/.test(text)) return { from: ymd(monthStart), to: ymd(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0))) };
  const quarterStartMonth = Math.floor(today.getUTCMonth() / 3) * 3;
  if (/\blast quarter\b/.test(text)) { const start = new Date(Date.UTC(today.getUTCFullYear(), quarterStartMonth - 3, 1)); const end = addDays(new Date(Date.UTC(today.getUTCFullYear(), quarterStartMonth, 1)), -1); return { from: ymd(start), to: ymd(end) }; }
  if (/\bthis quarter\b/.test(text)) { const start = new Date(Date.UTC(today.getUTCFullYear(), quarterStartMonth, 1)); const end = addDays(new Date(Date.UTC(today.getUTCFullYear(), quarterStartMonth + 3, 1)), -1); return { from: ymd(start), to: ymd(end) }; }
  const explicit = [...message.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map((match) => match[1]);
  return explicit.length ? { from: explicit[0], to: explicit[1] ?? explicit[0] } : {};
}

function referenced(message: string, candidates: AskReference[]) {
  const text = message.toLowerCase();
  const exact = candidates.filter((candidate) => candidate.name.length > 2 && text.includes(candidate.name.toLowerCase()));
  if (exact.length) return exact;
  const words = new Set(text.match(/[\p{L}\p{N}]+/gu) ?? []);
  return candidates.filter((candidate) => candidate.name.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.some((token) => token.length > 2 && words.has(token)));
}

export function parseAsk(message: string, references: AskReferences, timeZone: string, previous: Partial<ReportingFilters> = {}, now = new Date()): ParsedAsk {
  const text = message.trim();
  if (!text || text.length > 2000) throw new Error("Questions must contain between 1 and 2,000 characters.");
  const lower = text.toLowerCase();
  const users = referenced(text, references.users); const scopes = referenced(text, references.scopes); const projects = referenced(text, references.projects);
  const statusMatches = referenced(text, references.statuses.map((status) => typeof status === "string" ? { id: status, name: status } : status));
  const optionMatches = referenced(text, references.customOptions.map((option, index) => ({ id: String(index), name: option.name }))).map((match) => references.customOptions[Number(match.id)]);
  const groupedCustomFields = references.customFields.filter((field) => lower.includes(`by ${field.name.toLowerCase()}`));
  const ambiguous = users.length > 1 ? users.map((user) => user.name)
    : scopes.length > 1 ? scopes.map((scope) => scope.name)
    : projects.length > 1 ? projects.map((project) => project.name)
    : statusMatches.length > 1 ? statusMatches.map((status) => status.name)
    : optionMatches.length > 1 ? optionMatches.map((option) => `${option.fieldName}: ${option.name}`) : [];
  const clarification = ambiguous.length ? ambiguous : undefined;
  const statuses = statusMatches.map((status) => status.id);
  const quoted = text.match(/["\u201c]([^"\u201d]+)["\u201d]/)?.[1];
  const dates = relativeDateRange(text, timeZone, now);
  const groupBy = /\bby (person|people|employee|user|team member)\b/.test(lower) ? "person"
    : /\bby task\b/.test(lower) ? "task" : /\bby status\b/.test(lower) ? "status"
    : /\bby project\b/.test(lower) ? "project" : groupedCustomFields.length === 1 ? "custom" : /\bby day\b|\bdaily\b/.test(lower) ? "day"
    : /\bby week\b|\bweekly\b/.test(lower) ? "week" : /\bby month\b|\bmonthly\b/.test(lower) ? "month" : undefined;
  const recognizedList = Boolean(quoted || users.length || scopes.length || projects.length || statuses.length || optionMatches.length || Object.keys(dates).length || /\b(list|show|find|tasks?|details?|overdue|completed|cancelled|open|active|deferred)\b/.test(lower));
  const intent: AskIntent = /\bplanned\b.*\bactual\b|\bactual\b.*\bplanned\b|\bover (estimate|plan|budget)\b/.test(lower) ? "compare"
    : groupBy ? "time-breakdown" : /\baverage\b.*\b(time|hours?)\b/.test(lower) ? "time-average"
    : /\b(how much|total|sum)\b.*\b(time|hours?)\b|\b(time|hours?) spent\b/.test(lower) ? "time-total"
    : /\bhow many\b|\bcount\b/.test(lower) ? "count" : recognizedList ? "list" : "unsupported";
  const customOptionFilters = optionMatches.length === 1 ? { ...(previous.customFields ?? {}), [optionMatches[0].fieldId]: optionMatches[0].name } : previous.customFields;
  const filters = reportingFiltersSchema.parse({
    ...previous,
    ...dates,
    q: quoted ?? previous.q,
    statuses: statuses.length ? statuses : previous.statuses,
    assigneeIds: users.length === 1 ? [users[0].id] : previous.assigneeIds,
    scopeIds: scopes.length === 1 ? [scopes[0].id] : previous.scopeIds,
    projectIds: projects.length === 1 ? [projects[0].id] : previous.projectIds,
    customFields: customOptionFilters,
    groupCustomFieldId: groupedCustomFields.length === 1 ? groupedCustomFields[0].id : previous.groupCustomFieldId,
    dateField: ["time-total", "time-average", "time-breakdown", "compare"].includes(intent) ? "tracked" : previous.dateField,
    state: /\boverdue\b/.test(lower) ? "overdue" : /\bcancelled\b/.test(lower) ? "cancelled" : /\bcompleted\b/.test(lower) ? "completed" : /\b(open|active|deferred)\b/.test(lower) ? "open" : previous.state,
    timeState: /\b(no|without|zero) (recorded )?time\b/.test(lower) ? "no-time" : /\bwith (recorded )?time\b/.test(lower) ? "with-time" : previous.timeState,
    page: 1,
    pageSize: 50,
    sort: /\bmost time|highest time|top time\b/.test(lower) ? "actual" : previous.sort ?? "updated"
  });
  return { intent, filters, groupBy, clarification, explanation: clarification ? "More than one reporting value matched your question." : `Parsed as ${intent.replace("-", " ")}.` };
}
