import { createHash } from "node:crypto";
import {
  AGREEMENT_SCALE,
  COLLABORATION_SCALE,
  ID_REVIEW_STATEMENTS,
  SME_DEBRIEF_STATEMENTS,
  type SurveyType,
} from "@/lib/surveys/domain";
import type { SurveyDefinition } from "@/lib/surveys/definition";
import { normalizeVerticalValue } from "@/lib/wrike/vertical-normalization";

export type HistoricalImportIssue = {
  code: "invalid_answer" | "missing_timestamp" | "question_mapping_problem";
  field: string | null;
  message: string;
  rawValue: unknown;
  severity: "blocking" | "warning";
};

export type HistoricalColumnMapping = {
  heading: string;
  canonicalId: string;
  conversion: string;
  target: "answer" | "context" | "identity" | "timestamp";
};

export type ParsedHistoricalRow = {
  answers: Record<string, unknown>;
  sourceContext: Record<string, unknown>;
  submittedAt: string | null;
  projectTitle: string;
  projectKey: string;
  wrikeTaskId: string | null;
  sourceResponseId: string | null;
  respondentName: string;
  respondentEmail: string | null;
  reviewedSmeName: string;
  vertical: string | null;
  issues: HistoricalImportIssue[];
};

export type ParsedCsv = {
  headers: string[];
  rows: Record<string, string>[];
};

const ID_HEADERS = [
  "Created", "CourseKey", "Course Name", "Name", "SME", "Vertical", "Year",
  "Overall experience", "SME's knowledge and expertise", "Responsiveness",
  "Instructional design knowledge", "Contribution to  development",
  "Openness suggestions and feedback", "Deadlines and schedule",
  "Overall quality end product", "SME assistance in interactions",
  "Realworld examples", "SME Promoter Score", "additional comments",
] as const;

const DEBRIEF_HEADERS = [
  "CourseKey", "Course Name", "Completion time", "SME Name", "Email", "Internal",
  "Billable Hours", "Total Amount Billed", "Course's Original Due Date",
  "Project Start", "Project End", "Overall Experience with Lexipol",
  "Clarity of Goals and Objectives", "Staff Responsiveness",
  "Adequacy of Tools and Resources", "Training and Support Provided",
  "Use of My Expertise", "Incorporation of My Feedback", "Autonomy in Course Design",
  "Feeling Valued as an SME", "Likelihood to Recommend Lexipol",
  "Additional Feedback or Suggestions",
] as const;
const OPTIONAL_SOURCE_HEADERS = ["Wrike Task ID", "Response ID"] as const;

const ID_RATING_HEADERS = ID_HEADERS.slice(7, 16);
const DEBRIEF_RATING_HEADERS = DEBRIEF_HEADERS.slice(11, 21);
const AGREEMENT_VALUE = new Map(AGREEMENT_SCALE.map((label, index) => [normalizeText(label), index + 1]));

const normalizedHeader = (value: string) => normalizeText(value).replace(/[^\p{L}\p{N}]+/gu, "");

export function normalizeHistoricalTitle(value: string) {
  return value.normalize("NFKC")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, "\"")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

function normalizeText(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export function parseHistoricalCsv(source: string): ParsedCsv {
  const text = source.replace(/^\uFEFF/, "");
  const records: string[][] = [];
  let record: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === "\"" && text[index + 1] === "\"") {
        value += "\"";
        index += 1;
      } else if (character === "\"") {
        quoted = false;
      } else {
        value += character;
      }
      continue;
    }
    if (character === "\"") quoted = true;
    else if (character === ",") {
      record.push(value);
      value = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      record.push(value);
      value = "";
      if (record.some((cell) => cell !== "")) records.push(record);
      record = [];
    } else value += character;
  }
  if (quoted) throw new Error("The CSV contains an unterminated quoted value.");
  if (value !== "" || record.length) {
    record.push(value);
    if (record.some((cell) => cell !== "")) records.push(record);
  }
  if (!records.length) throw new Error("The CSV is empty.");
  const headers = records[0].map((header) => header.trim());
  if (!headers.length || headers.some((header) => !header)) throw new Error("Every CSV column must have a heading.");
  if (new Set(headers.map(normalizedHeader)).size !== headers.length) throw new Error("The CSV contains duplicate column headings.");
  const rows = records.slice(1).map((cells) => Object.fromEntries(
    headers.map((header, index) => [header, cells[index] ?? ""]),
  ));
  return { headers, rows };
}

