import { describe, expect, it } from "vitest";
import { filtersForRpc, parseReportingFilters } from "@/lib/reporting/filters";

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
    expect(parseReportingFilters({ workflowIds: "IEACHQK7K4BHMLHM", reportingYear: "2026", dashboardClassification: "active", dashboardField: "vertical", dashboardValue: "Cross Vertical" })).toMatchObject({
      workflowIds: ["IEACHQK7K4BHMLHM"], reportingYear: 2026, dashboardClassification: "active", dashboardField: "vertical", dashboardValue: "Cross Vertical"
    });
  });
});
