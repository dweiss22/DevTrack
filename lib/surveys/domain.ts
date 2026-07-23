import { z } from "zod";

export const SURVEY_TYPES = ["course_development_debrief", "id_sme_review"] as const;
export type SurveyType = typeof SURVEY_TYPES[number];

export const SME_DEBRIEF_STATEMENTS = [
  "I had a positive experience working with Lexipol as a course developer or contributor.",
  "The goals and objectives set by Lexipol for my contributions were clear.",
  "Lexipol staff were responsive to my inquiries, questions, and concerns related to course development.",
  "The tools and resources provided by Lexipol met my needs to complete assigned work.",
  "The training and support provided by Lexipol met my needs to complete assigned work.",
  "My expertise was utilized throughout course development.",
  "Lexipol was effective in incorporating my feedback.",
  "I had autonomy in designing the course content I was tasked with contributing.",
  "I felt valued and respected as an SME for Lexipol.",
  "I would recommend my peers work with Lexipol for future SME opportunities.",
] as const;

export const ID_REVIEW_STATEMENTS = [
  "How would you rate your overall experience working with the SME?",
  "How would you evaluate the SME’s knowledge and expertise in public safety?",
  "How responsive was the SME to your inquiries and concerns during the project?",
  "How well did the SME understand the principles of instructional design and the needs of our learners?",
  "How effectively did the SME contribute to the development of course content?",
  "How open was the SME to your suggestions and feedback?",
  "How well did the SME meet deadlines and adhere to the project schedule?",
  "How would you rate the overall quality of the course content provided by the SME?",
  "How effectively did the SME assist in making the course content accessible and engaging for learners?",
] as const;

export const AGREEMENT_SCALE = ["Strongly Disagree", "Disagree", "Neutral", "Agree", "Strongly Agree"] as const;
export const COLLABORATION_SCALE = ["Needs Improvement", "Below Expectations", "Meets Expectations", "Above Expectations", "Exceeds Expectations"] as const;
export const EXAMPLE_EFFECTIVENESS_SCALE = [
  "Barely Lifted Off the Ground — The examples were included but did not meaningfully add value.",
  "A Bit Higher — The examples had some use, but their overall impact was limited.",
  "Reached Orbit — The examples made a useful and noticeable contribution.",
  "Shooting for the Moon — The examples significantly enhanced the course content.",
  "Out-of-This-World Amazing — The examples were essential and greatly enriched the learning experience.",
] as const;
export const SURVEY_VERTICALS = ["P1A", "FR1A", "EMS1", "C1A", "LGU", "D1A", "Lexipol", "Wellness", "Cross Vertical", "Other"] as const;

const draftYear = z.union([z.literal(""), z.coerce.number().int().min(1000).max(9999)]);
const draftRating = z.union([z.literal(""), z.coerce.number().int().min(1).max(5)]);
const draftBoolean = z.union([z.literal(""), z.boolean()]);
const optionalMoney = z.union([z.literal(""), z.coerce.number().min(0).max(99_999_999)]);
const optionalDate = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]);

const ratings = (count: number) => Object.fromEntries(
  Array.from({ length: count }, (_, index) => [`rating${String(index + 1).padStart(2, "0")}`, draftRating])
);

export const debriefDraftSchema = z.object({
  originalDueYear: draftYear,
  internalEmployee: draftBoolean,
  billableHours: optionalMoney,
  amountBilled: optionalMoney,
  workStartedOn: optionalDate,
  workFinishedOn: optionalDate,
  ...ratings(10),
  comments: z.string().max(5000),
}).superRefine((value, context) => {
  if (value.workStartedOn && value.workFinishedOn && value.workFinishedOn < value.workStartedOn) {
    context.addIssue({ code: "custom", path: ["workFinishedOn"], message: "The finish date must be the same as or later than the start date." });
  }
  if (value.workStartedOn && value.workStartedOn > new Date().toISOString().slice(0, 10)) {
    context.addIssue({ code: "custom", path: ["workStartedOn"], message: "The start date cannot be in the future." });
  }
});

export const idReviewDraftSchema = z.object({
  publicationYear: draftYear,
  vertical: z.union([z.literal(""), z.enum(SURVEY_VERTICALS)]),
  ...ratings(9),
  providedRealWorldExamples: draftBoolean,
  realWorldExamplesEffectiveness: draftRating,
  recommendationScore: z.union([z.literal(""), z.coerce.number().int().min(0).max(10)]),
  comments: z.string().max(5000),
});

export const surveySaveSchema = z.discriminatedUnion("surveyType", [
  z.object({ surveyType: z.literal("course_development_debrief"), submit: z.boolean().default(false), answers: debriefDraftSchema }),
  z.object({ surveyType: z.literal("id_sme_review"), submit: z.boolean().default(false), answers: idReviewDraftSchema }),
]);

export type AssignedSme = {
  applicationUserId: string;
  wrikeUserId: string;
  wrikeId: string;
  name: string;
  email: string | null;
};

export type SurveyContext = {
  organizationId: string;
  taskId: string;
  taskWrikeId: string;
  taskTitle: string;
  projectId: string | null;
  projectTitle: string | null;
  originalDueDate: string | null;
  originalDueYear: number | null;
  reportingYear: number | null;
  status: string;
  vertical: string | null;
  publicationDate: string | null;
  publicationYear: number | null;
  assignedSmes: AssignedSme[];
  viewer: { id: string; name: string | null; role: string };
};

export const acceptedInvoiceExtensions = ["pdf", "doc", "docx", "xls", "xlsx", "png", "jpg", "jpeg"] as const;
export const invoiceMimeByExtension: Record<string, readonly string[]> = {
  pdf: ["application/pdf"],
  doc: ["application/msword", "application/x-cfb", "application/octet-stream"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip"],
  xls: ["application/vnd.ms-excel", "application/x-cfb", "application/octet-stream"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/zip"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
};

export function validateInvoiceFile(name: string, declaredMime: string, bytes: Uint8Array) {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  if (!acceptedInvoiceExtensions.includes(extension as typeof acceptedInvoiceExtensions[number])) return "Use a PDF, DOC, DOCX, XLS, XLSX, PNG, JPG, or JPEG file.";
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) return "The invoice must be no larger than 10 MB.";
  if (!invoiceMimeByExtension[extension]?.includes(declaredMime.toLowerCase())) return "The file type does not match the filename.";
  const starts = (...signature: number[]) => signature.every((value, index) => bytes[index] === value);
  const detected = starts(0x25, 0x50, 0x44, 0x46) ? "pdf"
    : starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) ? "png"
      : starts(0xff, 0xd8, 0xff) ? "jpeg"
        : starts(0x50, 0x4b, 0x03, 0x04) ? "zip"
          : starts(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1) ? "ole" : "unknown";
  const valid = extension === "pdf" ? detected === "pdf"
    : extension === "png" ? detected === "png"
      : extension === "jpg" || extension === "jpeg" ? detected === "jpeg"
        : extension === "docx" || extension === "xlsx" ? detected === "zip"
          : detected === "ole";
  return valid ? null : "The detected file content does not match the filename.";
}

export function surveyTitle(type: SurveyType) {
  return type === "course_development_debrief" ? "Course Development Debrief" : "Review of Subject Matter Expert";
}
