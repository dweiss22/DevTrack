import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProjectPercentileGauge } from "@/components/project-percentile-gauge";
import { StatusBadge } from "@/components/wrike-reference";
import {
  formatCourseLength,
  formatOrdinal,
  formatVerticalMembership,
  parseCourseLengthMinutes,
  percentileRank,
  projectLengthBenchmark
} from "@/lib/reporting/project-overview";
import { projectContactValues, projectFieldRole, projectOverviewContactValues, projectOverviewFieldKeys } from "@/lib/reporting/projects";
import { normalizeWrikeCustomFieldTitle } from "@/lib/wrike/custom-field-normalization";
import { resolveResponsibleUsers } from "@/lib/wrike/reference-data";

describe("project Overview metadata", () => {
  it("normalizes supported course-length representations without guessing integers", () => {
    for (const value of ["1.5 hours", "1.5", "01:30", "1 hour 30 minutes", "90 minutes", "90 min"]) expect(parseCourseLengthMinutes(value)).toBe(90);
    expect(parseCourseLengthMinutes(["1.5 hours", "90 minutes"])).toBe(90);
    expect(parseCourseLengthMinutes("60")).toBeNull();
    expect(parseCourseLengthMinutes("1,5 hours")).toBeNull();
    expect(parseCourseLengthMinutes(["60 minutes", "2 hours"])).toBeNull();
    expect(formatCourseLength(60)).toBe("01:00 hours");
    expect(formatCourseLength(90)).toBe("01:30 hours");
  });

  it("uses a midrank percentile for ties and requires five same-length courses", () => {
    expect(percentileRank(90, [60, 60, 90, 120, 150])).toBe(50);
    expect(percentileRank(90, [60, 90, 90, 90, 120])).toBe(50);
    expect(percentileRank(90, [90])).toBeNull();
    expect(percentileRank(null, [60, 90, 120, 150, 180])).toBeNull();
    expect(formatOrdinal(62)).toBe("62nd");
    expect(formatOrdinal(11)).toBe("11th");
  });

  it("converts the scoped aggregate counts into a display benchmark", () => {
    expect(projectLengthBenchmark({ length_minutes: 90, target_minutes: 120, cohort_average_minutes: "100.5", cohort_size: 5, lower_count: 3, tie_count: 1 })).toEqual({
      lengthMinutes: 90, targetMinutes: 120, cohortAverageMinutes: 100.5, cohortSize: 5, percentile: 70
    });
    expect(projectLengthBenchmark(null)).toBeNull();
  });

  it("renders an accessible neutral gauge and a restrained insufficient-data state", () => {
    const gauge = renderToStaticMarkup(<ProjectPercentileGauge benchmark={{ lengthMinutes: 90, targetMinutes: 2070, cohortAverageMinutes: 1752, cohortSize: 10, percentile: 62 }} />);
    expect(gauge).toContain('role="meter"');
    expect(gauge).toContain('aria-label="Logged-time percentile"');
    expect(gauge).toContain('aria-valuenow="62"');
    expect(gauge).toContain("62nd percentile");
    expect(gauge).toContain("34.5 h logged");
    expect(gauge).toContain("29.2 h cohort average");
    const empty = renderToStaticMarkup(<ProjectPercentileGauge benchmark={null} />);
    expect(empty).toContain('role="meter"');
    expect(empty).not.toContain("aria-valuenow");
    expect(empty).toContain("Not enough comparable data.");
  });

  it("preserves status color and resolves custom-field and Wrike people independently", () => {
    const status = renderToStaticMarkup(<StatusBadge name="In Review" id="S1" color="#123456" />);
    expect(status).toContain("In Review");
    expect(status).toContain("#123456");
    const people = [{ wrikeId: "KU1", name: "Alex Smith", resolved: true }];
    expect(projectContactValues(["KU1", "MISSING"], people)).toEqual([
      { id: "KU1", label: "Alex Smith", resolved: true },
      { id: "MISSING", label: "Unresolved Wrike user MISSING", resolved: false }
    ]);
    expect(resolveResponsibleUsers(["KU1", "MISSING"], [{ wrike_id: "KU1", display_name: "Alex Smith", email: null, avatar_url: null, synced_at: "2026-07-21T00:00:00Z" }]).map((person) => [person.fullName, person.resolved])).toEqual([["Alex Smith", true], ["MISSING", false]]);
  });

  it("shows Wrike-provided Overview contact names while retaining unresolved identity markers", () => {
    expect(normalizeWrikeCustomFieldTitle("[LCT] ID Assigned (M)")).toMatchObject({ normalizedTitle: "ID Assigned", normalizedKey: "id assigned" });
    expect(projectFieldRole("id assigned")).toBe("owner");
    const people = [
      { wrikeId: "KU1", name: "Alex Smith", resolved: true },
      { wrikeId: "KU2", name: "Unresolved person", resolved: false }
    ];
    expect(projectOverviewContactValues(["Katie Willis", "KU1", "KU2", "KUMISSING"], people)).toEqual([
      { id: "Katie Willis", label: "Katie Willis", resolved: false, referenceId: null },
      { id: "KU1", label: "Alex Smith", resolved: true, referenceId: null },
      { id: "KU2", label: "Unresolved person", resolved: false, referenceId: "KU2" },
      { id: "KUMISSING", label: "Unresolved user", resolved: false, referenceId: "KUMISSING" }
    ]);
    expect(projectOverviewContactValues(["alex smith"], people)[0]).toMatchObject({ label: "Alex Smith", resolved: true });
    expect(projectOverviewContactValues(["Christopher Baldini"], [])[0]).toEqual({ id: "Christopher Baldini", label: "Christopher Baldini", resolved: false, referenceId: null });
  });

  it("uses canonical Vertical membership and an exact Legal Reviewer role", () => {
    expect(formatVerticalMembership(["P1A"])).toBe("P1A");
    expect(formatVerticalMembership(["P1A", "EMS1", "P1A"])).toBe("P1A, EMS1");
    expect(projectFieldRole("Legal Reviewer")).toBe("legalReviewer");
    expect(projectFieldRole("Legal Review Status")).toBeNull();
  });

  it("excludes only displayed custom fields and keeps Course Type in Other synchronized fields", () => {
    const fields = ["reporting", "id assigned", "vertical", "course length", "authoring tool", "sme", "legal reviewer", "course type"].map((normalizedKey) => ({ normalizedKey }));
    const featured = projectOverviewFieldKeys(fields);
    expect(featured.has("course type")).toBe(false);
    for (const key of fields.slice(0, 7).map((field) => field.normalizedKey)) expect(featured.has(key)).toBe(true);
  });

  it("keeps the exact Overview order and removes deprecated Overview labels", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "app/projects/[id]/page.tsx"), "utf8");
    const labels = ["Status", "Percentile", "Reporting year", "ID Assigned", "Vertical", "Length", "Assigned in Wrike", "Authoring Tool", "SME", "Legal Reviewer"];
    const positions = labels.map((label) => source.indexOf(`label=\"${label}\"`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    for (const removed of ["Course type", "Vertical reporting category", "Planned effort", "Allocated effort", "Assigned users", "Owner / Instructional Designer"]) expect(source).not.toContain(`label=\"${removed}\"`);
    expect(source).not.toContain("fieldByRole.get(\"courseType\")");
    expect(source).toContain('<MetadataItem label="SME">{contactFieldValue(fieldByRole.get("sme"), people)}</MetadataItem>');
  });

  it("unifies time metrics with Overview and collapses secondary project data", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "app/projects/[id]/page.tsx"), "utf8");
    const styles = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
    const charts = fs.readFileSync(path.join(process.cwd(), "components/project-time-analytics.tsx"), "utf8");
    expect(source.indexOf("project-time-metrics")).toBeGreaterThan(source.indexOf('label="Legal Reviewer"'));
    expect(source.indexOf("project-time-metrics")).toBeLessThan(source.indexOf("project-additional-data"));
    expect(source).toContain('<details className="card project-additional-data">');
    expect(source).not.toContain('<details className="card project-additional-data" open>');
    expect(source).toContain("Project dates, Wrike folders, and other synchronized fields");
    expect(source).toContain("{row.due_date && <>");
    expect(styles).toContain(".project-time-metrics { display: grid; grid-template-columns: repeat(4,minmax(0,1fr))");
    expect(styles).toContain(".project-chart-card-wide { grid-column: 1 / -1; }");
    expect(charts).toContain('className="project-chart-card-wide"');
  });
});
