import { describe, expect, it } from "vitest";
import {
  blankCanonicalCsv,
  canonicalCsvContract,
  canonicalDataDictionaryCsv,
  exampleCanonicalCsv,
} from "@/lib/surveys/csv-contract";
import { INITIAL_SURVEY_DEFINITIONS } from "@/lib/surveys/definition";
import {
  detectHistoricalSurveyType,
  historicalColumnMappings,
  parseHistoricalCsv,
  parseHistoricalRow,
} from "@/lib/surveys/historical-import";

describe("definition-derived historical survey CSV", () => {
  it.each(["course_development_debrief", "id_sme_review"] as const)(
    "derives %s templates and mappings from its published definition",
    (surveyType) => {
      const definition = INITIAL_SURVEY_DEFINITIONS[surveyType];
      const contract = canonicalCsvContract(definition, 7, "2026-07-29T12:00:00Z");
      expect(contract.fields.map((field) => field.column)).toContain("surveyVersion");
      expect(contract.fields.map((field) => field.column)).toContain("rating01");
      expect(blankCanonicalCsv(contract).split(/\r?\n/)).toHaveLength(2);
      expect(exampleCanonicalCsv(contract)).toContain("fictional-response-001");
      expect(canonicalDataDictionaryCsv(contract)).toContain("Canonical question ID");
      expect(historicalColumnMappings(surveyType, "canonical", definition, 7))
        .toHaveLength(contract.fields.length);
    },
  );

  it("detects and parses the canonical ID review without the historical effectiveness follow-up", () => {
    const definition = INITIAL_SURVEY_DEFINITIONS.id_sme_review;
    const contract = canonicalCsvContract(definition, 3, "2026-07-29T12:00:00Z");
    const document = parseHistoricalCsv(exampleCanonicalCsv(contract));
    const detection = detectHistoricalSurveyType("review-history.csv", document.headers, document.rows);
    expect(detection).toMatchObject({ surveyType: "id_sme_review", format: "canonical", conflict: false });
    const parsed = parseHistoricalRow("id_sme_review", document.rows[0], "America/Chicago", "canonical", definition, 3);
    expect(parsed.issues).toEqual([]);
    expect(parsed.answers).toMatchObject({
      providedRealWorldExamples: true,
      recommendationScore: 9,
      rating01: 5,
    });
    expect(parsed.answers).not.toHaveProperty("realWorldExamplesEffectiveness");
    expect(parsed.reviewedSmeEmail).toBe("jordan.example@example.test");
  });

  it("rejects mixed survey types and a mismatched published version", () => {
    const definition = INITIAL_SURVEY_DEFINITIONS.course_development_debrief;
    const contract = canonicalCsvContract(definition, 4, "2026-07-29T12:00:00Z");
    const document = parseHistoricalCsv(exampleCanonicalCsv(contract));
    document.rows[0].surveyType = "id_sme_review";
    expect(detectHistoricalSurveyType("history.csv", document.headers, document.rows).conflict).toBe(true);
    document.rows[0].surveyType = "course_development_debrief";
    const parsed = parseHistoricalRow("course_development_debrief", document.rows[0], "UTC", "canonical", definition, 5);
    expect(parsed.issues.some((issue) => issue.field === "surveyVersion")).toBe(true);
  });
});
