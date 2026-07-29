import { z } from "zod";
import type { SurveyType } from "@/lib/surveys/domain";
import { normalizeVerticalValue, type VerticalReportingCategory } from "@/lib/wrike/vertical-normalization";

export const HISTORICAL_SURVEY_TYPES = ["SME_DEBRIEF", "ID_SME_REVIEW"] as const;
export type HistoricalSurveyType = typeof HISTORICAL_SURVEY_TYPES[number];
export type HistoricalImportStatus =
  | "Ready"
  | "Ready with warnings"
  | "Blocked"
  | "Duplicate"
  | "Possible match";
export type HistoricalDuplicateAction = "skip" | "separate" | "replace";

const COMMON_HEADERS = [
  "surveyType",
  "surveyVersion",
  "submittedAt",
  "sourceResponseId",
  "wrikeTaskId",
  "courseName",
] as const;
const collaborationHeaders = (count: number) =>
  Array.from({ length: count }, (_, index) => `collaborationRatings.rating${String(index + 1).padStart(2, "0")}`);

export const SME_DEBRIEF_HEADERS = [
  ...COMMON_HEADERS,
  "smeName",
  "smeEmail",
  "billableHours",
  "amountBilled",
  "workStartedOn",
  "workFinishedOn",
  ...collaborationHeaders(10),
  "comments",
] as const;

export const ID_SME_REVIEW_HEADERS = [
  ...COMMON_HEADERS,
  "reviewerName",
  "reviewerEmail",
  "reviewedSmeName",
  "reviewedSmeEmail",
  "publicationYear",
  "vertical",
  ...collaborationHeaders(9),
  "providedRealWorldExamples",
  "realWorldExamplesEffectiveness",
  "recommendationScore",
  "comments",
] as const;

export const SME_DEBRIEF_REQUIRED_FIELDS = [
  "surveyType", "surveyVersion", "submittedAt", "sourceResponseId", "courseName", "smeName",
] as const;
export const ID_SME_REVIEW_REQUIRED_FIELDS = [
  "surveyType", "surveyVersion", "submittedAt", "sourceResponseId", "courseName", "reviewerName", "reviewedSmeName",
] as const;

const LIKERT_VALUES = [
  "Strongly Disagree",
  "Disagree",
  "Neither Agree nor Disagree",
  "Agree",
  "Strongly Agree",
] as const;
const normalizedLikert = new Map(LIKERT_VALUES.map((value, index) => [value.toLocaleLowerCase("en-US"), index + 1]));

export type HistoricalImportIssue = {
  code: string;
  field: string | null;
  message: string;
  severity: "error" | "warning";
  originalValue?: unknown;
  normalizedValue?: unknown;
};

export type HistoricalNormalization = {
  field: string;
  originalValue: unknown;
  normalizedValue: unknown;
  reason: string;
};

export type HistoricalPersonValue = {
  name: string;
  email: string | null;
  matchedPrincipalId?: string | null;
  matchedWrikeUserId?: string | null;
  matchMethod?: "email" | "name" | "administrator" | null;
};

export type SmeDebriefImportRow = {
  surveyType: "SME_DEBRIEF";
  surveyVersion: string;
  submittedAt: string;
  sourceResponseId: string;
  wrikeTaskId: string | null;
  courseName: string;
  sme: HistoricalPersonValue;
  billableHours: number | null;
  amountBilled: number | null;
  workStartedOn: string | null;
  workFinishedOn: string | null;
  collaborationRatings: Record<string, number>;
  comments: string | null;
};

export type IdSmeReviewImportRow = {
  surveyType: "ID_SME_REVIEW";
  surveyVersion: string;
  submittedAt: string;
  sourceResponseId: string;
  wrikeTaskId: string | null;
  courseName: string;
  reviewer: HistoricalPersonValue;
  reviewedSme: HistoricalPersonValue;
  publicationYear: number | null;
  vertical: VerticalReportingCategory | null;
  originalVertical: string | null;
  collaborationRatings: Record<string, number>;
  providedRealWorldExamples: boolean | null;
  realWorldExamplesEffectiveness: number | null;
  recommendationScore: number | null;
  comments: string | null;
};

