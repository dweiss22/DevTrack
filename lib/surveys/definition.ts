import { z } from "zod";
import {
  AGREEMENT_SCALE,
  COLLABORATION_SCALE,
  EXAMPLE_EFFECTIVENESS_SCALE,
  ID_REVIEW_STATEMENTS,
  SME_DEBRIEF_STATEMENTS,
  SURVEY_TYPES,
  SURVEY_VERTICALS,
  type SurveyType,
} from "@/lib/surveys/domain";

export const QUESTION_TYPES = [
  "short_text",
  "long_text",
  "number",
  "currency",
  "date",
  "yes_no",
  "single_choice",
  "multiple_choice",
  "rating_scale",
  "rating_matrix",
  "file_upload",
] as const;
export type SurveyQuestionType = typeof QUESTION_TYPES[number];

export const QUESTION_WIDTHS = ["full", "half", "third"] as const;
export const CONTEXT_BINDINGS = ["originalDueYear", "reportingYear", "publicationYear", "vertical"] as const;
export const CONDITION_OPERATORS = [
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "greater_than",
  "less_than",
  "answered",
  "not_answered",
] as const;

const identifier = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);
const unsafeAuthoredContent = /<[^>]*>|\b(?:https?|ftp):\/\/|\bwww\.|javascript:|data:text\/html|\b(?:expression|url)\s*\(|\$\{|{{|}}/i;
const authoredText = (maximum: number) => z.string().max(maximum)
  .refine((value) => !unsafeAuthoredContent.test(value), "HTML, URLs, styles, and executable expressions are not allowed.");
const safeText = (maximum: number) => authoredText(maximum).default("");
const requiredText = (maximum: number) => authoredText(maximum).pipe(z.string().trim().min(1).max(maximum));
const optionSchema = z.object({ id: identifier, label: requiredText(200) });
const conditionRuleSchema = z.object({
  questionId: identifier,
  operator: z.enum(CONDITION_OPERATORS),
  value: z.union([z.string().max(1_000), z.number().finite(), z.boolean(), z.array(z.string().max(200)).max(50)]).optional(),
});
const visibilitySchema = z.object({
  match: z.enum(["all", "any"]),
  rules: z.array(conditionRuleSchema).min(1).max(20),
});

const questionSchema = z.object({
  id: identifier,
  type: z.enum(QUESTION_TYPES),
  label: requiredText(1_000),
  helpText: safeText(1_000),
  required: z.boolean().default(false),
  width: z.enum(QUESTION_WIDTHS).default("full"),
  contextBinding: z.enum(CONTEXT_BINDINGS).optional(),
  visibility: visibilitySchema.optional(),
  validation: z.object({
    minLength: z.number().int().min(0).max(10_000).optional(),
    maxLength: z.number().int().min(1).max(10_000).optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    step: z.number().positive().optional(),
    earliest: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    latest: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    minSelections: z.number().int().min(0).max(50).optional(),
    maxSelections: z.number().int().min(1).max(50).optional(),
    allowedExtensions: z.array(z.enum(["pdf", "doc", "docx", "xls", "xlsx", "png", "jpg", "jpeg"])).max(8).optional(),
    maxSizeBytes: z.number().int().min(1).max(10 * 1024 * 1024).optional(),
  }).default({}),
  options: z.array(optionSchema).max(50).optional(),
  scale: z.object({
    min: z.number().int().min(0).max(9),
    max: z.number().int().min(1).max(10),
    minLabel: safeText(200),
    maxLabel: safeText(200),
    labels: z.array(authoredText(200)).max(11).optional(),
  }).optional(),
  rows: z.array(optionSchema).max(50).optional(),
});

export const surveyDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  surveyType: z.enum(SURVEY_TYPES),
  title: requiredText(200),
  introduction: safeText(5_000),
  instructions: safeText(5_000),
  completionMessage: requiredText(5_000),
  presentation: z.enum(["one_page", "multi_page"]),
  buttons: z.object({
    saveDraft: requiredText(80),
    previous: requiredText(80),
    next: requiredText(80),
    submit: requiredText(80),
    return: requiredText(80),
  }),
  sections: z.array(z.object({
    id: identifier,
    title: requiredText(200),
    description: safeText(1_000),
    pageBreakBefore: z.boolean().default(false),
    questions: z.array(questionSchema).max(200),
  })).min(1).max(30),
}).superRefine((definition, context) => {
  const seen = new Set<string>();
  const trustedSmeContextIds = new Set([
    "internalEmployee", "originalDueYear", "reportingYear", "smeClassification",
  ]);
  const priorQuestions = new Map<string, SurveyQuestionType>(
    definition.surveyType === "course_development_debrief"
      ? [["internalEmployee", "yes_no"]]
      : [],
  );
  let questionCount = 0;
  for (const section of definition.sections) {
    if (seen.has(section.id)) {
      context.addIssue({ code: "custom", message: `Duplicate identifier: ${section.id}` });
    }
    seen.add(section.id);
    for (const question of section.questions) {
      questionCount += 1;
      if (definition.surveyType === "course_development_debrief"
        && trustedSmeContextIds.has(question.id)) {
        context.addIssue({
          code: "custom",
          message: "SME type and Course Reporting Year are trusted context and cannot be editable questions.",
        });
      }
      if (seen.has(question.id)) context.addIssue({ code: "custom", message: `Duplicate identifier: ${question.id}` });
      for (const rule of question.visibility?.rules ?? []) {
        const referencedType = priorQuestions.get(rule.questionId);
        if (!referencedType) {
          context.addIssue({ code: "custom", message: `${question.label} can only depend on an earlier question.` });
          continue;
        }
        const alwaysAllowed = rule.operator === "answered" || rule.operator === "not_answered";
        const equalityAllowed = rule.operator === "equals" || rule.operator === "not_equals";
        const containsAllowed = rule.operator === "contains" || rule.operator === "not_contains";
        const comparisonAllowed = rule.operator === "greater_than" || rule.operator === "less_than";
        const compatible = alwaysAllowed
          || (equalityAllowed && referencedType !== "file_upload" && referencedType !== "rating_matrix")
          || (containsAllowed && ["short_text", "long_text", "multiple_choice"].includes(referencedType))
          || (comparisonAllowed && ["number", "currency", "date", "rating_scale"].includes(referencedType));
        if (!compatible) {
          context.addIssue({ code: "custom", message: `${rule.operator} is not valid for ${referencedType}.` });
        }
        if (!alwaysAllowed && rule.value === undefined) {
          context.addIssue({ code: "custom", message: `${rule.operator} requires a comparison value.` });
        }
      }
      const choice = question.type === "single_choice" || question.type === "multiple_choice";
      if (choice && (!question.options || question.options.length < 2)) {
        context.addIssue({ code: "custom", message: `${question.label} requires at least two choices.` });
      }
      if (question.type === "rating_scale" && (
        !question.scale || question.scale.max <= question.scale.min || question.scale.max - question.scale.min > 10
      )) {
        context.addIssue({ code: "custom", message: `${question.label} requires a valid rating scale.` });
      }
      if (question.type === "rating_matrix" && (
        !question.rows?.length || !question.scale || question.scale.max <= question.scale.min
        || question.scale.max - question.scale.min > 10
      )) {
        context.addIssue({ code: "custom", message: `${question.label} requires rows and a valid scale.` });
      }
      if (question.contextBinding === "vertical" && question.type !== "single_choice") {
        context.addIssue({ code: "custom", message: "Vertical bindings require a single-choice question." });
      }
      if ((question.contextBinding === "originalDueYear" || question.contextBinding === "reportingYear"
          || question.contextBinding === "publicationYear")
        && question.type !== "number") {
        context.addIssue({ code: "custom", message: "Year bindings require a number question." });
      }
      if (question.validation.maxLength != null && question.validation.minLength != null
        && question.validation.maxLength < question.validation.minLength) {
        context.addIssue({ code: "custom", message: `${question.label} has an invalid text range.` });
      }
      if (question.validation.max != null && question.validation.min != null
        && question.validation.max < question.validation.min) {
        context.addIssue({ code: "custom", message: `${question.label} has an invalid numeric range.` });
      }
      seen.add(question.id);
      priorQuestions.set(question.id, question.type);
    }
  }
  if (questionCount > 200) context.addIssue({ code: "custom", message: "A survey may contain at most 200 questions." });
});

