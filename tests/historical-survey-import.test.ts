import { describe, expect, it } from "vitest";
import {
  detectHistoricalSurveyType,
  historicalColumnMappings,
  historicalFingerprint,
  historicalSurveyDefinition,
  normalizeHistoricalTitle,
  parseHistoricalCsv,
  parseHistoricalRow,
  parseHistoricalTimestamp,
} from "@/lib/surveys/historical-import";
import { surveyDefinitionSchema } from "@/lib/surveys/definition";

const answersFor = (type: "id_sme_review" | "course_development_debrief") =>
  Object.fromEntries(historicalColumnMappings(type).map((mapping) => [mapping.heading, ""]));

function validIdReview(overrides: Record<string, string> = {}) {
  const row: Record<string, string> = {
    ...answersFor("id_sme_review"),
    Created: "3/10/2026 6:07 AM",
    CourseKey: "Sample Course-2026",
    "Course Name": "Sample Course",
    Name: "Alex Reviewer",
    SME: "Sam Expert",
    Vertical: "[\"EMS1A\"]",
    Year: "2026",
    "Realworld examples": "Yes",
    "SME Promoter Score": "9",
    "additional comments": "Useful examples.",
    ...overrides,
  };
  for (const mapping of historicalColumnMappings("id_sme_review")) {
    if (mapping.canonicalId.startsWith("collaborationRatings.")) row[mapping.heading] = "5";
  }
  return row;
}

function validDebrief(overrides: Record<string, string> = {}) {
  const row: Record<string, string> = {
    ...answersFor("course_development_debrief"),
    CourseKey: "Sample Course-2026",
    "Course Name": "Sample Course",
    "Completion time": "1/10/2026 6:07 AM",
    "SME Name": "Sam Expert",
    Email: "sam@example.test",
    Internal: "No",
    "Billable Hours": "12.50",
    "Total Amount Billed": "$1,234.56",
    "Course's Original Due Date": "2026",
    "Project Start": "1/2/2026",
    "Project End": "1/9/2026",
    "Additional Feedback or Suggestions": "A multiline\ncomment.",
    ...overrides,
  };
  for (const mapping of historicalColumnMappings("course_development_debrief")) {
    if (mapping.canonicalId.startsWith("collaborationRatings.")) row[mapping.heading] = "Strongly Agree";
  }
  return row;
}

describe("historical survey CSV parsing", () => {
  it("preserves quoted commas, escaped quotes, multiline values, and blank cells", () => {
    const parsed = parseHistoricalCsv("\uFEFFA,B,C\r\n\"one, two\",\"line 1\nline 2\",\"said \"\"yes\"\"\"\r\nx,,z\r\n");
    expect(parsed.headers).toEqual(["A", "B", "C"]);
    expect(parsed.rows).toEqual([
      { A: "one, two", B: "line 1\nline 2", C: "said \"yes\"" },
      { A: "x", B: "", C: "z" },
    ]);
  });

  it("detects survey type from exact header signatures and blocks filename disagreement", () => {
    const idHeaders = historicalColumnMappings("id_sme_review")
      .map((mapping) => mapping.heading).filter((heading) => !["Wrike Task ID", "Response ID"].includes(heading));
    const debriefHeaders = historicalColumnMappings("course_development_debrief")
      .map((mapping) => mapping.heading).filter((heading) => !["Wrike Task ID", "Response ID"].includes(heading));
    expect(idHeaders).toHaveLength(19);
    expect(debriefHeaders).toHaveLength(22);
    expect(detectHistoricalSurveyType("ID Review of SME (1).csv", idHeaders)).toMatchObject({
      surveyType: "id_sme_review", filenameType: "id_sme_review", conflict: false, unknownHeaders: [],
    });
    expect(detectHistoricalSurveyType("Lexipol Course Development Debrief.csv", idHeaders).conflict).toBe(true);
    expect(detectHistoricalSurveyType("future-export.csv", [...debriefHeaders, "Wrike Task ID", "Response ID"]).unknownHeaders).toEqual([]);
    expect(detectHistoricalSurveyType("future-export.csv", [...debriefHeaders, "Surprise"]).unknownHeaders).toEqual(["Surprise"]);
  });

  it("normalizes harmless title punctuation without partial or fuzzy matching", () => {
    expect(normalizeHistoricalTitle("  Course\u00a0Name — 2026 ")).toBe("course name - 2026");
    expect(normalizeHistoricalTitle("Course Name")).not.toBe(normalizeHistoricalTitle("Course Names"));
  });
});

