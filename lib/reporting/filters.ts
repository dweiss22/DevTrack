import { z } from "zod";
import { APPROVED_VERTICALS, VERTICAL_REPORTING_FILTER_OPTIONS, VERTICAL_STATE_FILTER_OPTIONS } from "@/lib/wrike/vertical-normalization";

const emptyToUndefined = (value: unknown) => value === "" ? undefined : value;
const stringArray = z.union([z.string(), z.array(z.string())]).transform((value) => (Array.isArray(value) ? value : value.split(",")).map((item) => item.trim()).filter(Boolean));
const optionalDate = z.preprocess(emptyToUndefined, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional());
const optionalInteger = z.preprocess(emptyToUndefined, z.coerce.number().int().nonnegative().optional());
const optionalEnum = <T extends [string, ...string[]]>(values: T) => z.preprocess(emptyToUndefined, z.enum(values).optional());
const optionalBoolean = z.preprocess((value) => value === "true" || value === true ? true : undefined, z.boolean().optional());
const verticalSelectionTokens: [string, ...string[]] = [
  `associated:${APPROVED_VERTICALS[0]}`,
  ...APPROVED_VERTICALS.slice(1).map((value) => `associated:${value}`),
  ...VERTICAL_REPORTING_FILTER_OPTIONS.map((value) => `category:${value}`),
  ...VERTICAL_STATE_FILTER_OPTIONS.map((value) => `state:${value}`),
  "legacy:unresolved"
];

export const reportingFiltersSchema = z.object({
  q: z.preprocess(emptyToUndefined, z.string().trim().max(200).optional()),
  taskIds: stringArray.optional(),
  statuses: stringArray.optional(),
  assigneeIds: stringArray.optional(),
  scopeIds: stringArray.optional(),
  folderIds: stringArray.optional(),
  projectIds: stringArray.optional(),
  workflowIds: stringArray.optional(),
  categoryIds: stringArray.optional(),
  dateField: optionalEnum(["tracked", "due", "start", "created", "completed"]),
  from: optionalDate,
  to: optionalDate,
  state: optionalEnum(["open", "completed", "cancelled", "overdue"]),
  timeState: optionalEnum(["with-time", "no-time"]),
  minMinutes: optionalInteger,
  maxMinutes: optionalInteger,
  minPlannedMinutes: optionalInteger,
  maxPlannedMinutes: optionalInteger,
  customFields: z.record(z.string(), z.string().max(200)).optional(),
  reportingYear: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1900).max(2199).optional()),
  validReportingYearOnly: optionalBoolean,
  dashboardClassification: optionalEnum(["active", "completed", "stalled_or_canceled"]),
  dashboardField: optionalEnum(["course type", "authoring tool"]),
  dashboardValue: z.preprocess(emptyToUndefined, z.string().trim().max(200).optional()),
  verticalReportingCategory: optionalEnum([...VERTICAL_REPORTING_FILTER_OPTIONS]),
  associatedVertical: optionalEnum([...APPROVED_VERTICALS]),
  verticalState: optionalEnum([...VERTICAL_STATE_FILTER_OPTIONS]),
  unresolvedVerticalOnly: optionalBoolean,
  verticalSelections: stringArray.pipe(z.array(z.enum(verticalSelectionTokens)).max(25)).optional(),
  groupCustomFieldId: z.preprocess(emptyToUndefined, z.string().uuid().optional()),
  sort: z.enum(["updated", "title", "due", "actual"]).default("updated"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(200).default(50)
});

export type ReportingFilters = z.infer<typeof reportingFiltersSchema>;

type SearchValues = Record<string, string | string[] | undefined>;
export function parseReportingFilters(values: SearchValues): ReportingFilters {
  const customFields = Object.fromEntries(Object.entries(values).filter(([key, value]) => key.startsWith("cf_") && typeof value === "string" && value.trim()).map(([key, value]) => [key.slice(3), value as string]));
  const verticalSelection = typeof values.verticalSelection === "string" ? values.verticalSelection : undefined;
  const verticalSelectionFilters = verticalSelection?.startsWith("associated:")
    ? { associatedVertical: verticalSelection.slice("associated:".length), verticalReportingCategory: undefined, verticalState: undefined, unresolvedVerticalOnly: undefined }
    : verticalSelection?.startsWith("category:")
      ? { associatedVertical: undefined, verticalReportingCategory: verticalSelection.slice("category:".length), verticalState: undefined, unresolvedVerticalOnly: undefined }
      : verticalSelection?.startsWith("state:")
        ? { associatedVertical: undefined, verticalReportingCategory: undefined, verticalState: verticalSelection.slice("state:".length), unresolvedVerticalOnly: undefined }
        : verticalSelection === "legacy:unresolved"
          ? { associatedVertical: undefined, verticalReportingCategory: undefined, verticalState: undefined, unresolvedVerticalOnly: true }
        : {};
  const hoursToMinutes = (value: string | string[] | undefined) => {
    const hours = typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
    return Number.isFinite(hours) && hours >= 0 ? Math.round(hours * 60) : undefined;
  };
  const normalized = {
    ...values,
    ...verticalSelectionFilters,
    minMinutes: values.minMinutes ?? hoursToMinutes(values.minHours),
    maxMinutes: values.maxMinutes ?? hoursToMinutes(values.maxHours),
    minPlannedMinutes: values.minPlannedMinutes ?? hoursToMinutes(values.minPlannedHours),
    maxPlannedMinutes: values.maxPlannedMinutes ?? hoursToMinutes(values.maxPlannedHours),
    customFields: Object.keys(customFields).length ? customFields : undefined
  };
  const parsed = reportingFiltersSchema.safeParse(normalized);
  return parsed.success ? parsed.data : reportingFiltersSchema.parse({});
}

export function parseProjectReportingFilters(values: SearchValues): ReportingFilters {
  const hasExplicitPageSize = values.pageSize != null && values.pageSize !== "";
  const parsed = parseReportingFilters(hasExplicitPageSize ? values : { ...values, pageSize: "100" });
  return hasExplicitPageSize ? parsed : { ...parsed, pageSize: 100 };
}

export function filtersForRpc(filters: ReportingFilters) {
  const { page: _page, pageSize: _pageSize, ...rpcFilters } = filters;
  return Object.fromEntries(Object.entries(rpcFilters).filter(([, value]) => value !== undefined && value !== "" && (!Array.isArray(value) || value.length)));
}

export function filtersToQuery(filters: Partial<ReportingFilters>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value == null || value === "" || key === "customFields") continue;
    if (["minMinutes", "maxMinutes", "minPlannedMinutes", "maxPlannedMinutes"].includes(key)) {
      const hourKey = ({ minMinutes: "minHours", maxMinutes: "maxHours", minPlannedMinutes: "minPlannedHours", maxPlannedMinutes: "maxPlannedHours" } as Record<string, string>)[key];
      query.set(hourKey, String(Number(value) / 60));
      continue;
    }
    if (Array.isArray(value)) value.forEach((item) => query.append(key, String(item)));
    else query.set(key, String(value));
  }
  for (const [id, value] of Object.entries(filters.customFields ?? {})) if (value) query.set(`cf_${id}`, value);
  return query.toString();
}
