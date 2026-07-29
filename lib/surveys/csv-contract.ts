import {
  orderedQuestions,
  type SurveyDefinition,
  type SurveyQuestion,
} from "@/lib/surveys/definition";
import type { SurveyType } from "@/lib/surveys/domain";

export type CanonicalCsvFieldRole = "source" | "timestamp" | "identity" | "answer" | "trusted_context";

export type CanonicalCsvField = {
  column: string;
  required: boolean;
  canonicalId: string;
  label: string;
  acceptedFormat: string;
  acceptedValues: string;
  example: string;
  conditionalRequirement: string;
  role: CanonicalCsvFieldRole;
};

export type CanonicalCsvContract = {
  surveyType: SurveyType;
  surveyVersion: number;
  title: string;
  publishedAt: string;
  fields: CanonicalCsvField[];
  instructions: string[];
};

const commonMetadata = (definition: SurveyDefinition, version: number): CanonicalCsvField[] => [
  {
    column: "surveyType", required: true, canonicalId: "surveyType",
    label: "DevTrack survey type", acceptedFormat: "Exact identifier",
    acceptedValues: definition.surveyType, example: definition.surveyType,
    conditionalRequirement: "", role: "source",
  },
  {
    column: "surveyVersion", required: true, canonicalId: "surveyVersion",
    label: "Published DevTrack survey version", acceptedFormat: "Positive whole number",
    acceptedValues: String(version), example: String(version),
    conditionalRequirement: "Must match the downloaded template version.", role: "source",
  },
  {
    column: "submittedAt", required: true, canonicalId: "submittedAt",
    label: "Original response submission time",
    acceptedFormat: "ISO 8601 timestamp with explicit offset",
    acceptedValues: "Example: 2026-07-29T14:30:00-05:00",
    example: "2026-07-29T14:30:00-05:00",
    conditionalRequirement: "Offset-free legacy timestamps use the confirmed source timezone.", role: "timestamp",
  },
  {
    column: "sourceResponseId", required: false, canonicalId: "sourceResponseId",
    label: "Stable source-system response identifier", acceptedFormat: "Text",
    acceptedValues: "Unique within the source system", example: "fictional-response-001",
    conditionalRequirement: "Strongly recommended for duplicate detection.", role: "source",
  },
  {
    column: "wrikeTaskId", required: false, canonicalId: "wrikeTaskId",
    label: "External Wrike task ID", acceptedFormat: "Wrike task ID, not a DevTrack UUID",
    acceptedValues: "", example: "IEACHQK7JUAJ7NNV",
    conditionalRequirement: "Strongly recommended for exact project matching.", role: "source",
  },
  {
    column: "courseName", required: true, canonicalId: "courseName",
    label: "Readable course name", acceptedFormat: "Text",
    acceptedValues: "", example: "Fictional Course Example",
    conditionalRequirement: "Used as a verification value and fallback exact-name match.", role: "source",
  },
];

const identityFields = (type: SurveyType): CanonicalCsvField[] => type === "course_development_debrief"
  ? [
    {
      column: "smeName", required: true, canonicalId: "smeName",
      label: "SME name", acceptedFormat: "Full display name", acceptedValues: "",
      example: "Jordan Example", conditionalRequirement: "Matching evidence only; never creates application access.",
      role: "identity",
    },
    {
      column: "smeEmail", required: false, canonicalId: "smeEmail",
      label: "SME email", acceptedFormat: "Email address", acceptedValues: "",
      example: "jordan.example@example.test", conditionalRequirement: "Matching evidence only; recommended when names are not unique.",
      role: "identity",
    },
  ]
  : [
    {
      column: "reviewerName", required: true, canonicalId: "reviewerName",
      label: "Instructional designer/reviewer name", acceptedFormat: "Full display name", acceptedValues: "",
      example: "Alex Reviewer", conditionalRequirement: "Matching evidence only; never creates application access.",
      role: "identity",
    },
    {
      column: "reviewerEmail", required: false, canonicalId: "reviewerEmail",
      label: "Instructional designer/reviewer email", acceptedFormat: "Email address", acceptedValues: "",
      example: "alex.reviewer@example.test", conditionalRequirement: "Recommended when names are not unique.",
      role: "identity",
    },
    {
      column: "reviewedSmeName", required: true, canonicalId: "reviewedSmeName",
      label: "Reviewed SME name", acceptedFormat: "Full display name", acceptedValues: "",
      example: "Jordan Example", conditionalRequirement: "Matching evidence only; never creates or merges identities.",
      role: "identity",
    },
    {
      column: "reviewedSmeEmail", required: false, canonicalId: "reviewedSmeEmail",
      label: "Reviewed SME email", acceptedFormat: "Email address", acceptedValues: "",
      example: "jordan.example@example.test", conditionalRequirement: "Recommended when names are not unique.",
      role: "identity",
    },
  ];

