import { describe, expect, it } from "vitest";
import {
  escapeCsvFormula,
  finalizedHistoricalTemplate,
  historicalDuplicateKey,
  ID_SME_REVIEW_HEADERS,
  inspectFinalizedHistoricalCsv,
  SME_DEBRIEF_HEADERS,
} from "@/lib/surveys/finalized-historical-import";
import { separateSourceIdForRow } from "@/lib/surveys/finalized-historical-import-server";

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

function csv(headers: readonly string[], rows: Record<string, unknown>[]) {
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
  ].join("\r\n");
}

function smeRow(overrides: Record<string, unknown> = {}) {
  return {
    surveyType: "SME_DEBRIEF",
    surveyVersion: "0.0.0-pre-devtrack",
    submittedAt: "2024-01-02T15:04:05Z",
    sourceResponseId: "sme-1",
    wrikeTaskId: "",
    courseName: "  EMS: Airway Management  ",
    smeName: " Ada Lovelace ",
    smeEmail: "",
    billableHours: "",
    amountBilled: "",
    workStartedOn: "",
    workFinishedOn: "",
    ...Object.fromEntries(Array.from({ length: 10 }, (_, index) => [
      `collaborationRatings.rating${String(index + 1).padStart(2, "0")}`,
      index === 2 ? "Neither Agree nor Disagree" : "Strongly Agree",
    ])),
    comments: "First line\nSecond line, with punctuation!",
    ...overrides,
  };
}

function idRow(overrides: Record<string, unknown> = {}) {
  return {
    surveyType: "ID_SME_REVIEW",
    surveyVersion: "0.0.0-pre-devtrack",
    submittedAt: "1/2/2024 9:15 AM",
    sourceResponseId: "id-1",
    wrikeTaskId: "",
    courseName: "Fire Investigation",
    reviewerName: "Grace Hopper",
    reviewerEmail: "",
    reviewedSmeName: "Alan Turing",
    reviewedSmeEmail: "",
    publicationYear: "2024",
    vertical: "[\"EMS1A\",\"FR1A\"]",
    ...Object.fromEntries(Array.from({ length: 9 }, (_, index) => [
      `collaborationRatings.rating${String(index + 1).padStart(2, "0")}`,
      String((index % 5) + 1),
    ])),
    providedRealWorldExamples: "yEs",
    realWorldExamplesEffectiveness: "",
    recommendationScore: "0",
    comments: "",
    ...overrides,
  };
}

describe("finalized historical survey file detection", () => {
  it("detects an exact SME Debrief file without manual mapping", () => {
    const result = inspectFinalizedHistoricalCsv(csv(SME_DEBRIEF_HEADERS, [smeRow()]));
    expect(result.detectedSurveyType).toBe("SME_DEBRIEF");
    expect(result.internalSurveyType).toBe("course_development_debrief");
    expect(result.totalRows).toBe(1);
    expect(result.validRows).toBe(1);
    expect(result.surveyVersions).toEqual(["0.0.0-pre-devtrack"]);
  });

  it("detects an exact ID Review file", () => {
    const result = inspectFinalizedHistoricalCsv(csv(ID_SME_REVIEW_HEADERS, [idRow()]));
    expect(result.detectedSurveyType).toBe("ID_SME_REVIEW");
    expect(result.internalSurveyType).toBe("id_sme_review");
  });

  it("rejects missing and unsupported headers", () => {
    const missing = ID_SME_REVIEW_HEADERS.filter((header) => header !== "reviewerName");
    expect(inspectFinalizedHistoricalCsv(csv(missing, [idRow()])).issues[0]?.code).toBe("missing_headers");
    expect(inspectFinalizedHistoricalCsv(csv([...ID_SME_REVIEW_HEADERS, "surprise"], [idRow({ surprise: "x" })])).issues[0]?.code)
      .toBe("unsupported_headers");
  });

  it("rejects unknown and mixed survey types", () => {
    const unknown = inspectFinalizedHistoricalCsv(csv(SME_DEBRIEF_HEADERS, [smeRow({ surveyType: "OTHER" })]));
    expect(unknown.issues.some((issue) => issue.code === "unknown_survey_type")).toBe(true);
    const mixed = inspectFinalizedHistoricalCsv(csv(SME_DEBRIEF_HEADERS, [
      smeRow(), smeRow({ surveyType: "ID_SME_REVIEW", sourceResponseId: "other" }),
    ]));
    expect(mixed.issues.some((issue) => issue.code === "mixed_survey_types")).toBe(true);
  });

  it("rejects empty and malformed CSV", () => {
    expect(() => inspectFinalizedHistoricalCsv("")).toThrow(/empty/i);
    expect(() => inspectFinalizedHistoricalCsv("a,b\r\n\"unterminated")).toThrow(/unterminated/i);
    expect(() => inspectFinalizedHistoricalCsv("a,b\r\n1,2,3")).toThrow(/3 values/i);
  });
});

