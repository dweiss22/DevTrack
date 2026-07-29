import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProjectTimeline } from "@/components/project-timeline";
import {
  buildProjectTimeline,
  normalizeProjectDate,
  projectTimelineInputFromNormalizedFields,
} from "@/lib/projects/timeline";
import type { NormalizedCustomFieldValue } from "@/lib/wrike/custom-field-normalization";

const normalizedField = (normalizedKey: string, displayValues: string[], conflict = false): NormalizedCustomFieldValue => ({
  normalizedKey,
  normalizedTitle: normalizedKey,
  displayValues,
  sourceFieldIds: ["field-1"],
  sourceTitles: [normalizedKey],
  sources: [],
  conflict,
  conflictMetadata: null,
});

describe("shared project timeline", () => {
  it("uses strict, timezone-safe date-only normalization", () => {
    expect(normalizeProjectDate("2026-07-04")).toBe("2026-07-04");
    expect(normalizeProjectDate("2026-07-04T23:30:00-05:00")).toBe("2026-07-04");
    expect(normalizeProjectDate("7/4/2026")).toBe("2026-07-04");
    expect(normalizeProjectDate("2026-02-30")).toBeNull();
    expect(normalizeProjectDate("not a date")).toBeNull();
  });

  it("deduplicates equal due and publication dates with clear labels", () => {
    const milestones = buildProjectTimeline({
      startDate: "2026-01-10",
      originalDueDate: "2026-03-01",
      currentDueDate: "2026-03-01",
      projectEndDate: "2026-03-15",
      publishedDate: "2026-04-01",
      lmsPublicationDate: "2026-04-01",
    });
    expect(milestones.map((item) => item.label)).toEqual([
      "Start", "Due Date", "Project End Date", "Publication Date",
    ]);
    expect(milestones.map((item) => item.date)).toEqual([...milestones.map((item) => item.date)].sort());
    expect(milestones[0].position).toBe(0);
    expect(milestones.at(-1)?.position).toBe(100);
  });

  it("keeps different original/current due and publication milestones separate", () => {
    const labels = buildProjectTimeline({
      originalDueDate: "2026-03-01",
      currentDueDate: "2026-03-20",
      publishedDate: "2026-04-01",
      lmsPublicationDate: "2026-04-05",
    }).map((item) => item.label);
    expect(labels).toEqual(["Original Due", "Current Due", "Published Date", "LMS Publication Date"]);
  });

  it("omits missing, invalid, and conflicting custom-field dates", () => {
    const input = projectTimelineInputFromNormalizedFields({
      startDate: null,
      originalDueDate: "invalid",
      currentDueDate: null,
    }, [
      normalizedField("project end date", ["2026-05-10"]),
      normalizedField("published date", ["2026-06-01", "2026-06-02"], true),
      normalizedField("lms publication date", []),
    ]);
    expect(buildProjectTimeline(input).map((item) => item.label)).toEqual(["Project End Date"]);
  });

  it("renders semantic time elements, explicit type labels, and no empty timeline", () => {
    const html = renderToStaticMarkup(<ProjectTimeline headingId="timeline-test" input={{
      startDate: "2026-01-01",
      projectEndDate: "2026-02-01",
      publishedDate: "2026-02-15",
    }} />);
    expect(html).toContain('dateTime="2026-01-01"');
    expect(html).toContain("Planned");
    expect(html).toContain("Project completion");
    expect(html).toContain("Publication");
    expect(renderToStaticMarkup(<ProjectTimeline headingId="empty" input={{}} />)).toBe("");
  });

  it("uses the shared component in both project detail experiences", () => {
    const root = process.cwd();
    const sme = fs.readFileSync(path.join(root, "components/sme-project-detail.tsx"), "utf8");
    const general = fs.readFileSync(path.join(root, "app/projects/[id]/page.tsx"), "utf8");
    expect(sme).toContain("<ProjectTimeline");
    expect(general).toContain("<ProjectTimeline");
    expect(sme).not.toContain("completedAt");
  });
});
