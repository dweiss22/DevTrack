import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProjectsFilters } from "@/components/projects-filters";
import { parseReportingFilters } from "@/lib/reporting/filters";
import {
  clearProjectFiltersHref,
  projectContactValues,
  projectFilterFields,
  projectFilterHref,
  projectPersonOptions,
  projectTableVerticalLabel,
  reportingYearOptions
} from "@/lib/reporting/projects";

const customFields = [
  { id: "00000000-0000-0000-0000-000000000001", name: "Reporting", values: ["2025 Courses", "2026 Courses", "unresolved"] },
  { id: "00000000-0000-0000-0000-000000000002", name: "Instructional Designer", values: ["KUAAAAAA", "KUMISSING"] },
  { id: "00000000-0000-0000-0000-000000000003", name: "Authoring Tool", values: ["Rise", "Storyline"] },
  { id: "00000000-0000-0000-0000-000000000004", name: "Course Type", values: ["New", "Revision"] },
  { id: "00000000-0000-0000-0000-000000000005", name: "Vertical", values: ["EMS1", "P1A"] },
  { id: "00000000-0000-0000-0000-000000000006", name: "SME", values: ["KUAAAAAA"] },
  { id: "00000000-0000-0000-0000-000000000007", name: "Course Length", values: ["1 hour"] }
];
const people = [{ wrikeId: "KUAAAAAA", name: "Alex Smith", resolved: true }];
const statuses = [{ id: "S1", name: "In Review", color: "#123456", resolved: true }];
const facets = { customStatusIds: new Set(["S1"]), baseStatuses: new Set<string>(), verticalStates: new Set(["resolved", "missing"]) };

describe("Projects experience", () => {
  it("discovers only intentional filter fields and strict reporting years", () => {
    const fields = projectFilterFields(customFields);
    expect(fields.owner?.name).toBe("Instructional Designer");
    expect(fields.sme?.name).toBe("SME");
    expect(reportingYearOptions(fields.reporting)).toEqual([2026, 2025]);
    expect(projectFilterFields([{ id: "ID1", name: "ID Assigned", values: ["Katie Willis"] }]).owner?.name).toBe("ID Assigned");
  });

  it("uses readable task identities and leaves only raw unknown Wrike IDs unresolved", () => {
    const fields = projectFilterFields(customFields);
    expect(projectPersonOptions(fields.owner, people)).toMatchObject([
      { value: "KUAAAAAA", label: "Alex Smith", resolved: true },
      { value: "KUMISSING", label: "KUMISSING — Name unavailable", resolved: false }
    ]);
    expect(projectContactValues(["KUMISSING"], people)[0]).toMatchObject({ resolved: false, id: "KUMISSING" });
    expect(projectContactValues(["Katie Willis"], people)[0]).toMatchObject({ id: "Katie Willis", label: "Katie Willis", resolved: true, displayable: true, verified: false });
  });

  it("keeps cumulative URL filters, resets pagination, and clears intentionally", () => {
    const filters = parseReportingFilters({ q: "academy", statuses: "S1", page: "4", pageSize: "25", sort: "title", reportingYear: "2026" });
    const changed = new URL(projectFilterHref(filters, { q: "Alex" }, "/?reportingYear=2026"), "https://devtrack.test");
    expect(changed.searchParams.get("q")).toBe("Alex");
    expect(changed.searchParams.get("statuses")).toBe("S1");
    expect(changed.searchParams.get("reportingYear")).toBe("2026");
    expect(changed.searchParams.get("page")).toBe("1");
    expect(changed.searchParams.get("returnTo")).toBe("/?reportingYear=2026");
    const cleared = new URL(clearProjectFiltersHref(filters, "/"), "https://devtrack.test");
    expect(cleared.searchParams.get("q")).toBeNull();
    expect(cleared.searchParams.get("sort")).toBe("title");
    expect(cleared.searchParams.get("pageSize")).toBe("25");
  });

  it("maps the single Vertical control to existing reporting filters", () => {
    expect(parseReportingFilters({ verticalSelection: "associated:EMS1" }).associatedVertical).toBe("EMS1");
    expect(parseReportingFilters({ verticalSelection: "state:missing" }).verticalState).toBe("missing");
    expect(parseReportingFilters({ verticalSelection: "category:Cross Vertical" }).verticalReportingCategory).toBe("Cross Vertical");
  });

  it("shows canonical Vertical membership and never exposes the resolved state", () => {
    expect(projectTableVerticalLabel({ values: ["Legacy"], normalizedVerticals: ["P1A"] }, "resolved")).toBe("P1A");
    expect(projectTableVerticalLabel({ values: ["EMS1"] }, "resolved")).toBe("EMS1");
    expect(projectTableVerticalLabel(undefined, "resolved")).toBe("—");
    expect(projectTableVerticalLabel(undefined, "missing")).toBe("Vertical not assigned");
    expect(projectTableVerticalLabel({ values: ["P1A", "EMS1"] }, "cross_vertical")).toBe("Cross-Vertical");
  });

  it("renders Designer controls without unresolved prefixes on filter values", () => {
    const filters = parseReportingFilters({ reportingYears: ["2025", "2026"], statuses: ["S1"], q: "academy", "cf_00000000-0000-0000-0000-000000000002": ["KUAAAAAA", "KUMISSING"] });
    const markup = renderToStaticMarkup(<ProjectsFilters filters={filters} statuses={statuses} customFields={customFields} people={people} facets={facets} returnTo="/" />);
    expect(markup).toContain('placeholder="Search project titles and associated people"');
    expect(markup.match(/name="reportingYears"/g)).toHaveLength(2);
    expect(markup).toContain('name="statuses"');
    expect(markup).toContain("Designer");
    expect(markup).toContain('aria-label="Designer filter. 2 selected"');
    expect(markup).toContain(">KUMISSING — Name unavailable</span>");
    expect(markup).toContain("2 selected");
    expect(markup).not.toContain("Unresolved Wrike user");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("More Filters");
    expect(markup).toContain("Clear All");
  });

  it("keeps charts conditional and search name resolution inside the authorized reporting path", () => {
    const detailSource = fs.readFileSync(path.join(process.cwd(), "app/projects/[id]/page.tsx"), "utf8");
    const chartSource = fs.readFileSync(path.join(process.cwd(), "components/project-time-analytics.tsx"), "utf8");
    const migration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202607210002_project_people_search.sql"), "utf8");
    expect(detailSource).toContain("plannedMinutes={row.planned_minutes}");
    expect(chartSource).toContain("plannedMinutes != null");
    expect(chartSource).toContain('className="project-chart-card-wide"');
    expect(chartSource).toContain("View accessible data");
    expect(migration).toContain("wrike_task_assignees");
    expect(migration).toContain("person.wrike_id=any(value.display_values)");
  });
});