export type SurveyDefinition = z.infer<typeof surveyDefinitionSchema>;
export type SurveyQuestion = SurveyDefinition["sections"][number]["questions"][number];
export type SurveyAnswers = Record<string, unknown>;

const commonButtons = {
  saveDraft: "Save draft",
  previous: "Previous",
  next: "Next",
  submit: "Submit survey",
  return: "Return to dashboard",
};

const matrixRows = (statements: readonly string[]) => statements.map((label, index) => ({
  id: `rating${String(index + 1).padStart(2, "0")}`,
  label,
}));

export const INITIAL_SURVEY_DEFINITIONS: Record<SurveyType, SurveyDefinition> = {
  course_development_debrief: {
    schemaVersion: 1,
    surveyType: "course_development_debrief",
    title: "Course Development Debrief",
    introduction: "Share your experience developing this course with Lexipol.",
    instructions: "Complete every required field. You may save a draft and return before submitting.",
    completionMessage: "Survey submitted successfully. Your response is locked and its history has been preserved.",
    presentation: "one_page",
    buttons: commonButtons,
    sections: [
      {
        id: "project-details",
        title: "Project details",
        description: "",
        pageBreakBefore: false,
        questions: [
          {
            id: "originalDueYear", type: "number", label: "Course’s Original Due Year", helpText: "",
            required: true, width: "half", contextBinding: "originalDueYear",
            validation: { min: 1000, max: 9999, step: 1 },
          },
          {
            id: "internalEmployee", type: "yes_no", label: "Are you an internal Lexipol employee?",
            helpText: "", required: true, width: "half", validation: {},
          },
        ].filter((question) => !["originalDueYear", "internalEmployee"].includes(question.id)) as SurveyDefinition["sections"][number]["questions"],
      },
      {
        id: "billing",
        title: "Billable information",
        description: "External SMEs must provide billing details and an invoice.",
        pageBreakBefore: false,
        questions: [
          {
            id: "billableHours", type: "number", label: "Billable Hours", helpText: "", required: true,
            width: "half", validation: { min: 0, max: 99_999_999, step: 0.01 },
            visibility: { match: "all", rules: [{ questionId: "internalEmployee", operator: "equals", value: false }] },
          },
          {
            id: "amountBilled", type: "currency", label: "Amount Billed (USD)", helpText: "", required: true,
            width: "half", validation: { min: 0, max: 99_999_999, step: 0.01 },
            visibility: { match: "all", rules: [{ questionId: "internalEmployee", operator: "equals", value: false }] },
          },
          {
            id: "invoice", type: "file_upload", label: "Invoice", helpText: "", required: true,
            width: "full", validation: {
              maxSizeBytes: 10 * 1024 * 1024,
              allowedExtensions: ["pdf", "doc", "docx", "xls", "xlsx", "png", "jpg", "jpeg"],
            },
            visibility: { match: "all", rules: [{ questionId: "internalEmployee", operator: "equals", value: false }] },
          },
        ],
      },
      {
        id: "dates",
        title: "Dates",
        description: "",
        pageBreakBefore: false,
        questions: [
          {
            id: "workStartedOn", type: "date", label: "When did you START working on this project?",
            helpText: "", required: true, width: "half", validation: {},
          },
          {
            id: "workFinishedOn", type: "date", label: "When did you FINISH working on this project?",
            helpText: "", required: true, width: "half", validation: {},
          },
        ],
      },
      {
        id: "ratings",
        title: "Collaboration ratings",
        description: "",
        pageBreakBefore: false,
        questions: [{
          id: "collaborationRatings", type: "rating_matrix", label: "Rate each statement",
          helpText: "", required: true, width: "full", validation: {},
          rows: matrixRows(SME_DEBRIEF_STATEMENTS),
          scale: { min: 1, max: 5, minLabel: AGREEMENT_SCALE[0], maxLabel: AGREEMENT_SCALE[4], labels: [...AGREEMENT_SCALE] },
        }],
      },
      {
        id: "comments-section",
        title: "Additional comments",
        description: "",
        pageBreakBefore: false,
        questions: [{
          id: "comments", type: "long_text",
          label: "Please provide any additional comments or suggestions for improving the course development process at Lexipol.",
          helpText: "", required: false, width: "full", validation: { maxLength: 5_000 },
        }],
      },
    ],
  },
  id_sme_review: {
    schemaVersion: 1,
    surveyType: "id_sme_review",
    title: "Review of Subject Matter Expert",
    introduction: "It’s time to share your insights on your recent work with the SME assigned to this project.",
    instructions: "Complete every required field. You may save a draft and return before submitting.",
    completionMessage: "Review submitted successfully. Your response is locked and its history has been preserved.",
    presentation: "one_page",
    buttons: commonButtons,
    sections: [
      {
        id: "publication-context",
        title: "Publication context",
        description: "",
        pageBreakBefore: false,
        questions: [
          {
            id: "publicationYear", type: "number", label: "Publication Year", helpText: "", required: true,
            width: "half", contextBinding: "publicationYear", validation: { min: 1000, max: 9999, step: 1 },
          },
          {
            id: "vertical", type: "single_choice", label: "Vertical", helpText: "", required: true,
            width: "half", contextBinding: "vertical", validation: {},
            options: SURVEY_VERTICALS.map((label) => ({ id: label.replaceAll(" ", "_"), label })),
          },
        ],
      },
      {
        id: "ratings",
        title: "Collaboration ratings",
        description: "Use the scale to evaluate different aspects of the collaboration.",
        pageBreakBefore: false,
        questions: [{
          id: "collaborationRatings", type: "rating_matrix", label: "Rate each statement",
          helpText: "", required: true, width: "full", validation: {},
          rows: matrixRows(ID_REVIEW_STATEMENTS),
          scale: { min: 1, max: 5, minLabel: COLLABORATION_SCALE[0], maxLabel: COLLABORATION_SCALE[4], labels: [...COLLABORATION_SCALE] },
        }],
      },
      {
        id: "examples",
        title: "Real-world examples",
        description: "",
        pageBreakBefore: false,
        questions: [
          {
            id: "providedRealWorldExamples", type: "yes_no",
            label: "Did the SME provide sufficient real-world examples and/or case studies for inclusion in the course?",
            helpText: "", required: true, width: "full", validation: {},
          },
          {
            id: "realWorldExamplesEffectiveness", type: "rating_scale",
            label: "Rate the effectiveness of the real-world examples and case studies provided by the SME.",
            helpText: "", required: true, width: "full", validation: {},
            scale: {
              min: 1, max: 5, minLabel: EXAMPLE_EFFECTIVENESS_SCALE[0],
              maxLabel: EXAMPLE_EFFECTIVENESS_SCALE[4], labels: [...EXAMPLE_EFFECTIVENESS_SCALE],
            },
            visibility: { match: "all", rules: [{ questionId: "providedRealWorldExamples", operator: "equals", value: true }] },
          },
        ],
      },
      {
        id: "recommendation",
        title: "Recommendation",
        description: "",
        pageBreakBefore: false,
        questions: [{
          id: "recommendationScore", type: "rating_scale",
          label: "Considering your experience, how likely are you to recommend working with this SME to other team members or instructional designers?",
          helpText: "", required: true, width: "full", validation: {},
          scale: { min: 0, max: 10, minLabel: "Not at all likely", maxLabel: "Extremely likely" },
        }],
      },
      {
        id: "comments-section",
        title: "Additional comments",
        description: "",
        pageBreakBefore: false,
        questions: [{
          id: "comments", type: "long_text",
          label: "Please provide any additional comments or suggestions for improving the process of working with SMEs in course development.",
          helpText: "", required: false, width: "full", validation: { maxLength: 5_000 },
        }],
      },
    ],
  },
};

