import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ProjectsFilters } from "@/components/projects-filters";
import { filtersToQuery, parseProjectReportingFilters } from "@/lib/reporting/filters";
import { loadCustomFieldOptions } from "@/lib/reporting/options";
import { projectFilterFields, projectFilterHref } from "@/lib/reporting/projects";
import { customFieldDisplayValues, mergeNormalizedCustomFields, normalizeWrikeCustomFieldTitle } from "@/lib/wrike/custom-field-normalization";

const COURSE_TYPE_ID = "00000000-0000-0000-0000-000000000044";
const TOOL_ID = "00000000-0000-0000-0000-000000000045";
const statuses = [{ id: "S1", name: "In Review", color: null, resolved: true }];
const facets = { customStatusIds: new Set(["S1"]), baseStatuses: new Set<string>(), verticalStates: new Set<string>() };

const sourceField = (id: string, title: string, value: unknown) => ({ id, title, type: "DropDown", rawValue: value, displayValue: value, resolved: true });

describe("Course Type synchronization and filtering", () => {
  it("recognizes only the reviewed exact Course Type names", () => {
    expect(normalizeWrikeCustomFieldTitle("Course Type")).toMatchObject({ normalizedTitle: "Course Type", normalizedKey: "course type" });
    expect(normalizeWrikeCustomFieldTitle("Course Development Type")).toMatchObject({ normalizedTitle: "Course Type", normalizedKey: "course type" });
    expect(normalizeWrikeCustomFieldTitle("Course Type Notes")).toMatchObject({ normalizedTitle: "Course Type Notes", normalizedKey: "course type notes" });
    expect(projectFilterFields([{ id: "X", name: "Preferred Course Type Notes", values: ["Single Video"] }]).courseType).toBeNull();
  });

  it("preserves Single Video, arbitrary values, multiple values, and raw source evidence", () => {
    const [courseType] = mergeNormalizedCustomFields([
      sourceField("CF-COURSE", "Course Type", [" Single Video ", "Single Video", "Interactive Scenario"]),
      sourceField("CF-LEGACY", "Course Development Type", "single video")
    ]);
    expect(courseType.displayValues).toEqual(["Single Video", "Interactive Scenario"]);
    expect(courseType.sourceFieldIds).toEqual(["CF-COURSE", "CF-LEGACY"]);
    expect(courseType.sourceTitles).toEqual(["Course Type", "Course Development Type"]);
    expect(courseType.sources[0].rawValue).toEqual([" Single Video ", "Single Video", "Interactive Scenario"]);
    expect(courseType.conflict).toBe(true);
    expect(customFieldDisplayValues("  Future Course Format  ")).toEqual(["Future Course Format"]);
  });

  it("builds distinct choices only from observed accessible-task rows", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [
      { normalized_field_id: COURSE_TYPE_ID, normalized_title: "Course Type", value: "Single Video" },
      { normalized_field_id: COURSE_TYPE_ID, normalized_title: "Course Type", value: "Interactive Scenario" },
      { normalized_field_id: COURSE_TYPE_ID, normalized_title: "Course Type", value: "Single Video" }
    ], error: null });
    expect(await loadCustomFieldOptions({ rpc } as never)).toEqual([{ id: COURSE_TYPE_ID, name: "Course Type", values: ["Interactive Scenario", "Single Video"] }]);
    expect(JSON.stringify(await loadCustomFieldOptions({ rpc } as never))).not.toContain("Definition-only option");
  });

  it("retains a Course Type definition with no observed choices so stale selections remain removable", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ normalized_field_id: COURSE_TYPE_ID, normalized_title: "Course Type", value: null }], error: null });
    expect(await loadCustomFieldOptions({ rpc } as never)).toEqual([{ id: COURSE_TYPE_ID, name: "Course Type", values: [] }]);
  });

  it("preserves multiselect OR values and ANDs Course Type with other filters across navigation", () => {
    const filters = parseProjectReportingFilters({
      statuses: ["S1"], reportingYears: ["2026"], sort: "title", page: "3",
      [`cf_${COURSE_TYPE_ID}`]: ["Single Video", "Interactive Scenario"],
      [`cf_${TOOL_ID}`]: "Rise"
    });
    const query = new URLSearchParams(filtersToQuery(filters));
    expect(query.getAll(`cf_${COURSE_TYPE_ID}`)).toEqual(["Single Video", "Interactive Scenario"]);
    expect(query.get(`cf_${TOOL_ID}`)).toBe("Rise");
    expect(query.get("statuses")).toBe("S1");
    expect(query.get("reportingYears")).toBe("2026");
    const sorted = new URL(projectFilterHref(filters, { sort: "status", sortDirection: "asc", page: 1 }, "/development"), "https://devtrack.test");
    expect(sorted.searchParams.getAll(`cf_${COURSE_TYPE_ID}`)).toEqual(["Single Video", "Interactive Scenario"]);
    expect(sorted.searchParams.get(`cf_${TOOL_ID}`)).toBe("Rise");
    expect(sorted.searchParams.get("returnTo")).toBe("/development");
  });

  it("renders observed and stale Course Type values with removable active chips", () => {
    const customFields = [
      { id: COURSE_TYPE_ID, name: "Course Type", values: ["Single Video"] },
      { id: TOOL_ID, name: "Authoring Tool", values: ["Rise"] }
    ];
    const filters = parseProjectReportingFilters({ [`cf_${COURSE_TYPE_ID}`]: ["Single Video", "Retired Format"], [`cf_${TOOL_ID}`]: "Rise" });
    const markup = renderToStaticMarkup(<ProjectsFilters filters={filters} statuses={statuses} customFields={customFields} people={[]} facets={facets} />);
    expect(markup).toContain('value="Single Video"');
    expect(markup).toContain('value="Retired Format"');
    expect(markup).toContain("Course Type: Single Video");
    expect(markup).toContain("Course Type: Retired Format");
    expect(markup).toContain("Tool: Rise");
  });

  it("keeps access-scoped observed options and generic OR/AND matching in the migration", () => {
    const migration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202607220004_course_type_filtering.sql"), "utf8");
    const rows = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202607220003_sortable_project_tables.sql"), "utf8");
    const importer = fs.readFileSync(path.join(process.cwd(), "lib/wrike/folder-task-import.ts"), "utf8");
    const persistence = fs.readFileSync(path.join(process.cwd(), "lib/wrike/custom-field-persistence.ts"), "utf8");
    expect(migration).toContain("field.normalized_key='course type'");
    expect(migration).toContain("join visible_tasks task on task.id=task_value.task_id");
    expect(migration).toContain("jsonb_each(requested)");
    expect(migration).toContain("selected.value=any(field_value.display_values)");
    expect(migration).not.toContain("allowed_values");
    expect(migration).not.toContain("settings->");
    expect(rows).toMatch(/jsonb_object_agg[\s\S]*value\.display_values/);
    expect(importer).toContain("raw_data: task");
    expect(persistence).toContain("source_wrike_field_ids: field.sourceFieldIds");
    expect(persistence).toContain("source_values: field.sources");
  });
});
