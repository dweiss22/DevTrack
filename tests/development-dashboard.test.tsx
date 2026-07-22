import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DevelopmentFiltersForm } from "@/components/development-filters";
import { completionPercentages, developmentFilterHref, parseDevelopmentFilters, resolveDevelopmentContactValues, usesCurrentStatusFallback, type DevelopmentOptions, type DevelopmentProjectRow } from "@/lib/reporting/development";

const options: DevelopmentOptions = {
  statuses: [{ id: "S1", name: "In Review", color: "#123456", resolved: true }],
  users: [{ id: "U1", wrikeId: "KUAAAAAA", name: "Alex Smith", resolved: true }], folders: [], projects: [],
  customFields: [{ id: "F1", name: "Instructional Designer", values: ["KUAAAAAA"] }, { id: "F2", name: "Unrelated Field", values: ["Hidden"] }]
};

describe("Development reporting dashboard", () => {
  it("defaults to the latest supplied reporting year and supports missing records", () => {
    expect(parseDevelopmentFilters({}, 2027)).toMatchObject({ reportingYearMode: "year", reportingYear: 2027, page: 1 });
    expect(parseDevelopmentFilters({ reportingSelection: "missing" }, 2027)).toMatchObject({ reportingYearMode: "missing" });
  });

  it("serializes cumulative chart filters while resetting pagination", () => {
    const filters = parseDevelopmentFilters({ reportingSelection: "year:2026", q: "academy", page: "4" }, 2027);
    const url = new URL(developmentFilterHref(filters, { completionClassification: "completed" }), "https://devtrack.test");
    expect(url.searchParams.get("reportingSelection")).toBe("year:2026");
    expect(url.searchParams.get("q")).toBe("academy");
    expect(url.searchParams.get("completionClassification")).toBe("completed");
    expect(url.searchParams.get("page")).toBe("1");
  });

  it("handles zero totals and documents current-status time attribution", () => {
    expect(completionPercentages(0, 0)).toEqual({ completion: 0, incomplete: 0 });
    expect(completionPercentages(3, 1)).toEqual({ completion: 75, incomplete: 25 });
    expect(usesCurrentStatusFallback("current_task_status")).toBe(true);
  });

  it("resolves Contacts values through synchronized Wrike users", () => {
    const row = { taskId: "T1", customValues: { "instructional designer": { title: "Instructional Designer", values: ["KUAAAAAA", "KUMISSING"], conflict: false } } } as unknown as DevelopmentProjectRow;
    const [resolved] = resolveDevelopmentContactValues([row], options.users, new Set(["instructional designer"]));
    expect(resolved.customValues["instructional designer"].values).toEqual(["Alex Smith", "Unresolved field value (KUMISSING)"]);
  });

  it("renders Reporting Year as the only Development filter control", () => {
    const markup = renderToStaticMarkup(<DevelopmentFiltersForm filters={parseDevelopmentFilters({}, 2026)} years={{ years: [{ year: 2026, label: "2026 Courses", projects: 8 }], missingProjects: 2, defaultYear: 2026 }} options={options} />);
    expect(markup).toContain('name="reportingSelection"');
    expect(markup).toContain("Missing/Unresolved");
    expect(markup).toContain("2026 Courses");
    expect(markup).not.toContain("Instructional Designer");
    expect(markup).not.toContain('name="q"');
    expect((markup.match(/<select/g) ?? [])).toHaveLength(1);
  });

  it("uses the same six project-list columns as Projects and keeps historical-status disclosure", () => {
    const table = fs.readFileSync(path.join(process.cwd(), "components/development-project-table.tsx"), "utf8");
    const page = fs.readFileSync(path.join(process.cwd(), "app/development/page.tsx"), "utf8");
    for (const label of ["Project name", "Status", "Vertical", "ID Assigned", "Folders", "Development percentile"]) expect(table).toContain(`label: "${label}"`);
    expect(table).toContain("SortableTableHeader");
    expect(table).toContain("projectOverviewContactValues");
    expect(table).toContain("projectTableVerticalLabel");
    expect(table).toContain("ProjectPercentileRing");
    expect(table).not.toContain("Visible columns");
    expect(table).not.toContain("devtrack-development-columns");
    expect(page).toContain("loadProjectLengthPercentilesResult");
    expect(fs.readFileSync(path.join(process.cwd(), "components/development-analytics.tsx"), "utf8")).toContain("historical status-at-entry data is not available");
  });

  it("provides a polished, accessible route-level loading state", () => {
    const loading = fs.readFileSync(path.join(process.cwd(), "app/development/loading.tsx"), "utf8");
    expect(loading).toContain("AppShell");
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain('aria-live="polite"');
    expect(loading).toContain("Course-development dashboard");
    expect(loading).toContain("development-route-loading-filter");
    expect(loading).toContain("development-route-loading-chart");
    expect(loading).toContain("development-route-loading-projects");
    for (const label of ["Project name", "Status", "Vertical", "ID Assigned", "Folders", "Development percentile"]) expect(loading).toContain(`"${label}"`);
  });
});