export function orderedQuestions(definition: SurveyDefinition) {
  return definition.sections.flatMap((section) => section.questions);
}

function answered(value: unknown) {
  return value !== undefined && value !== null && value !== ""
    && (!Array.isArray(value) || value.length > 0)
    && (typeof value !== "object" || Array.isArray(value) || Object.keys(value as object).length > 0);
}

export function conditionMatches(rule: z.infer<typeof conditionRuleSchema>, answers: SurveyAnswers) {
  const actual = answers[rule.questionId];
  switch (rule.operator) {
    case "answered": return answered(actual);
    case "not_answered": return !answered(actual);
    case "equals": return actual === rule.value;
    case "not_equals": return actual !== rule.value;
    case "contains": return Array.isArray(actual) ? actual.includes(rule.value) : String(actual ?? "").includes(String(rule.value ?? ""));
    case "not_contains": return Array.isArray(actual) ? !actual.includes(rule.value) : !String(actual ?? "").includes(String(rule.value ?? ""));
    case "greater_than": return Number(actual) > Number(rule.value);
    case "less_than": return Number(actual) < Number(rule.value);
  }
}

export function questionIsVisible(question: SurveyQuestion, answers: SurveyAnswers) {
  if (!question.visibility) return true;
  const results = question.visibility.rules.map((rule) => conditionMatches(rule, answers));
  return question.visibility.match === "all" ? results.every(Boolean) : results.some(Boolean);
}