function filenameSurveyType(filename: string): SurveyType | null {
  const normalized = normalizeHistoricalTitle(filename.replace(/\.csv$/i, "").replace(/\s*\(\d+\)\s*$/, ""));
  if (normalized === "id review of sme") return "id_sme_review";
  if (normalized === "lexipol course development debrief") return "course_development_debrief";
  return null;
}

export function detectHistoricalSurveyType(filename: string, headers: string[]) {
  const keys = new Set(headers.map(normalizedHeader));
  const contains = (expected: readonly string[]) => expected.every((header) => keys.has(normalizedHeader(header)));
  const contentType: SurveyType | null = contains(ID_HEADERS)
    ? "id_sme_review"
    : contains(DEBRIEF_HEADERS)
      ? "course_development_debrief"
      : null;
  const filenameType = filenameSurveyType(filename);
  const unknownHeaders = contentType
    ? headers.filter((header) => !(contentType === "id_sme_review" ? ID_HEADERS : DEBRIEF_HEADERS)
      .some((expected) => normalizedHeader(expected) === normalizedHeader(header))
      && !OPTIONAL_SOURCE_HEADERS.some((expected) => normalizedHeader(expected) === normalizedHeader(header)))
    : headers;
  return {
    surveyType: contentType,
    filenameType,
    conflict: Boolean(contentType && filenameType && contentType !== filenameType),
    unknownHeaders,
  };
}

function mapping(heading: string, canonicalId: string, conversion: string, target: HistoricalColumnMapping["target"]): HistoricalColumnMapping {
  return { heading, canonicalId, conversion, target };
}

export function historicalColumnMappings(type: SurveyType): HistoricalColumnMapping[] {
  const sourceIdentityMappings = [
    mapping("Wrike Task ID", "wrikeTaskId", "validated exact Wrike task ID", "context"),
    mapping("Response ID", "sourceResponseId", "trimmed stable source response ID", "context"),
  ];
  if (type === "id_sme_review") {
    return [
      mapping("Created", "submittedAt", "America/Chicago timestamp to ISO instant", "timestamp"),
      mapping("CourseKey", "sourceProjectKey", "trimmed text", "context"),
      mapping("Course Name", "projectTitle", "exact normalized title candidate", "context"),
      mapping("Name", "respondent", "exact application/Wrike identity candidate", "identity"),
      mapping("SME", "reviewedSme", "exact Wrike SME identity candidate", "identity"),
      mapping("Vertical", "vertical", "shared exact Vertical normalization", "answer"),
      mapping("Year", "publicationYear", "integer year", "answer"),
      ...ID_RATING_HEADERS.map((heading, index) => mapping(heading, `collaborationRatings.rating${String(index + 1).padStart(2, "0")}`, "integer 1-5", "answer")),
      mapping("Realworld examples", "providedRealWorldExamples", "Yes/No to boolean", "answer"),
      mapping("SME Promoter Score", "recommendationScore", "integer 0-10", "answer"),
      mapping("additional comments", "comments", "multiline text", "answer"),
      ...sourceIdentityMappings,
    ];
  }
  return [
    mapping("CourseKey", "sourceProjectKey", "trimmed text", "context"),
    mapping("Course Name", "projectTitle", "exact normalized title candidate", "context"),
    mapping("Completion time", "submittedAt", "America/Chicago timestamp to ISO instant", "timestamp"),
    mapping("SME Name", "respondent", "exact application/Wrike identity candidate", "identity"),
    mapping("Email", "respondentEmail", "case-insensitive exact email candidate", "identity"),
    mapping("Internal", "legacyInternalEmployee", "Yes/No to historical classification snapshot", "answer"),
    mapping("Billable Hours", "billableHours", "nonnegative decimal", "answer"),
    mapping("Total Amount Billed", "amountBilled", "USD currency to decimal", "answer"),
    mapping("Course's Original Due Date", "legacyOriginalDueYear", "integer year; never Reporting Year", "answer"),
    mapping("Project Start", "workStartedOn", "date to ISO date", "answer"),
    mapping("Project End", "workFinishedOn", "date to ISO date", "answer"),
    ...DEBRIEF_RATING_HEADERS.map((heading, index) => mapping(heading, `collaborationRatings.rating${String(index + 1).padStart(2, "0")}`, "agreement label to 1-5", "answer")),
    mapping("Additional Feedback or Suggestions", "comments", "multiline text", "answer"),
    ...sourceIdentityMappings,
  ];
}

