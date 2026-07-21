import { describe, expect, it } from "vitest";
import { filterProjectTime, groupProjectTimeByCategory, groupProjectTimeByContributor, groupProjectTimeOverTime, projectTimeMetrics, type ProjectTimeEntry } from "@/lib/reporting/project-time";

const entries: ProjectTimeEntry[] = [
  { id: "1", sourceId: "W1", date: "2026-01-04", minutes: 30, contributorId: "A", contributorName: "Alex", contributorResolved: true, categoryId: "DEV", categoryName: "Development", categoryResolved: true, comment: null },
  { id: "2", sourceId: "W2", date: "2026-01-05", minutes: 90, contributorId: "A", contributorName: "Alex", contributorResolved: true, categoryId: "QA", categoryName: "Review", categoryResolved: true, comment: "Reviewed" },
  { id: "3", sourceId: "W3", date: "2026-02-02", minutes: 60, contributorId: "B", contributorName: "Missing user B", contributorResolved: false, categoryId: "DEV", categoryName: "Development", categoryResolved: true, comment: null }
];

describe("project time analytics", () => {
  it("calculates honest summary metrics and zero-entry metrics", () => {
    expect(projectTimeMetrics(entries)).toEqual({ minutes: 180, entries: 3, contributors: 2 });
    expect(projectTimeMetrics([])).toEqual({ minutes: 0, entries: 0, contributors: 0 });
  });

  it("applies inclusive date, contributor, and category boundaries", () => {
    expect(filterProjectTime(entries, { from: "2026-01-05", to: "2026-02-02" }).map((entry) => entry.id)).toEqual(["2", "3"]);
    expect(filterProjectTime(entries, { contributorId: "A", categoryId: "QA" }).map((entry) => entry.id)).toEqual(["2"]);
    expect(filterProjectTime(entries, { from: "2027-01-01" })).toEqual([]);
  });

  it("groups day, Monday-based week, month, contributor, and category totals", () => {
    expect(groupProjectTimeOverTime(entries, "day").map((row) => row.minutes)).toEqual([30, 90, 60]);
    expect(groupProjectTimeOverTime(entries, "week").map((row) => [row.key, row.minutes])).toEqual([["2025-12-29", 30], ["2026-01-05", 90], ["2026-02-02", 60]]);
    expect(groupProjectTimeOverTime(entries, "month").map((row) => [row.key, row.minutes])).toEqual([["2026-01", 120], ["2026-02", 60]]);
    expect(groupProjectTimeByContributor(entries)[0]).toMatchObject({ key: "A", minutes: 120, entries: 2, resolved: true });
    expect(groupProjectTimeByCategory(entries)[0]).toMatchObject({ key: "DEV", minutes: 90, entries: 2 });
  });
});
