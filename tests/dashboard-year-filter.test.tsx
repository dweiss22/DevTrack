import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DashboardYearFilter } from "@/components/dashboard-year-filter";
import { loadDashboardYearOptions } from "@/lib/reporting/dashboard";

describe("minimal Dashboard Reporting Year filter", () => {
  it("renders only one Reporting Year control with source-style labels", () => {
    const markup = renderToStaticMarkup(<DashboardYearFilter selectedYear={2026} options={[
      { year: 2026, label: "2026 Courses", projectCount: 12 },
      { year: 2025, label: "2025 Courses", projectCount: 8 }
    ]} />);
    expect(markup).toContain('name="reportingYear"');
    expect(markup).toContain("2026 Courses");
    expect(markup).not.toContain('name="statuses"');
    expect(markup).not.toContain('name="q"');
  });

  it("turns a missing years RPC into an actionable migration result", async () => {
    const rpc = async () => ({ data: null, error: { code: "PGRST202", message: "function was not found in the schema cache" } });
    const result = await loadDashboardYearOptions({ rpc } as never);
    expect(result).toMatchObject({ data: null, error: { kind: "migration_required", diagnosticCode: "PGRST202" } });
    expect(result.error?.message).toContain("202607200004");
  });

  it("catches transport exceptions without substituting zeroes", async () => {
    const rpc = async () => { throw new Error("network timeout"); };
    const result = await loadDashboardYearOptions({ rpc } as never);
    expect(result).toMatchObject({ data: null, error: { kind: "query_failed", title: "Dashboard query timed out" } });
  });
});