function parseBoundedNumber(raw: string, field: string, minimum: number, maximum: number, issues: HistoricalImportIssue[], required = true) {
  if (!raw.trim()) {
    if (required) issues.push({ code: "invalid_answer", field, message: `${field} is blank.`, rawValue: raw, severity: "blocking" });
    return null;
  }
  const numeric = Number(raw.trim().replace(/[$,\s]/g, ""));
  if (!Number.isFinite(numeric) || numeric < minimum || numeric > maximum) {
    issues.push({ code: "invalid_answer", field, message: `${field} is not a valid value from ${minimum} to ${maximum}.`, rawValue: raw, severity: "blocking" });
    return null;
  }
  return numeric;
}

function parseYesNo(raw: string, field: string, issues: HistoricalImportIssue[]) {
  const normalized = normalizeText(raw);
  if (normalized === "yes") return true;
  if (normalized === "no") return false;
  issues.push({ code: "invalid_answer", field, message: `${field} must be Yes or No.`, rawValue: raw, severity: "blocking" });
  return null;
}

function parseDate(raw: string, field: string, issues: HistoricalImportIssue[]) {
  if (!raw.trim()) return null;
  const match = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) {
    issues.push({ code: "invalid_answer", field, message: `${field} is not a recognized date.`, rawValue: raw, severity: "blocking" });
    return null;
  }
  const [, month, day, year] = match;
  const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== iso) {
    issues.push({ code: "invalid_answer", field, message: `${field} is not a valid calendar date.`, rawValue: raw, severity: "blocking" });
    return null;
  }
  return iso;
}

function timezoneOffset(date: Date, timezone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - date.valueOf();
}

export function parseHistoricalTimestamp(raw: string, timezone: string) {
  const match = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)$/i);
  if (!match) return null;
  const [, month, day, year, rawHour, minute, second = "0", meridiem] = match;
  let hour = Number(rawHour) % 12;
  if (meridiem.toUpperCase() === "PM") hour += 12;
  const wallClock = Date.UTC(Number(year), Number(month) - 1, Number(day), hour, Number(minute), Number(second));
  let instant = new Date(wallClock);
  for (let attempt = 0; attempt < 2; attempt += 1) instant = new Date(wallClock - timezoneOffset(instant, timezone));
  if (Number.isNaN(instant.valueOf())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(instant).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  if (parts.year !== Number(year) || parts.month !== Number(month) || parts.day !== Number(day)
    || parts.hour !== hour || parts.minute !== Number(minute) || parts.second !== Number(second)) return null;
  return instant.toISOString();
}

function setPresent(target: Record<string, unknown>, key: string, value: unknown) {
  if (value !== null && value !== "") target[key] = value;
}