export function applyContextBindings(definition: SurveyDefinition, answers: SurveyAnswers, context: Record<string, unknown>) {
  const next = { ...answers };
  if (definition.surveyType === "course_development_debrief") {
    if (context.smeClassification === "internal") next.internalEmployee = true;
    else if (context.smeClassification === "external") next.internalEmployee = false;
    else delete next.internalEmployee;
    delete next.originalDueYear;
    delete next.reportingYear;
    delete next.smeClassification;
  }
  for (const question of orderedQuestions(definition)) {
    if (!question.contextBinding) continue;
    const value = context[question.contextBinding];
    if (value !== undefined && value !== null && value !== "") next[question.id] = value;
  }
  return next;
}

export function validateSurveyAnswers(
  definition: SurveyDefinition,
  input: SurveyAnswers,
  attachmentQuestionIds: ReadonlySet<string> = new Set(),
) {
  const errors: Record<string, string> = {};
  const answers: SurveyAnswers = {};
  for (const question of orderedQuestions(definition)) {
    if (!questionIsVisible(question, input)) continue;
    const value = input[question.id];
    if (question.type === "file_upload") {
      if (question.required && !attachmentQuestionIds.has(question.id)) errors[question.id] = "A file is required.";
      continue;
    }
    if (!answered(value)) {
      if (question.required) errors[question.id] = "This field is required.";
      continue;
    }
    const fail = (message: string) => { errors[question.id] = message; };
    if (question.type === "short_text" || question.type === "long_text") {
      if (typeof value !== "string") fail("Enter text.");
      else if (question.validation.minLength != null && value.length < question.validation.minLength) fail(`Enter at least ${question.validation.minLength} characters.`);
      else if (value.length > (question.validation.maxLength ?? 10_000)) fail(`Enter no more than ${question.validation.maxLength ?? 10_000} characters.`);
    } else if (question.type === "number" || question.type === "currency") {
      const numeric = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(numeric)) fail("Enter a valid number.");
      else if (question.validation.min != null && numeric < question.validation.min) fail(`Enter ${question.validation.min} or more.`);
      else if (question.validation.max != null && numeric > question.validation.max) fail(`Enter ${question.validation.max} or less.`);
      else answers[question.id] = numeric;
    } else if (question.type === "date") {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail("Enter a valid date.");
      else if (question.validation.earliest && value < question.validation.earliest) fail(`Use a date on or after ${question.validation.earliest}.`);
      else if (question.validation.latest && value > question.validation.latest) fail(`Use a date on or before ${question.validation.latest}.`);
    } else if (question.type === "yes_no") {
      if (typeof value !== "boolean") fail("Select yes or no.");
    } else if (question.type === "single_choice") {
      if (typeof value !== "string" || !question.options?.some((option) => option.id === value || option.label === value)) fail("Select an available choice.");
    } else if (question.type === "multiple_choice") {
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !question.options?.some((option) => option.id === item))) fail("Select only available choices.");
      else if (value.length < (question.validation.minSelections ?? 0)) fail(`Select at least ${question.validation.minSelections} choices.`);
      else if (value.length > (question.validation.maxSelections ?? 50)) fail(`Select no more than ${question.validation.maxSelections} choices.`);
    } else if (question.type === "rating_scale") {
      const numeric = Number(value);
      if (!question.scale || !Number.isInteger(numeric) || numeric < question.scale.min || numeric > question.scale.max) fail("Select an available rating.");
      else answers[question.id] = numeric;
    } else if (question.type === "rating_matrix") {
      if (!question.scale || typeof value !== "object" || value === null || Array.isArray(value)) fail("Complete the rating matrix.");
      else {
        const matrix = value as Record<string, unknown>;
        if (question.rows?.some((row) => {
          const rating = Number(matrix[row.id]);
          return !Number.isInteger(rating) || rating < question.scale!.min || rating > question.scale!.max;
        })) fail("Complete every matrix row with an available rating.");
      }
    }
    if (!errors[question.id] && answers[question.id] === undefined) answers[question.id] = value;
  }
  const workStartedOn = answers.workStartedOn;
  const workFinishedOn = answers.workFinishedOn;
  const today = new Date().toISOString().slice(0, 10);
  if (typeof workStartedOn === "string" && workStartedOn > today) {
    errors.workStartedOn = "The start date cannot be in the future.";
  }
  if (typeof workStartedOn === "string" && typeof workFinishedOn === "string" && workFinishedOn < workStartedOn) {
    errors.workFinishedOn = "The finish date cannot be before the start date.";
  }
  return { success: Object.keys(errors).length === 0, errors, answers };
}

