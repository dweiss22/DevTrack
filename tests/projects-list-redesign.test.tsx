import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DevTrackBrand } from "@/components/devtrack-brand";
import { ProjectPercentileRing } from "@/components/project-percentile-ring";
import { ProjectsLoadFailure } from "@/components/projects-load-failure";
import { ProjectsFilters } from "@/components/projects-filters";
import { loadProjectLengthPercentiles, loadProjectLengthPercentilesResult } from "@/lib/reporting/data";
import { reportingFailure } from "@/lib/reporting/failure";
import { parseProjectReportingFilters } from "@/lib/reporting/filters";

const customFields = [
  { id: "F1", name: "Vertical", values: ["P1A", "EMS1"] },
  { id: "F2", name: "ID Assigned", values: ["Katie Willis"] }
];
const facets = { customStatusIds: new Set<string>(), baseStatuses: new Set<string>(), verticalStates: new Set(["cross_vertical", "missing", "unrecognized", "synchronization_incomplete"]) };

describe("Projects list redesign", () => {
  it("updates the shared brand and gives Projects a 100-row default", () => {
    expect(renderToStaticMarkup(<DevTrackBrand />)).toContain("Development Analysis");
    expect(parseProjectReportingFilters({}).pageSize).toBe(100);
    expect(parseProjectReportingFilters({ pageSize: "25" }).pageSize).toBe(25);
  });

  it("renders a checkbox Vertical multi-select without auto-submitting filter changes", () => {
    const filters = parseProjectReportingFilters({ verticalSelections: ["associated:P1A", "state:missing"] });
    const markup = renderToStaticMarkup(<ProjectsFilters filters={filters} statuses={[]} customFields={customFields} people={[]} facets={facets} />);
    expect(markup.match(/name="verticalSelections"/g)).toHaveLength(12);
    expect(markup).toMatch(/name="verticalSelections" checked="" value="associated:P1A"/);
    expect(markup).toMatch(/name="verticalSelections" checked="" value="state:missing"/);
    expect(markup).toContain("2 selected");
    expect(markup).toContain("Vertical value needs review");
    expect(markup).toContain("Wellness");
    const filterSource = fs.readFileSync(path.join(process.cwd(), "components/projects-filters.tsx"), "utf8");
    const toolbarSource = fs.readFileSync(path.join(process.cwd(), "components/projects-list-toolbar.tsx"), "utf8");
    expect(filterSource).not.toContain("AutoSubmitSelect");
    expect(toolbarSource).toContain("AutoSubmitSelect");
  });

  it("uses the exact six-column table and a formal route loading state", () => {
    const page = fs.readFileSync(path.join(process.cwd(), "app/projects/page.tsx"), "utf8");
    const data = fs.readFileSync(path.join(process.cwd(), "lib/reporting/data.ts"), "utf8");
    const loading = fs.readFileSync(path.join(process.cwd(), "app/projects/loading.tsx"), "utf8");
    for (const label of ["Project name", "Status", "Vertical", "ID Assigned", "Folders", "Development percentile"]) expect(page).toContain(`label: "${label}"`);
    expect(page).toContain("SortableTableHeader");
    for (const removed of ["Vertical Reporting Category", "<th>Assignees</th>", "<th>Due</th>", "<th>Planned</th>", "<th>Last updated</th>"]) expect(page).not.toContain(removed);
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain("projects-loading-table");
    expect(loading).toContain("Development percentile");
    expect(page).toContain("projectTableVerticalLabel(vertical, project.vertical_state)");
    expect(data).toContain('from("wrike_task_normalized_custom_field_values")');
    expect(data).toContain('eq("normalized_field.normalized_key", "vertical")');
  });

  it("renders an accessible compact percentile ring and an honest empty state", () => {
    const ring = renderToStaticMarkup(<ProjectPercentileRing benchmark={{ lengthMinutes: 90, targetMinutes: 120, cohortAverageMinutes: 100, cohortSize: 10, percentile: 62 }} />);
    expect(ring).toContain('role="meter"');
    expect(ring).toContain('aria-valuenow="62"');
    expect(ring).toContain("62nd");
    expect(ring).toContain("among 10 visible courses");
    const empty = renderToStaticMarkup(<ProjectPercentileRing benchmark={null} />);
    expect(empty).not.toContain("aria-valuenow");
    expect(empty).toContain("Not enough comparable data");
  });

  it("loads percentiles for 100 displayed projects with one batch RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ task_id: "T1", length_minutes: 90, target_minutes: 120, cohort_average_minutes: 100, cohort_size: 5, lower_count: 3, tie_count: 1 }], error: null });
    const ids = Array.from({ length: 100 }, (_, index) => `T${index + 1}`);
    const result = await loadProjectLengthPercentiles({ rpc } as never, ids);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("reporting_project_length_percentiles", { target_task_ids: ids });
    expect(result.get("T1")?.percentile).toBe(70);
  });

  it("caps a large percentile request at the supported 200 task IDs", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const ids = Array.from({ length: 225 }, (_, index) => `T${index + 1}`);
    await loadProjectLengthPercentiles({ rpc } as never, ids);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("reporting_project_length_percentiles", { target_task_ids: ids.slice(0, 200) });
  });

  it("keeps Projects available when the optional percentile migration is missing", async () => {
    const databaseError = { code: "PGRST202", message: "Could not find reporting_project_length_percentiles in the schema cache" };
    const result = await loadProjectLengthPercentilesResult({ rpc: vi.fn().mockResolvedValue({ data: null, error: databaseError }) } as never, ["T1"]);
    expect(result.data.size).toBe(0);
    expect(result.error).toEqual(databaseError);
    const failure = reportingFailure(result.error, "Development percentile query", "202607210005_projects_percentile_performance.sql");
    const markup = renderToStaticMarkup(<ProjectsLoadFailure failure={failure} isAdmin nonfatal />);
    expect(markup).toContain("requires a database migration");
    expect(markup).toContain("202607210005_projects_percentile_performance.sql");
    expect(markup).toContain("Project rows remain available");
    expect(markup).toContain("PGRST202");
  });

  it("uses route-aware Projects errors instead of the Dashboard error copy", () => {
    const projectsError = fs.readFileSync(path.join(process.cwd(), "app/projects/error.tsx"), "utf8");
    const globalError = fs.readFileSync(path.join(process.cwd(), "app/error.tsx"), "utf8");
    expect(projectsError).toContain("PROJECTS ERROR");
    expect(projectsError).toContain("Diagnostic code");
    expect(projectsError).not.toContain("Dashboard data could not be loaded");
    expect(globalError).toContain("APPLICATION ERROR");
    expect(globalError).not.toContain("DASHBOARD ERROR");
  });
});