export type HistoricalSurveyImportRow = SmeDebriefImportRow | IdSmeReviewImportRow;

const personSchema = z.object({
  name: z.string(),
  email: z.string().email().nullable(),
  matchedPrincipalId: z.string().uuid().nullable().optional(),
  matchedWrikeUserId: z.string().uuid().nullable().optional(),
  matchMethod: z.enum(["email", "name", "administrator"]).nullable().optional(),
});
const commonNormalizedSchema = {
  surveyVersion: z.string().trim().min(1),
  submittedAt: z.string().datetime(),
  sourceResponseId: z.string().trim().min(1),
  wrikeTaskId: z.string().trim().min(1).nullable(),
  courseName: z.string().trim().min(1),
  collaborationRatings: z.record(z.number().int().min(1).max(5)),
  comments: z.string().max(5_000).nullable(),
};

export const smeDebriefImportRowSchema = z.object({
  surveyType: z.literal("SME_DEBRIEF"),
  ...commonNormalizedSchema,
  sme: personSchema,
  billableHours: z.number().finite().nonnegative().max(99_999_999.99).nullable(),
  amountBilled: z.number().finite().nonnegative().max(9_999_999_999.99).nullable(),
  workStartedOn: z.string().date().nullable(),
  workFinishedOn: z.string().date().nullable(),
});

export const idSmeReviewImportRowSchema = z.object({
  surveyType: z.literal("ID_SME_REVIEW"),
  ...commonNormalizedSchema,
  reviewer: personSchema,
  reviewedSme: personSchema,
  publicationYear: z.number().int().min(1_000).max(9_999).nullable(),
  vertical: z.enum(["P1A", "C1A", "D1A", "FR1A", "EMS1", "LGU", "Lexipol", "Wellness", "Cross Vertical", "Unresolved Vertical"]).nullable(),
  originalVertical: z.string().nullable(),
  providedRealWorldExamples: z.boolean().nullable(),
  realWorldExamplesEffectiveness: z.number().int().min(1).max(5).nullable(),
  recommendationScore: z.number().int().min(0).max(10).nullable(),
});

export const historicalSurveyImportRowSchema = z.discriminatedUnion("surveyType", [
  smeDebriefImportRowSchema,
  idSmeReviewImportRowSchema,
]);

export type HistoricalCsvDocument = {
  headers: string[];
  rows: Record<string, string>[];
  rowNumbers: number[];
};

export type HistoricalFileInspection = {
  detectedSurveyType: HistoricalSurveyType | null;
  internalSurveyType: SurveyType | null;
  surveyVersions: string[];
  totalRows: number;
  validRows: number;
  warningCount: number;
  errorCount: number;
  headers: string[];
  issues: HistoricalImportIssue[];
  rows: HistoricalPreviewRow[];
};

export type HistoricalPreviewRow = {
  rowNumber: number;
  status: HistoricalImportStatus;
  selected: boolean;
  duplicateAction: HistoricalDuplicateAction;
  effectiveSourceResponseId: string;
  normalized: HistoricalSurveyImportRow | null;
  original: Record<string, string>;
  normalizations: HistoricalNormalization[];
  issues: HistoricalImportIssue[];
  match: {
    projectId: string | null;
    matchedWrikeTaskId: string | null;
    method: "wrike_task_id" | "exact_course_name" | "course_name_year" | "case_insensitive_course_name" | "administrator" | null;
    confidence: number | null;
    candidates: Array<{ id: string; wrikeTaskId: string; courseName: string; publicationYear?: number | null }>;
    explicitlyUnmatched: boolean;
  };
};

function normalizeHeader(value: string) {
  return value.normalize("NFKC").trim();
}

function pushRecord(records: string[][], record: string[], value: string) {
  const completed = [...record, value];
  if (completed.some((cell) => cell.length > 0)) records.push(completed);
}