export function responseRecordToAnswers(type: SurveyType, response: Record<string, unknown>): SurveyAnswers {
  const common: SurveyAnswers = { comments: response.comments ?? "" };
  const matrix: Record<string, unknown> = {};
  const count = type === "course_development_debrief" ? 10 : 9;
  for (let index = 1; index <= count; index++) {
    const padded = String(index).padStart(2, "0");
    matrix[`rating${padded}`] = response[`rating_${padded}`] ?? "";
  }
  if (type === "course_development_debrief") {
    return {
      ...common,
      internalEmployee: response.sme_classification === "internal"
        ? true : response.sme_classification === "external" ? false : response.internal_employee ?? "",
      billableHours: response.billable_hours ?? "",
      amountBilled: response.amount_billed ?? "",
      workStartedOn: response.work_started_on ?? "",
      workFinishedOn: response.work_finished_on ?? "",
      collaborationRatings: matrix,
    };
  }
  return {
    ...common,
    publicationYear: response.publication_year ?? "",
    vertical: response.vertical ?? "",
    collaborationRatings: matrix,
    providedRealWorldExamples: response.provided_real_world_examples ?? "",
    realWorldExamplesEffectiveness: response.real_world_examples_effectiveness ?? "",
    recommendationScore: response.recommendation_score ?? "",
  };
}