describe("historical survey value conversion", () => {
  it("converts the observed ID review formats, Vertical aliases, and optional source identifiers", () => {
    const parsed = parseHistoricalRow("id_sme_review", validIdReview({
      "Wrike Task ID": "IEACHQK7JUAJ7NNV",
      "Response ID": "response-42",
    }), "America/Chicago");
    expect(parsed.submittedAt).toBe("2026-03-10T11:07:00.000Z");
    expect(parsed.wrikeTaskId).toBe("IEACHQK7JUAJ7NNV");
    expect(parsed.sourceResponseId).toBe("response-42");
    expect(parsed.answers).toMatchObject({
      publicationYear: 2026,
      vertical: "EMS1",
      providedRealWorldExamples: true,
      recommendationScore: 9,
      collaborationRatings: {
        rating01: 5, rating02: 5, rating03: 5, rating04: 5, rating05: 5,
        rating06: 5, rating07: 5, rating08: 5, rating09: 5,
      },
    });
    expect(parsed.issues).toEqual([]);
  });

  it("supports serialized and multiple Vertical values but keeps unknown values unresolved", () => {
    expect(parseHistoricalRow("id_sme_review", validIdReview({ Vertical: "[\"P1A\",\"EMS1\"]" }), "America/Chicago").answers.vertical)
      .toBe("Cross Vertical");
    const unknown = parseHistoricalRow("id_sme_review", validIdReview({ Vertical: "EMS-ish" }), "America/Chicago");
    expect(unknown.answers.vertical).toBeUndefined();
    expect(unknown.issues).toContainEqual(expect.objectContaining({ code: "invalid_answer", field: "Vertical", severity: "blocking" }));
  });

  it("converts agreement labels, decimals, currency, dates, comments, and nullable ratings", () => {
    const row = validDebrief();
    const blankRating = historicalColumnMappings("course_development_debrief")
      .find((mapping) => mapping.canonicalId === "collaborationRatings.rating04")!.heading;
    row[blankRating] = "";
    const parsed = parseHistoricalRow("course_development_debrief", row, "America/Chicago");
    expect(parsed.submittedAt).toBe("2026-01-10T12:07:00.000Z");
    expect(parsed.answers).toMatchObject({
      legacyInternalEmployee: false,
      legacyOriginalDueYear: 2026,
      billableHours: 12.5,
      amountBilled: 1234.56,
      workStartedOn: "2026-01-02",
      workFinishedOn: "2026-01-09",
      comments: "A multiline\ncomment.",
    });
    expect((parsed.answers.collaborationRatings as Record<string, number>).rating04).toBeUndefined();
    expect(parsed.issues).toEqual([]);
  });

  it("strips billing from internal snapshots and warns without fabricating missing external billing", () => {
    const internal = parseHistoricalRow("course_development_debrief", validDebrief({
      Internal: "Yes", "Billable Hours": "99", "Total Amount Billed": "$9,999",
    }), "America/Chicago");
    expect(internal.answers.billableHours).toBeUndefined();
    expect(internal.answers.amountBilled).toBeUndefined();
    const external = parseHistoricalRow("course_development_debrief", validDebrief({
      "Billable Hours": "", "Total Amount Billed": "",
    }), "America/Chicago");
    expect(external.issues).toContainEqual(expect.objectContaining({ field: "Billing", severity: "warning" }));
    expect(external.answers.billableHours).toBeUndefined();
  });

  it("rejects malformed timestamps and impossible calendar dates", () => {
    expect(parseHistoricalTimestamp("2/30/2026 6:07 AM", "America/Chicago")).toBeNull();
    expect(parseHistoricalTimestamp("not a date", "America/Chicago")).toBeNull();
    const parsed = parseHistoricalRow("course_development_debrief", validDebrief({ "Project End": "2/30/2026" }), "America/Chicago");
    expect(parsed.issues).toContainEqual(expect.objectContaining({ field: "Project End", severity: "blocking" }));
  });

  it("uses immutable legacy definitions without inventing absent historical questions or invoices", () => {
    const idSurveyDefinition = historicalSurveyDefinition("id_sme_review");
    const debriefSurveyDefinition = historicalSurveyDefinition("course_development_debrief");
    const idDefinition = JSON.stringify(idSurveyDefinition);
    const debriefDefinition = JSON.stringify(debriefSurveyDefinition);
    expect(surveyDefinitionSchema.safeParse(idSurveyDefinition).success).toBe(true);
    expect(surveyDefinitionSchema.safeParse(debriefSurveyDefinition).success).toBe(true);
    expect(idDefinition).not.toContain("realWorldExamplesEffectiveness");
    expect(debriefDefinition).not.toContain("\"invoice\"");
    expect(debriefDefinition).toContain("legacyOriginalDueYear");
    expect(debriefDefinition).toContain("legacyInternalEmployee");
  });

  it("produces stable fingerprints independent of object key order and distinct fingerprints for distinct answers", () => {
    expect(historicalFingerprint({ b: 2, a: { y: 2, x: 1 } }))
      .toBe(historicalFingerprint({ a: { x: 1, y: 2 }, b: 2 }));
    expect(historicalFingerprint({ answers: { score: 9 } }))
      .not.toBe(historicalFingerprint({ answers: { score: 10 } }));
  });
});