function acceptedFormat(question: SurveyQuestion) {
  if (question.type === "date") return "ISO date: YYYY-MM-DD";
  if (question.type === "number") {
    const whole = question.validation.step === 1 ? "Whole number" : "Decimal";
    return `${whole}${question.validation.min != null || question.validation.max != null
      ? ` (${question.validation.min ?? "unbounded"} to ${question.validation.max ?? "unbounded"})` : ""}`;
  }
  if (question.type === "currency") return "Nonnegative USD decimal; do not include a currency symbol";
  if (question.type === "yes_no") return "Yes or No";
  if (question.type === "rating_scale") return `Whole number from ${question.scale?.min} to ${question.scale?.max}`;
  if (question.type === "single_choice") return "Exact listed value";
  if (question.type === "long_text" || question.type === "short_text") {
    return `Plain text${question.validation.maxLength ? `; maximum ${question.validation.maxLength.toLocaleString()} characters` : ""}`;
  }
  return "Text";
}

function acceptedValues(question: SurveyQuestion) {
  if (question.type === "yes_no") return "Yes | No";
  if (question.type === "single_choice") return (question.options ?? []).map((option) => option.label).join(" | ");
  if (question.scale) {
    return (question.scale.labels ?? []).map((label, index) => `${question.scale!.min + index} = ${label}`).join(" | ");
  }
  return "";
}

function exampleValue(question: SurveyQuestion) {
  if (question.id === "workStartedOn") return "2026-06-01";
  if (question.id === "workFinishedOn") return "2026-06-30";
  if (question.id === "publicationYear") return "2026";
  if (question.id === "vertical") return "P1A";
  if (question.id === "billableHours") return "12.50";
  if (question.id === "amountBilled") return "1250.00";
  if (question.id === "providedRealWorldExamples") return "Yes";
  if (question.id === "realWorldExamplesEffectiveness") return "4";
  if (question.id === "recommendationScore") return "9";
  if (question.id === "comments") return "Fictional feedback for template demonstration.";
  return question.scale ? String(question.scale.max) : "";
}

function conditionalRequirement(question: SurveyQuestion) {
  if (question.id === "billableHours" || question.id === "amountBilled") {
    return "Applicable only to external SMEs. Trusted DevTrack classification controls billing; internal-SME billing is discarded.";
  }
  if (question.id === "realWorldExamplesEffectiveness") {
    return "Required only when providedRealWorldExamples is Yes.";
  }
  if (question.id === "workFinishedOn") return "Must be the same as or later than workStartedOn.";
  if (question.contextBinding) return "Stored as an answer but checked against trusted synchronized project context.";
  return "";
}

function answerFields(definition: SurveyDefinition): CanonicalCsvField[] {
  return orderedQuestions(definition).flatMap((question): CanonicalCsvField[] => {
    if (question.type === "file_upload") return [];
    if (question.type === "rating_matrix") {
      return (question.rows ?? []).map((row) => ({
        column: `${question.id}.${row.id}`,
        required: question.required,
        canonicalId: `${question.id}.${row.id}`,
        label: row.label,
        acceptedFormat: `Whole number from ${question.scale?.min} to ${question.scale?.max}`,
        acceptedValues: acceptedValues(question),
        example: String(question.scale?.max ?? 5),
        conditionalRequirement: conditionalRequirement(question),
        role: "answer",
      }));
    }
    return [{
      column: question.id,
      required: question.required && !["billableHours", "amountBilled"].includes(question.id),
      canonicalId: question.id,
      label: question.label,
      acceptedFormat: acceptedFormat(question),
      acceptedValues: acceptedValues(question),
      example: exampleValue(question),
      conditionalRequirement: conditionalRequirement(question),
      role: question.contextBinding ? "trusted_context" : "answer",
    }];
  });
}

export function canonicalCsvContract(
  definition: SurveyDefinition,
  surveyVersion: number,
  publishedAt: string,
): CanonicalCsvContract {
  return {
    surveyType: definition.surveyType,
    surveyVersion,
    title: definition.title,
    publishedAt,
    fields: [
      ...commonMetadata(definition, surveyVersion),
      ...identityFields(definition.surveyType),
      ...answerFields(definition),
    ],
    instructions: [
      "Identity values are matching evidence only and never create, merge, or replace DevTrack accounts.",
      "SME classification and synchronized project context remain authoritative when CSV evidence disagrees.",
      "Invoice files cannot be embedded or referenced by CSV. Add invoices through the secured survey attachment workflow after reconciliation.",
      "Uploading is always a staged dry run. Canonical survey records are created only by a separate integration action.",
    ],
  };
}

export function csvEncode(rows: readonly (readonly unknown[])[]) {
  const cell = (value: unknown) => {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return rows.map((row) => row.map(cell).join(",")).join("\r\n");
}

export function blankCanonicalCsv(contract: CanonicalCsvContract) {
  return `${csvEncode([contract.fields.map((field) => field.column)])}\r\n`;
}

export function exampleCanonicalCsv(contract: CanonicalCsvContract) {
  return `${csvEncode([
    contract.fields.map((field) => field.column),
    contract.fields.map((field) => field.example),
  ])}\r\n`;
}

export function canonicalDataDictionaryCsv(contract: CanonicalCsvContract) {
  return `${csvEncode([
    ["Column", "Required", "Canonical question ID", "In-app label", "Accepted format", "Accepted values / scale", "Example", "Conditional requirements", "Field role"],
    ...contract.fields.map((field) => [
      field.column, field.required ? "Required" : "Optional", field.canonicalId,
      field.label, field.acceptedFormat, field.acceptedValues, field.example,
      field.conditionalRequirement, field.role,
    ]),
  ])}\r\n`;
}