export function parseHistoricalRow(type: SurveyType, row: Record<string, string>, timezone: string): ParsedHistoricalRow {
  const issues: HistoricalImportIssue[] = [];
  const answers: Record<string, unknown> = {};
  const ratings: Record<string, number> = {};
  const timestampField = type === "id_sme_review" ? "Created" : "Completion time";
  const submittedAt = parseHistoricalTimestamp(row[timestampField] ?? "", timezone);
  if (!submittedAt) issues.push({ code: "missing_timestamp", field: timestampField, message: "The submission timestamp is missing or malformed.", rawValue: row[timestampField], severity: "blocking" });

  if (type === "id_sme_review") {
    const year = parseBoundedNumber(row.Year ?? "", "Year", 1000, 9999, issues);
    setPresent(answers, "publicationYear", year);
    const vertical = normalizeVerticalValue(row.Vertical);
    if (vertical.hasUnresolvedVertical) {
      issues.push({ code: "invalid_answer", field: "Vertical", message: `Vertical could not be normalized${vertical.rejectedTokens.length ? `: ${vertical.rejectedTokens.join(", ")}` : "."}`, rawValue: row.Vertical, severity: "blocking" });
    } else answers.vertical = vertical.reportingCategory;
    ID_RATING_HEADERS.forEach((header, index) => {
      const rating = parseBoundedNumber(row[header] ?? "", header, 1, 5, issues);
      if (rating != null && Number.isInteger(rating)) ratings[`rating${String(index + 1).padStart(2, "0")}`] = rating;
      else if (rating != null) issues.push({ code: "invalid_answer", field: header, message: `${header} must be a whole number.`, rawValue: row[header], severity: "blocking" });
    });
    answers.collaborationRatings = ratings;
    const examples = parseYesNo(row["Realworld examples"] ?? "", "Realworld examples", issues);
    setPresent(answers, "providedRealWorldExamples", examples);
    const score = parseBoundedNumber(row["SME Promoter Score"] ?? "", "SME Promoter Score", 0, 10, issues);
    if (score != null && Number.isInteger(score)) answers.recommendationScore = score;
    else if (score != null) issues.push({ code: "invalid_answer", field: "SME Promoter Score", message: "SME Promoter Score must be a whole number.", rawValue: row["SME Promoter Score"], severity: "blocking" });
    setPresent(answers, "comments", row["additional comments"]?.trim() ?? "");
    return {
      answers, submittedAt, issues,
      projectTitle: row["Course Name"]?.trim() ?? "",
      projectKey: row.CourseKey?.trim() ?? "",
      wrikeTaskId: row["Wrike Task ID"]?.trim() || null,
      sourceResponseId: row["Response ID"]?.trim() || null,
      respondentName: row.Name?.trim() ?? "",
      respondentEmail: null,
      reviewedSmeName: row.SME?.trim() ?? "",
      vertical: typeof answers.vertical === "string" ? answers.vertical : null,
      sourceContext: { sourceProjectKey: row.CourseKey?.trim() ?? "", sourceVertical: row.Vertical, sourceYear: row.Year },
    };
  }

  const internal = parseYesNo(row.Internal ?? "", "Internal", issues);
  setPresent(answers, "legacyInternalEmployee", internal);
  const originalYear = parseBoundedNumber(row["Course's Original Due Date"] ?? "", "Course's Original Due Date", 1000, 9999, issues);
  setPresent(answers, "legacyOriginalDueYear", originalYear);
  const hours = parseBoundedNumber(row["Billable Hours"] ?? "", "Billable Hours", 0, 99_999_999, issues, false);
  const amount = parseBoundedNumber(row["Total Amount Billed"] ?? "", "Total Amount Billed", 0, 99_999_999, issues, false);
  if (internal === false) {
    setPresent(answers, "billableHours", hours);
    setPresent(answers, "amountBilled", amount);
    if (hours == null || amount == null) issues.push({ code: "invalid_answer", field: "Billing", message: "Historical external billing is incomplete; available values will remain null.", rawValue: { hours: row["Billable Hours"], amount: row["Total Amount Billed"] }, severity: "warning" });
  }
  setPresent(answers, "workStartedOn", parseDate(row["Project Start"] ?? "", "Project Start", issues));
  setPresent(answers, "workFinishedOn", parseDate(row["Project End"] ?? "", "Project End", issues));
  if (typeof answers.workStartedOn === "string" && typeof answers.workFinishedOn === "string" && answers.workFinishedOn < answers.workStartedOn) {
    issues.push({ code: "invalid_answer", field: "Project End", message: "Project End is earlier than Project Start.", rawValue: row["Project End"], severity: "blocking" });
  }
  DEBRIEF_RATING_HEADERS.forEach((header, index) => {
    const raw = row[header] ?? "";
    if (!raw.trim()) return;
    const rating = AGREEMENT_VALUE.get(normalizeText(raw));
    if (rating) ratings[`rating${String(index + 1).padStart(2, "0")}`] = rating;
    else issues.push({ code: "invalid_answer", field: header, message: `${header} is not a recognized agreement rating.`, rawValue: raw, severity: "blocking" });
  });
  answers.collaborationRatings = ratings;
  setPresent(answers, "comments", row["Additional Feedback or Suggestions"]?.trim() ?? "");
  return {
    answers, submittedAt, issues,
    projectTitle: row["Course Name"]?.trim() ?? "",
    projectKey: row.CourseKey?.trim() ?? "",
    wrikeTaskId: row["Wrike Task ID"]?.trim() || null,
    sourceResponseId: row["Response ID"]?.trim() || null,
    respondentName: row["SME Name"]?.trim() ?? "",
    respondentEmail: row.Email?.trim() || null,
    reviewedSmeName: row["SME Name"]?.trim() ?? "",
    vertical: null,
    sourceContext: {
      sourceProjectKey: row.CourseKey?.trim() ?? "",
      historicalClassification: internal === true ? "internal" : internal === false ? "external" : null,
      legacyOriginalDueYear: originalYear,
    },
  };
}