describe("SME Debrief normalization and validation", () => {
  it("preserves multiline comments, trims identity fields, and accepts blank optional values", () => {
    const result = inspectFinalizedHistoricalCsv(csv(SME_DEBRIEF_HEADERS, [smeRow()]));
    const row = result.rows[0].normalized;
    expect(row?.surveyType).toBe("SME_DEBRIEF");
    if (row?.surveyType !== "SME_DEBRIEF") throw new Error("Wrong row type");
    expect(row.courseName).toBe("EMS: Airway Management");
    expect(row.sme.name).toBe("Ada Lovelace");
    expect(row.billableHours).toBeNull();
    expect(row.amountBilled).toBeNull();
    expect(row.comments).toBe("First line\nSecond line, with punctuation!");
    expect(row.collaborationRatings.rating03).toBe(3);
    expect(result.rows[0].status).toBe("Ready with warnings");
  });

  it("retains decimal values and zero", () => {
    const result = inspectFinalizedHistoricalCsv(csv(SME_DEBRIEF_HEADERS, [
      smeRow({ billableHours: "12.25", amountBilled: "$0.00" }),
    ]));
    const row = result.rows[0].normalized;
    if (row?.surveyType !== "SME_DEBRIEF") throw new Error("Wrong row type");
    expect(row.billableHours).toBe(12.25);
    expect(row.amountBilled).toBe(0);
  });

  it("blocks invalid ratings, amounts, dates, missing SME names, and formula values", () => {
    const result = inspectFinalizedHistoricalCsv(csv(SME_DEBRIEF_HEADERS, [smeRow({
      smeName: "",
      amountBilled: "not-money",
      workStartedOn: "2024-02-31",
      "collaborationRatings.rating01": "Neutral",
      comments: "=HYPERLINK(\"https://example.test\")",
    })]));
    expect(result.rows[0].status).toBe("Blocked");
    const codes = result.rows[0].issues.map((issue) => issue.code);
    expect(codes).toEqual(expect.arrayContaining([
      "missing_required_value", "invalid_number", "invalid_date", "invalid_rating", "unsafe_spreadsheet_value",
    ]));
  });

  it("blocks reversed work dates and numbers outside database precision", () => {
    const result = inspectFinalizedHistoricalCsv(csv(SME_DEBRIEF_HEADERS, [smeRow({
      billableHours: "100000000",
      workStartedOn: "2024-02-02",
      workFinishedOn: "2024-02-01",
    })]));
    expect(result.rows[0].status).toBe("Blocked");
    expect(result.rows[0].issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "invalid_date_range", "model_conversion_failed",
    ]));
  });

  it("keeps a missing Wrike task ID importable", () => {
    const row = inspectFinalizedHistoricalCsv(csv(SME_DEBRIEF_HEADERS, [smeRow()])).rows[0];
    expect(row.status).not.toBe("Blocked");
    expect(row.normalized?.wrikeTaskId).toBeNull();
  });
});

describe("ID Review normalization and validation", () => {
  it("retains recommendation endpoints and optional blanks", () => {
    const zero = inspectFinalizedHistoricalCsv(csv(ID_SME_REVIEW_HEADERS, [idRow()])).rows[0].normalized;
    const ten = inspectFinalizedHistoricalCsv(csv(ID_SME_REVIEW_HEADERS, [idRow({ recommendationScore: "10" })])).rows[0].normalized;
    if (zero?.surveyType !== "ID_SME_REVIEW" || ten?.surveyType !== "ID_SME_REVIEW") throw new Error("Wrong row type");
    expect(zero.recommendationScore).toBe(0);
    expect(ten.recommendationScore).toBe(10);
    expect(zero.realWorldExamplesEffectiveness).toBeNull();
    expect(zero.reviewer.email).toBeNull();
  });

  it("blocks ratings and recommendation scores outside their ranges", () => {
    const result = inspectFinalizedHistoricalCsv(csv(ID_SME_REVIEW_HEADERS, [idRow({
      "collaborationRatings.rating01": "6",
      recommendationScore: "11",
    })]));
    expect(result.rows[0].status).toBe("Blocked");
    expect(result.rows[0].issues.filter((issue) => issue.severity === "error")).toHaveLength(2);
  });

  it.each([
    ["FR1A", "FR1A"],
    ["[\"FR1A\"]", "FR1A"],
    ["EMS1A", "EMS1"],
    ["[\"EMS1\"]", "EMS1"],
    ["[\"Lexipol\"]", "Lexipol"],
    ["[\"EMS1A\",\"FR1A\"]", "Cross Vertical"],
  ])("normalizes vertical %s to %s", (source, expected) => {
    const row = inspectFinalizedHistoricalCsv(csv(ID_SME_REVIEW_HEADERS, [idRow({ vertical: source })])).rows[0].normalized;
    if (row?.surveyType !== "ID_SME_REVIEW") throw new Error("Wrong row type");
    expect(row.vertical).toBe(expected);
  });

  it("flags unknown verticals without guessing", () => {
    const result = inspectFinalizedHistoricalCsv(csv(ID_SME_REVIEW_HEADERS, [idRow({ vertical: "Mystery" })]));
    const row = result.rows[0].normalized;
    if (row?.surveyType !== "ID_SME_REVIEW") throw new Error("Wrong row type");
    expect(row.vertical).toBe("Unresolved Vertical");
    expect(result.rows[0].issues.some((issue) => issue.code === "unknown_vertical")).toBe(true);
    expect(result.rows[0].status).toBe("Ready with warnings");
  });
});

describe("duplicate and export helpers", () => {
  it("uses survey type plus source response ID as the stable duplicate key", () => {
    expect(historicalDuplicateKey("org", "SME_DEBRIEF", "source")).toBe("org:SME_DEBRIEF:source");
  });

  it("derives a deterministic collision-safe visible source identifier", () => {
    const first = separateSourceIdForRow("source", "batch", "row");
    expect(first).toBe(separateSourceIdForRow("source", "batch", "row"));
    expect(first).toMatch(/^source#duplicate-[0-9a-f]{16}$/);
  });

  it("generates exact blank templates and escapes formula exports", () => {
    expect(finalizedHistoricalTemplate("SME_DEBRIEF").split(",")[0]).toBe("surveyType");
    expect(finalizedHistoricalTemplate("ID_SME_REVIEW")).toContain("recommendationScore");
    expect(escapeCsvFormula("=1+1")).toBe("'=1+1");
    expect(escapeCsvFormula("ordinary")).toBe("ordinary");
  });
});
