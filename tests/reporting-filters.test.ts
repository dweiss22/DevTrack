import { describe, expect, it } from "vitest";
import { filtersForRpc, parseProjectReportingFilters, parseReportingFilters } from "@/lib/reporting/filters";

describe("reporting filters", () => {
  it("normalizes repeated values, pagination, and custom fields", () => {
    const filters = parseReportingFilters({ statuses: ["Active", "Deferred"], page: "2", pageSize: "25", "cf_00000000-0000-0000-0000-000000000001": "Course" });
    expect(filters).toMatchObject({ statuses: ["Active", "Deferred"], page: 2, pageSize: 25, customFields: { "00000000-0000-0000-0000-000000000001": "Course" } });
    expect(filtersForRpc(filters)).not.toHaveProperty("page");
  });
  it("falls back safely when query values are invalid", () => expect(parseReportingFilters({ page: "-2", from: "not-a-date" })).toMatchObject({ page: 1, pageSize: 50 }))
  it("keeps valid filters when optional form controls are empty and converts hours", () => {
    expect(parseReportingFilters({ q: "launch", state: "", from: "", minHours: "1.5", maxPlannedHours: "8" })).toMatchObject({
      q: "launch", minMinutes: 90, maxPlannedMinutes: 480
    });
  });
  it("parses dashboard drill-down filters used by the Projects report", () => {
    expect(parseReportingFilters({ workflowIds: "IEACHQK7K4BHMLHM", reportingYear: "2026", dashboardClassification: "active", verticalReportingCategory: "Cross Vertical", associatedVertical: "EMS1", verticalState: "unrecognized", unresolvedVerticalOnly: "true" })).toMatchObject({
      workflowIds: ["IEACHQK7K4BHMLHM"], reportingYear: 2026, dashboardClassification: "active", verticalReportingCategory: "Cross Vertical", associatedVertical: "EMS1", verticalState: "unrecognized", unresolvedVerticalOnly: true
    });
  });
  it("uses the Projects-only row default and preserves repeated Vertical selections", () => {
    const filters = parseProjectReportingFilters({ verticalSelections: ["associated:P1A", "state:missing"] });
    expect(filters).toMatchObject({ pageSize: 100, verticalSelections: ["associated:P1A", "state:missing"] });
    expect(filtersForRpc(filters)).toMatchObject({ verticalSelections: ["associated:P1A", "state:missing"] });
    expect(parseProjectReportingFilters({ verticalSelections: "invalid-token" }).pageSize).toBe(100);
  });
  it("preserves repeated Projects years and custom-field selections", () => {
    const fieldId = "00000000-0000-0000-0000-000000000001";
    const filters = parseProjectReportingFilters({ reportingYears: ["2025", "2026"], [`cf_${fieldId}`]: ["Rise", "Storyline"] });
    expect(filters).toMatchObject({ reportingYears: [2025, 2026], customFields: { [fieldId]: ["Rise", "Storyline"] } });
    expect(filtersForRpc(filters)).toMatchObject({ reportingYears: [2025, 2026], customFields: { [fieldId]: ["Rise", "Storyline"] } });
  });
});
