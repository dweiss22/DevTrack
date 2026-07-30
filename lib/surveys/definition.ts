import { z } from "zod";
import {
  AGREEMENT_SCALE,
  COLLABORATION_SCALE,
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
export const CONTEXT_BINDINGS = [
  "smeName",
  "smeEmail",
  "smeClassification",
  "respondentName",
  "courseName",
  "reviewedSmeName",
  "originalDueYear",
  "reportingYear",
  "publicationYear",
  "vertical",
] as const;
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
    displayOrder: z.enum(["ascending", "descending"]).optional(),
    minDescription: safeText(1_000).optional(),
    maxDescription: safeText(1_000).optional(),
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
    "smeName", "smeEmail",
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
        && trustedSmeContextIds.has(question.id) && !question.contextBinding) {
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
      if (question.contextBinding && question.required) {
        context.addIssue({
          code: "custom",
          message: "Trusted context fields are read-only and cannot be required respondent answers.",
        });
      }
      if (question.contextBinding === "smeClassification" && question.type !== "single_choice") {
        context.addIssue({ code: "custom", message: "SME classification bindings require a single-choice question." });
      }
      if ((question.contextBinding === "originalDueYear" || question.contextBinding === "reportingYear"
          || question.contextBinding === "publicationYear")
        && question.type !== "number") {
        context.addIssue({ code: "custom", message: "Year bindings require a number question." });
      }
      if (["smeName", "smeEmail", "respondentName", "courseName", "reviewedSmeName"].includes(question.contextBinding ?? "")
        && question.type !== "short_text") {
        context.addIssue({ code: "custom", message: "Name, email, and course bindings require a short-text question." });
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

const ratingQuestion = (
  id: string,
  label: string,
  helpText: string,
  scale: SurveyQuestion["scale"],
): SurveyQuestion => ({
  id, type: "rating_scale", label, helpText, required: true, width: "full", validation: {}, scale,
});

const agreementScale: NonNullable<SurveyQuestion["scale"]> = {
  min: 1, max: 5, minLabel: AGREEMENT_SCALE[0], maxLabel: AGREEMENT_SCALE[4],
  labels: [...AGREEMENT_SCALE], displayOrder: "descending",
};

const collaborationScale: NonNullable<SurveyQuestion["scale"]> = {
  min: 1, max: 5, minLabel: COLLABORATION_SCALE[0], maxLabel: COLLABORATION_SCALE[4],
  labels: [...COLLABORATION_SCALE], displayOrder: "ascending",
  minDescription: "It really wasn’t up to par.",
  maxDescription: "Absolutely knocked it out of the park—beyond what we hoped for.",
};

export const INITIAL_SURVEY_DEFINITIONS: Record<SurveyType, SurveyDefinition> = {
  course_development_debrief: {
    schemaVersion: 1,
    surveyType: "course_development_debrief",
    title: "Lexipol Course Development Debrief",
    introduction: "Share your experience developing this course with Lexipol.",
    instructions: "Complete every required field. You may save a draft and return before submitting.",
    completionMessage: "Survey submitted successfully. Your response is locked and its history has been preserved.",
    presentation: "one_page",
    buttons: commonButtons,
    sections: [
      {
        id: "project-details", title: "Course and SME details",
        description: "These values come from your DevTrack profile and the associated Wrike course.",
        pageBreakBefore: false,
        questions: [
          { id: "smeName", type: "short_text", label: "SME Name", helpText: "", required: false, width: "half", contextBinding: "smeName", validation: { maxLength: 200 } },
          { id: "smeEmail", type: "short_text", label: "Email", helpText: "", required: false, width: "half", contextBinding: "smeEmail", validation: { maxLength: 320 } },
          {
            id: "smeClassification", type: "single_choice", label: "Internal/External", helpText: "",
            required: false, width: "half", contextBinding: "smeClassification", validation: {},
            options: [{ id: "internal", label: "Internal" }, { id: "external", label: "External" }],
          },
          { id: "reportingYear", type: "number", label: "Course Reporting Year", helpText: "", required: false, width: "half", contextBinding: "reportingYear", validation: { min: 1000, max: 9999, step: 1 } },
        ],
      },
      {
        id: "billing", title: "Billable information",
        description: "External SMEs must provide billing details and an invoice.", pageBreakBefore: false,
        questions: [
          {
            id: "billableHours", type: "number", label: "Billable Hours",
            helpText: "Enter the number of hours billed to Lexipol on your invoice for this work.",
            required: true, width: "half", validation: { min: 0, max: 99_999_999, step: 0.01 },
            visibility: { match: "all", rules: [{ questionId: "internalEmployee", operator: "equals", value: false }] },
          },
          {
            id: "amountBilled", type: "currency", label: "Total Amount Billed",
            helpText: "Enter the total dollar amount billed to Lexipol on your invoice for this work.",
            required: true, width: "half", validation: { min: 0, max: 99_999_999, step: 0.01 },
            visibility: { match: "all", rules: [{ questionId: "internalEmployee", operator: "equals", value: false }] },
          },
          {
            id: "invoice", type: "file_upload", label: "Invoice", helpText: "", required: true, width: "full",
            validation: { maxSizeBytes: 10 * 1024 * 1024, allowedExtensions: ["pdf", "doc", "docx", "xls", "xlsx", "png", "jpg", "jpeg"] },
            visibility: { match: "all", rules: [{ questionId: "internalEmployee", operator: "equals", value: false }] },
          },
        ],
      },
      {
        id: "dates", title: "Dates", description: "", pageBreakBefore: false,
        questions: [
          { id: "workStartedOn", type: "date", label: "Project Start", helpText: "Enter the date you started working on this project.", required: true, width: "half", validation: {} },
          { id: "workFinishedOn", type: "date", label: "Project End", helpText: "Enter the date you submitted your final lesson plan to the Instructional Designer.", required: true, width: "half", validation: {} },
        ],
      },
      {
        id: "ratings", title: "Collaboration ratings", description: "", pageBreakBefore: false,
        questions: [
          ratingQuestion("rating01", "Overall Experience with Lexipol", SME_DEBRIEF_STATEMENTS[0], agreementScale),
          ratingQuestion("rating02", "Clarity of Goals and Objectives", SME_DEBRIEF_STATEMENTS[1], agreementScale),
          ratingQuestion("rating03", "Staff Responsiveness", SME_DEBRIEF_STATEMENTS[2], agreementScale),
          ratingQuestion("rating04", "Adequacy of Tools and Resources", SME_DEBRIEF_STATEMENTS[3], agreementScale),
          ratingQuestion("rating05", "Training and Support Provided", SME_DEBRIEF_STATEMENTS[4], agreementScale),
          ratingQuestion("rating06", "Use of My Expertise", SME_DEBRIEF_STATEMENTS[5], agreementScale),
          ratingQuestion("rating07", "Incorporation of My Feedback", SME_DEBRIEF_STATEMENTS[6], agreementScale),
          ratingQuestion("rating08", "Autonomy in Course Design", SME_DEBRIEF_STATEMENTS[7], agreementScale),
          ratingQuestion("rating09", "Feeling Valued as an SME", SME_DEBRIEF_STATEMENTS[8], agreementScale),
          ratingQuestion("rating10", "Likelihood to Recommend Lexipol", SME_DEBRIEF_STATEMENTS[9], agreementScale),
        ],
      },
      {
        id: "comments-section", title: "Additional comments", description: "", pageBreakBefore: false,
        questions: [{
          id: "comments", type: "long_text", label: "Additional Feedback or Suggestions",
          helpText: "Please provide any additional comments or suggestions for improving the course development process at Lexipol.",
          required: false, width: "full", validation: { maxLength: 5_000 },
        }],
      },
    ],
  },
  id_sme_review: {
    schemaVersion: 1,
    surveyType: "id_sme_review",
    title: "ID Review of SME",
    introduction: "It’s time to share your insights on your recent work with the SME assigned to this project.",
    instructions: "Complete every required field. You may save a draft and return before submitting.",
    completionMessage: "Review submitted successfully. Your response is locked and its history has been preserved.",
    presentation: "one_page",
    buttons: commonButtons,
    sections: [
      {
        id: "project-context", title: "Course and assignment details",
        description: "These values come from your DevTrack profile and the associated Wrike course.",
        pageBreakBefore: false,
        questions: [
          { id: "respondentName", type: "short_text", label: "Instructional Designer’s Name", helpText: "", required: false, width: "half", contextBinding: "respondentName", validation: { maxLength: 200 } },
          { id: "courseName", type: "short_text", label: "Course Name", helpText: "", required: false, width: "half", contextBinding: "courseName", validation: { maxLength: 1_000 } },
          { id: "reviewedSmeName", type: "short_text", label: "Project SME", helpText: "", required: false, width: "half", contextBinding: "reviewedSmeName", validation: { maxLength: 200 } },
          {
            id: "vertical", type: "single_choice", label: "Vertical", helpText: "", required: false, width: "half",
            contextBinding: "vertical", validation: {},
            options: SURVEY_VERTICALS.map((label) => ({ id: label.replaceAll(" ", "_"), label })),
          },
          { id: "reportingYear", type: "number", label: "Reporting Year", helpText: "", required: false, width: "half", contextBinding: "reportingYear", validation: { min: 1000, max: 9999, step: 1 } },
        ],
      },
      {
        id: "ratings", title: "Collaboration ratings",
        description: "Use the scale to evaluate different aspects of the collaboration.", pageBreakBefore: false,
        questions: [
          ratingQuestion("rating01", "Overall Experience", ID_REVIEW_STATEMENTS[0], collaborationScale),
          ratingQuestion("rating02", "SME’s Knowledge and Expertise", ID_REVIEW_STATEMENTS[1], collaborationScale),
          ratingQuestion("rating03", "Responsiveness", ID_REVIEW_STATEMENTS[2], collaborationScale),
          ratingQuestion("rating04", "Instructional Design Knowledge", ID_REVIEW_STATEMENTS[3], collaborationScale),
          ratingQuestion("rating05", "Contribution to Development", ID_REVIEW_STATEMENTS[4], collaborationScale),
          ratingQuestion("rating06", "Openness to Suggestions and Feedback", ID_REVIEW_STATEMENTS[5], collaborationScale),
          ratingQuestion("rating07", "Deadlines and Schedule", ID_REVIEW_STATEMENTS[6], collaborationScale),
          ratingQuestion("rating08", "Overall Quality of the End Product", ID_REVIEW_STATEMENTS[7], collaborationScale),
          ratingQuestion("rating09", "SME Assistance in Learner Interactions", ID_REVIEW_STATEMENTS[8], collaborationScale),
        ],
      },
      {
        id: "examples", title: "Real-world examples", description: "", pageBreakBefore: false,
        questions: [{
          id: "providedRealWorldExamples", type: "yes_no", label: "Real-World Examples",
          helpText: "Did the SME provide sufficient real-world examples and/or case studies for inclusion in the course?",
          required: true, width: "full", validation: {},
        }],
      },
      {
        id: "recommendation", title: "Recommendation", description: "", pageBreakBefore: false,
        questions: [{
          id: "recommendationScore", type: "rating_scale", label: "SME Promoter Score",
          helpText: "Considering your experience, how likely are you to recommend working with this SME to other team members or instructional designers?",
          required: true, width: "full", validation: {},
          scale: {
            min: 0,
            max: 10,
            minLabel: "0 — Not at all likely",
            maxLabel: "10 — Extremely likely",
          },
        }],
      },
      {
        id: "comments-section", title: "Additional comments", description: "", pageBreakBefore: false,
        questions: [{
          id: "comments", type: "long_text", label: "Additional Comments",
          helpText: "Please provide any additional comments or suggestions for improving the process of working with SMEs in course development.",
          required: false, width: "full", validation: { maxLength: 5_000 },
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
  }
  for (const question of orderedQuestions(definition)) {
    if (!question.contextBinding) continue;
    const value = trustedContextValue(question.contextBinding, context);
    if (value !== undefined && value !== null && value !== "") next[question.id] = value;
    else delete next[question.id];
  }
  return next;
}

function nestedValue(context: Record<string, unknown>, key: string, field = "name") {
  const value = context[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)[field] : undefined;
}

export function trustedContextValue(
  binding: NonNullable<SurveyQuestion["contextBinding"]>,
  context: Record<string, unknown>,
) {
  switch (binding) {
    case "smeName": return context.smeName ?? nestedValue(context, "subject");
    case "smeEmail": return context.smeEmail ?? nestedValue(context, "subject", "email") ?? nestedValue(context, "viewer", "email");
    case "respondentName": return context.respondentName ?? nestedValue(context, "viewer");
    case "courseName": return context.courseName ?? context.taskTitle;
    case "reviewedSmeName":
      return context.reviewedSmeName ?? nestedValue(context, "reviewedSme") ?? nestedValue(context, "subject");
    default: return context[binding];
  }
}

export function normalizeCurrency(value: unknown) {
  const raw = typeof value === "number"
    ? (Number.isFinite(value) ? value.toFixed(2) : "")
    : typeof value === "string" ? value.trim() : "";
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  return `${whole.replace(/^0+(?=\d)/, "") || "0"}.${fraction.padEnd(2, "0")}`;
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
    } else if (question.type === "currency") {
      const currency = normalizeCurrency(value);
      if (!currency) fail("Enter a valid currency amount with no more than two decimal places.");
      else {
        const numeric = Number(currency);
        if (question.validation.min != null && numeric < question.validation.min) fail(`Enter ${question.validation.min} or more.`);
        else if (question.validation.max != null && numeric > question.validation.max) fail(`Enter ${question.validation.max} or less.`);
        else answers[question.id] = currency;
      }
    } else if (question.type === "number") {
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
  const individual: Record<string, unknown> = {};
  const count = type === "course_development_debrief" ? 10 : 9;
  for (let index = 1; index <= count; index++) {
    const padded = String(index).padStart(2, "0");
    const value = response[`rating_${padded}`] ?? "";
    matrix[`rating${padded}`] = value;
    individual[`rating${padded}`] = value;
  }
  if (type === "course_development_debrief") {
    return {
      ...common,
      ...individual,
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
    ...individual,
    reportingYear: response.reporting_year ?? "",
    publicationYear: response.publication_year ?? "",
    vertical: response.vertical ?? "",
    collaborationRatings: matrix,
    providedRealWorldExamples: response.provided_real_world_examples ?? "",
    realWorldExamplesEffectiveness: response.real_world_examples_effectiveness ?? "",
    recommendationScore: response.recommendation_score ?? "",
  };
}