export function parseFinalizedHistoricalCsv(source: string): HistoricalCsvDocument {
  const text = source.replace(/^\uFEFF/, "");
  if (!text.trim()) throw new Error("The CSV is empty.");
  const records: string[][] = [];
  let record: string[] = [];
  let value = "";
  let quoted = false;
  let rowNumber = 1;
  const recordNumbers: number[] = [];

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === "\"" && text[index + 1] === "\"") {
        value += "\"";
        index += 1;
      } else if (character === "\"") quoted = false;
      else value += character;
      continue;
    }
    if (character === "\"") quoted = true;
    else if (character === ",") {
      record.push(value);
      value = "";
    } else if (character === "\r" || character === "\n") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      const before = records.length;
      pushRecord(records, record, value);
      if (records.length > before) recordNumbers.push(rowNumber);
      record = [];
      value = "";
      rowNumber += 1;
    } else value += character;
  }
  if (quoted) throw new Error("The CSV contains an unterminated quoted value.");
  if (value.length || record.length) {
    const before = records.length;
    pushRecord(records, record, value);
    if (records.length > before) recordNumbers.push(rowNumber);
  }
  if (!records.length) throw new Error("The CSV is empty.");

  const headers = records[0].map(normalizeHeader);
  if (!headers.length || headers.some((header) => !header)) throw new Error("Every CSV column must have a heading.");
  if (new Set(headers).size !== headers.length) throw new Error("The CSV contains duplicate column headings.");
  const rows = records.slice(1).map((cells, index) => {
    if (cells.length !== headers.length) {
      throw new Error(`CSV row ${recordNumbers[index + 1] ?? index + 2} has ${cells.length} values but the header has ${headers.length}.`);
    }
    return Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] ?? ""]));
  });
  if (!rows.length) throw new Error("The CSV contains a header but no survey records.");
  return { headers, rows, rowNumbers: recordNumbers.slice(1) };
}

function externalToInternal(type: HistoricalSurveyType): SurveyType {
  return type === "SME_DEBRIEF" ? "course_development_debrief" : "id_sme_review";
}

function expectedHeaders(type: HistoricalSurveyType) {
  return type === "SME_DEBRIEF" ? [...SME_DEBRIEF_HEADERS] : [...ID_SME_REVIEW_HEADERS];
}

function requiredFields(type: HistoricalSurveyType) {
  return type === "SME_DEBRIEF" ? [...SME_DEBRIEF_REQUIRED_FIELDS] : [...ID_SME_REVIEW_REQUIRED_FIELDS];
}

function cell(row: Record<string, string>, field: string) {
  return (row[field] ?? "").normalize("NFKC").trim();
}

function nullableCell(row: Record<string, string>, field: string) {
  const value = cell(row, field);
  return value ? value : null;
}

function formulaLike(value: string) {
  return /^[\s]*[=+\-@]/.test(value);
}

function validIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function historicalDate(value: string) {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const iso = `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
  return validIsoDate(iso) ? iso : null;
}

function timezoneOffset(date: Date, timezone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - date.valueOf();
}

function historicalTimestamp(value: string, timezone: string) {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)$/i);
  if (!match) return null;
  let hour = Number(match[4]) % 12;
  if (match[7].toUpperCase() === "PM") hour += 12;
  const wallClock = Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2]), hour, Number(match[5]), Number(match[6] ?? 0));
  let instant = new Date(wallClock);
  for (let attempt = 0; attempt < 2; attempt += 1) instant = new Date(wallClock - timezoneOffset(instant, timezone));
  return Number.isNaN(instant.valueOf()) ? null : instant.toISOString();
}

function parseTimestamp(value: string, timezone: string) {
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf()) && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return parsed.toISOString();
  }
  return historicalTimestamp(value, timezone);
}

function addIssue(
  issues: HistoricalImportIssue[],
  code: string,
  field: string | null,
  message: string,
  severity: "error" | "warning" = "error",
  originalValue?: unknown,
  normalizedValue?: unknown,
) {
  issues.push({ code, field, message, severity, originalValue, normalizedValue });
}

function parseDecimal(row: Record<string, string>, field: string, issues: HistoricalImportIssue[]) {
  const raw = nullableCell(row, field);
  if (raw == null) return null;
  const numeric = Number(raw.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(numeric) || numeric < 0) {
    addIssue(issues, "invalid_number", field, `${field} must be a nonnegative decimal number.`, "error", raw);
    return null;
  }
  return numeric;
}

function parseInteger(
  row: Record<string, string>,
  field: string,
  minimum: number,
  maximum: number,
  issues: HistoricalImportIssue[],
  required: boolean,
) {
  const raw = nullableCell(row, field);
  if (raw == null) {
    if (required) addIssue(issues, "missing_required_value", field, `${field} is required.`);
    return null;
  }
  const numeric = Number(raw);
  if (!Number.isInteger(numeric) || numeric < minimum || numeric > maximum) {
    addIssue(issues, "invalid_integer", field, `${field} must be an integer from ${minimum} through ${maximum}.`, "error", raw);
    return null;
  }
  return numeric;
}

function parseRatings(
  row: Record<string, string>,
  count: number,
  type: HistoricalSurveyType,
  issues: HistoricalImportIssue[],
) {
  const ratings: Record<string, number> = {};
  for (let index = 1; index <= count; index += 1) {
    const key = `rating${String(index).padStart(2, "0")}`;
    const field = `collaborationRatings.${key}`;
    const raw = cell(row, field);
    if (type === "SME_DEBRIEF") {
      const value = normalizedLikert.get(raw.toLocaleLowerCase("en-US"));
      if (!value) addIssue(issues, "invalid_rating", field, `${field} must use an approved agreement rating.`, "error", raw);
      else ratings[key] = value;
    } else {
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 1 || value > 5) {
        addIssue(issues, "invalid_rating", field, `${field} must be an integer from 1 through 5.`, "error", raw);
      } else ratings[key] = value;
    }
  }
  return ratings;
}

function parseYesNo(row: Record<string, string>, field: string, issues: HistoricalImportIssue[]) {
  const raw = nullableCell(row, field);
  if (raw == null) return null;
  const normalized = raw.toLocaleLowerCase("en-US");
  if (normalized === "yes") return true;
  if (normalized === "no") return false;
  addIssue(issues, "invalid_yes_no", field, `${field} must be Yes or No.`, "error", raw);
  return null;
}

function rowStatus(issues: HistoricalImportIssue[]): HistoricalImportStatus {
  return issues.some((issue) => issue.severity === "error") ? "Blocked"
    : issues.some((issue) => issue.severity === "warning") ? "Ready with warnings"
      : "Ready";
}

function parseRow(
  type: HistoricalSurveyType,
  row: Record<string, string>,
  rowNumber: number,
  timezone: string,
): HistoricalPreviewRow {
  const issues: HistoricalImportIssue[] = [];
  const normalizations: HistoricalNormalization[] = [];
  for (const field of requiredFields(type)) {
    if (!cell(row, field)) addIssue(issues, "missing_required_value", field, `${field} is required.`);
  }
  for (const [field, value] of Object.entries(row)) {
    if (formulaLike(value)) addIssue(issues, "unsafe_spreadsheet_value", field, `${field} begins with a spreadsheet formula marker.`, "error", value);
  }
  if (cell(row, "surveyType") !== type) {
    addIssue(issues, "survey_type_mismatch", "surveyType", `surveyType must be ${type}.`, "error", row.surveyType);
  }
  const submittedAt = parseTimestamp(cell(row, "submittedAt"), timezone);
  if (!submittedAt) addIssue(issues, "invalid_timestamp", "submittedAt", "submittedAt must be an ISO timestamp with an offset or a recognized historical timestamp.", "error", row.submittedAt);

  const wrikeTaskId = nullableCell(row, "wrikeTaskId");
  if (!wrikeTaskId) addIssue(issues, "missing_wrike_task_id", "wrikeTaskId", "No Wrike task ID was supplied; course matching will be attempted.", "warning");

  let normalized: HistoricalSurveyImportRow;
  if (type === "SME_DEBRIEF") {
    const smeEmail = nullableCell(row, "smeEmail");
    if (!smeEmail) addIssue(issues, "missing_email", "smeEmail", "SME email is blank; name matching will be attempted.", "warning");
    for (const field of ["billableHours", "amountBilled", "workStartedOn", "workFinishedOn"] as const) {
      if (!nullableCell(row, field)) addIssue(issues, "missing_optional_value", field, `${field} is blank.`, "warning");
    }
    const dateValue = (field: "workStartedOn" | "workFinishedOn") => {
      const raw = nullableCell(row, field);
      if (!raw) return null;
      const parsed = validIsoDate(raw) ? raw : historicalDate(raw);
      if (!parsed) addIssue(issues, "invalid_date", field, `${field} must be a valid date.`, "error", raw);
      return parsed;
    };
    const workStartedOn = dateValue("workStartedOn");
    const workFinishedOn = dateValue("workFinishedOn");
    if (workStartedOn && workFinishedOn && workFinishedOn < workStartedOn) {
      addIssue(issues, "invalid_date_range", "workFinishedOn", "workFinishedOn must be the same as or later than workStartedOn.", "error", workFinishedOn);
    }
    normalized = {
      surveyType: type,
      surveyVersion: cell(row, "surveyVersion"),
      submittedAt: submittedAt ?? new Date(0).toISOString(),
      sourceResponseId: cell(row, "sourceResponseId"),
      wrikeTaskId,
      courseName: cell(row, "courseName"),
      sme: { name: cell(row, "smeName"), email: smeEmail },
      billableHours: parseDecimal(row, "billableHours", issues),
      amountBilled: parseDecimal(row, "amountBilled", issues),
      workStartedOn,
      workFinishedOn,
      collaborationRatings: parseRatings(row, 10, type, issues),
      comments: nullableCell(row, "comments"),
    };
  } else {
    const reviewerEmail = nullableCell(row, "reviewerEmail");
    const reviewedSmeEmail = nullableCell(row, "reviewedSmeEmail");
    if (!reviewerEmail) addIssue(issues, "missing_email", "reviewerEmail", "Reviewer email is blank; name matching will be attempted.", "warning");
    if (!reviewedSmeEmail) addIssue(issues, "missing_email", "reviewedSmeEmail", "Reviewed SME email is blank; name matching will be attempted.", "warning");
    const originalVertical = nullableCell(row, "vertical");
    const verticalResult = normalizeVerticalValue(originalVertical);
    const vertical = originalVertical ? verticalResult.reportingCategory : null;
    if (originalVertical && verticalResult.hasUnresolvedVertical) {
      addIssue(issues, "unknown_vertical", "vertical", "The vertical is not recognized and will remain unresolved.", "warning", originalVertical, "Unresolved Vertical");
    } else if (originalVertical && vertical !== originalVertical) {
      addIssue(issues, "vertical_normalized", "vertical", `Vertical was normalized to ${vertical}.`, "warning", originalVertical, vertical);
      normalizations.push({ field: "vertical", originalValue: originalVertical, normalizedValue: vertical, reason: "Shared DevTrack vertical normalization" });
    }
    normalized = {
      surveyType: type,
      surveyVersion: cell(row, "surveyVersion"),
      submittedAt: submittedAt ?? new Date(0).toISOString(),
      sourceResponseId: cell(row, "sourceResponseId"),
      wrikeTaskId,
      courseName: cell(row, "courseName"),
      reviewer: { name: cell(row, "reviewerName"), email: reviewerEmail },
      reviewedSme: { name: cell(row, "reviewedSmeName"), email: reviewedSmeEmail },
      publicationYear: parseInteger(row, "publicationYear", 1_000, 9_999, issues, false),
      vertical,
      originalVertical,
      collaborationRatings: parseRatings(row, 9, type, issues),
      providedRealWorldExamples: parseYesNo(row, "providedRealWorldExamples", issues),
      realWorldExamplesEffectiveness: parseInteger(row, "realWorldExamplesEffectiveness", 1, 5, issues, false),
      recommendationScore: parseInteger(row, "recommendationScore", 0, 10, issues, false),
      comments: nullableCell(row, "comments"),
    };
  }

  const parsed = historicalSurveyImportRowSchema.safeParse(normalized);
  if (!parsed.success) {
    for (const schemaIssue of parsed.error.issues) {
      addIssue(issues, "model_conversion_failed", schemaIssue.path.join("."), schemaIssue.message);
    }
  }
  const status = rowStatus(issues);
  return {
    rowNumber,
    status,
    selected: status !== "Blocked",
    duplicateAction: "skip",
    effectiveSourceResponseId: normalized.sourceResponseId,
    normalized: parsed.success ? parsed.data : normalized,
    original: row,
    normalizations,
    issues,
    match: {
      projectId: null,
      matchedWrikeTaskId: null,
      method: null,
      confidence: null,
      candidates: [],
      explicitlyUnmatched: false,
    },
  };
}

export function inspectFinalizedHistoricalCsv(source: string, timezone = "America/Chicago"): HistoricalFileInspection {
  const document = parseFinalizedHistoricalCsv(source);
  const fileIssues: HistoricalImportIssue[] = [];
  const rowTypes = [...new Set(document.rows.map((row) => cell(row, "surveyType")).filter(Boolean))];
  const detectedSurveyType = rowTypes.length === 1 && HISTORICAL_SURVEY_TYPES.includes(rowTypes[0] as HistoricalSurveyType)
    ? rowTypes[0] as HistoricalSurveyType
    : null;
  if (rowTypes.length > 1) addIssue(fileIssues, "mixed_survey_types", "surveyType", "A CSV file may contain only one surveyType.", "error", rowTypes);
  else if (!detectedSurveyType) addIssue(fileIssues, "unknown_survey_type", "surveyType", "surveyType must be SME_DEBRIEF or ID_SME_REVIEW.", "error", rowTypes[0] ?? null);

  if (detectedSurveyType) {
    const expected = expectedHeaders(detectedSurveyType);
    const missing = expected.filter((header) => !document.headers.includes(header));
    const unsupported = document.headers.filter((header) => !expected.includes(header as never));
    if (missing.length) addIssue(fileIssues, "missing_headers", null, `Missing required columns: ${missing.join(", ")}.`, "error", missing);
    if (unsupported.length) addIssue(fileIssues, "unsupported_headers", null, `Unsupported columns: ${unsupported.join(", ")}.`, "error", unsupported);
  }

  const rows = detectedSurveyType && !fileIssues.length
    ? document.rows.map((row, index) => parseRow(detectedSurveyType, row, document.rowNumbers[index] ?? index + 2, timezone))
    : [];
  const surveyVersions = [...new Set(document.rows.map((row) => cell(row, "surveyVersion")).filter(Boolean))];
  const rowIssues = rows.flatMap((row) => row.issues);
  return {
    detectedSurveyType,
    internalSurveyType: detectedSurveyType ? externalToInternal(detectedSurveyType) : null,
    surveyVersions,
    totalRows: document.rows.length,
    validRows: rows.filter((row) => row.status !== "Blocked").length,
    warningCount: rowIssues.filter((issue) => issue.severity === "warning").length,
    errorCount: fileIssues.length + rowIssues.filter((issue) => issue.severity === "error").length,
    headers: document.headers,
    issues: fileIssues,
    rows,
  };
}

export function historicalDuplicateKey(organizationId: string, surveyType: HistoricalSurveyType, sourceResponseId: string) {
  return `${organizationId}:${surveyType}:${sourceResponseId.trim()}`;
}

export function escapeCsvFormula(value: unknown) {
  const text = String(value ?? "");
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function csvCell(value: unknown) {
  const text = escapeCsvFormula(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

export function finalizedHistoricalTemplate(type: HistoricalSurveyType) {
  return `${expectedHeaders(type).map(csvCell).join(",")}\r\n`;
}

export const HISTORICAL_SCHEMA_GUIDES = {
  SME_DEBRIEF: {
    label: "SME Debrief",
    required: SME_DEBRIEF_REQUIRED_FIELDS,
    optional: SME_DEBRIEF_HEADERS.filter((header) => !SME_DEBRIEF_REQUIRED_FIELDS.includes(header as never)),
    ratings: LIKERT_VALUES,
  },
  ID_SME_REVIEW: {
    label: "ID Review of SME",
    required: ID_SME_REVIEW_REQUIRED_FIELDS,
    optional: ID_SME_REVIEW_HEADERS.filter((header) => !ID_SME_REVIEW_REQUIRED_FIELDS.includes(header as never)),
    ratings: ["Integers 1 through 5"],
  },
} as const;