const buttons = { saveDraft: "Save draft", previous: "Previous", next: "Next", submit: "Submit survey", return: "Return to dashboard" };
const matrixRows = (statements: readonly string[]) => statements.map((label, index) => ({ id: `rating${String(index + 1).padStart(2, "0")}`, label }));

export function historicalSurveyDefinition(type: SurveyType): SurveyDefinition {
  if (type === "id_sme_review") {
    return {
      schemaVersion: 1, surveyType: type, title: "Historical Review of Subject Matter Expert",
      introduction: "Imported historical response.", instructions: "This submitted response is read-only.",
      completionMessage: "Historical response imported.", presentation: "one_page", buttons,
      sections: [
        { id: "context", title: "Historical context", description: "", pageBreakBefore: false, questions: [
          { id: "publicationYear", type: "number", label: "Year", helpText: "", required: true, width: "half", validation: { min: 1000, max: 9999, step: 1 } },
          { id: "vertical", type: "single_choice", label: "Vertical", helpText: "", required: true, width: "half", validation: {}, options: ["P1A", "FR1A", "EMS1", "C1A", "LGU", "D1A", "Lexipol", "Wellness", "Cross Vertical", "Other"].map((label) => ({ id: label.replaceAll(" ", "_"), label })) },
        ] },
        { id: "ratings", title: "Collaboration ratings", description: "", pageBreakBefore: false, questions: [
          { id: "collaborationRatings", type: "rating_matrix", label: "Historical collaboration ratings", helpText: "", required: true, width: "full", validation: {}, rows: matrixRows(ID_REVIEW_STATEMENTS), scale: { min: 1, max: 5, minLabel: COLLABORATION_SCALE[0], maxLabel: COLLABORATION_SCALE[4], labels: [...COLLABORATION_SCALE] } },
        ] },
        { id: "examples", title: "Real-world examples", description: "", pageBreakBefore: false, questions: [
          { id: "providedRealWorldExamples", type: "yes_no", label: "Real-world examples provided", helpText: "", required: true, width: "full", validation: {} },
          { id: "recommendationScore", type: "rating_scale", label: "SME Promoter Score", helpText: "", required: true, width: "full", validation: {}, scale: { min: 0, max: 10, minLabel: "Not at all likely", maxLabel: "Extremely likely" } },
        ] },
        { id: "comments-section", title: "Additional comments", description: "", pageBreakBefore: false, questions: [
          { id: "comments", type: "long_text", label: "Additional comments", helpText: "", required: false, width: "full", validation: { maxLength: 5_000 } },
        ] },
      ],
    };
  }
  return {
    schemaVersion: 1, surveyType: type, title: "Historical Course Development Debrief",
    introduction: "Imported historical response.", instructions: "This submitted response is read-only.",
    completionMessage: "Historical response imported.", presentation: "one_page", buttons,
    sections: [
      { id: "historical-context", title: "Historical context", description: "", pageBreakBefore: false, questions: [
        { id: "legacyOriginalDueYear", type: "number", label: "Course's Original Due Date", helpText: "Historical source value; not Reporting Year.", required: true, width: "half", validation: { min: 1000, max: 9999, step: 1 } },
        { id: "legacyInternalEmployee", type: "yes_no", label: "Internal", helpText: "Historical source snapshot.", required: true, width: "half", validation: {} },
      ] },
      { id: "billing", title: "Historical billing", description: "The source export did not include invoice files.", pageBreakBefore: false, questions: [
        { id: "billableHours", type: "number", label: "Billable Hours", helpText: "", required: false, width: "half", validation: { min: 0, max: 99_999_999, step: 0.01 } },
        { id: "amountBilled", type: "currency", label: "Total Amount Billed", helpText: "", required: false, width: "half", validation: { min: 0, max: 99_999_999, step: 0.01 } },
      ] },
      { id: "dates", title: "Dates", description: "", pageBreakBefore: false, questions: [
        { id: "workStartedOn", type: "date", label: "Project Start", helpText: "", required: false, width: "half", validation: {} },
        { id: "workFinishedOn", type: "date", label: "Project End", helpText: "", required: false, width: "half", validation: {} },
      ] },
      { id: "ratings", title: "Collaboration ratings", description: "", pageBreakBefore: false, questions: [
        { id: "collaborationRatings", type: "rating_matrix", label: "Historical collaboration ratings", helpText: "", required: false, width: "full", validation: {}, rows: matrixRows(SME_DEBRIEF_STATEMENTS), scale: { min: 1, max: 5, minLabel: AGREEMENT_SCALE[0], maxLabel: AGREEMENT_SCALE[4], labels: [...AGREEMENT_SCALE] } },
      ] },
      { id: "comments-section", title: "Additional comments", description: "", pageBreakBefore: false, questions: [
        { id: "comments", type: "long_text", label: "Additional Feedback or Suggestions", helpText: "", required: false, width: "full", validation: { maxLength: 5_000 } },
      ] },
    ],
  };
}

export function historicalSchemaChecksum(type: SurveyType, headers: string[]) {
  return createHash("sha256").update(JSON.stringify({ type, headers: headers.map((header) => header.trim()) })).digest("hex");
}

export function historicalRowChecksum(row: Record<string, string>, headers: string[]) {
  return createHash("sha256").update(JSON.stringify(headers.map((header) => [header, row[header] ?? ""]))).digest("hex");
}

export function historicalFingerprint(value: Record<string, unknown>) {
  const stable = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(stable);
    if (input && typeof input === "object") {
      return Object.fromEntries(Object.entries(input as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)]));
    }
    return input;
  };
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}
