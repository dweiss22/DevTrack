import { describe, expect, it } from "vitest";
import {
  resolveHistoricalPersonAssociation,
  resolveHistoricalProjectMatch,
  type HistoricalProjectCandidate,
} from "@/lib/surveys/finalized-historical-import-server";

const tasks: HistoricalProjectCandidate[] = [
  { id: "1", wrike_id: "WR-1", title: "FF: Fire Investigation", publication_year: 2023 },
  { id: "2", wrike_id: "WR-2", title: "FF: Fire Investigation", publication_year: 2024 },
  { id: "3", wrike_id: "WR-3", title: "EMS: Airway / Management", publication_year: 2024 },
];

describe("historical course reconciliation priority", () => {
  it("prefers an exact Wrike task ID", () => {
    const match = resolveHistoricalProjectMatch({
      surveyType: "SME_DEBRIEF", wrikeTaskId: "WR-3", courseName: "Different",
    }, tasks);
    expect(match.method).toBe("wrike_task_id");
    expect(match.candidates.map((candidate) => candidate.id)).toEqual(["3"]);
  });

  it("uses exact normalized course names and preserves meaningful prefixes", () => {
    const match = resolveHistoricalProjectMatch({
      surveyType: "SME_DEBRIEF", wrikeTaskId: null, courseName: "EMS: Airway/Management",
    }, tasks);
    expect(match.method).toBe("exact_course_name");
    expect(match.candidates[0]?.id).toBe("3");
  });

  it("uses publication year to disambiguate identical course names", () => {
    const match = resolveHistoricalProjectMatch({
      surveyType: "ID_SME_REVIEW", wrikeTaskId: null,
      courseName: "FF: Fire Investigation", publicationYear: 2024,
    }, tasks);
    expect(match.method).toBe("course_name_year");
    expect(match.candidates.map((candidate) => candidate.id)).toEqual(["2"]);
  });

  it("uses a case-insensitive normalized match and surfaces multiple candidates", () => {
    const match = resolveHistoricalProjectMatch({
      surveyType: "SME_DEBRIEF", wrikeTaskId: null, courseName: "ff: fire investigation",
    }, tasks);
    expect(match.method).toBe("case_insensitive_course_name");
    expect(match.candidates).toHaveLength(2);
  });

  it("returns no candidate rather than creating a project", () => {
    const match = resolveHistoricalProjectMatch({
      surveyType: "SME_DEBRIEF", wrikeTaskId: null, courseName: "No Existing Course",
    }, tasks);
    expect(match.method).toBeNull();
    expect(match.candidates).toEqual([]);
  });
});

describe("historical person reconciliation", () => {
  const candidates = [
    { id: "one", name: "Ada Lovelace", email: "ada@example.test" },
    { id: "two", name: "Grace Hopper", email: "grace@example.test" },
  ];

  it("prefers exact normalized email", () => {
    expect(resolveHistoricalPersonAssociation({
      name: "Wrong Name", email: " ADA@example.test ",
    }, candidates)).toEqual({ id: "one", method: "email" });
  });

  it("associates one exact normalized full name without creating or merging anything", () => {
    expect(resolveHistoricalPersonAssociation({
      name: "  Grace   Hopper ", email: null,
    }, candidates)).toEqual({ id: "two", method: "name" });
    expect(candidates).toHaveLength(2);
  });

  it("leaves ambiguous or missing people unmatched", () => {
    expect(resolveHistoricalPersonAssociation({ name: "Unknown", email: null }, candidates)).toBeNull();
    expect(resolveHistoricalPersonAssociation({ name: "Ada Lovelace", email: "duplicate@example.test" }, [
      ...candidates,
      { id: "three", name: "Ada Lovelace", email: "other@example.test" },
    ])).toBeNull();
  });
});
