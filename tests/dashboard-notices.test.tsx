import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DashboardNoticePin } from "@/components/dashboard-notices";
import {
  dashboardNoticesFromSources,
  dashboardOverviewNotices,
  dashboardTimeNotices,
  removeDashboardNoticeSource,
  replaceDashboardNoticeSource,
  type DashboardNoticeSources,
} from "@/lib/reporting/dashboard-notices";

describe("Dashboard notice pin", () => {
  const hrefs = { missing: "/projects?verticalState=missing", unrecognized: "/projects?verticalState=unrecognized", synchronization_incomplete: "/projects?verticalState=synchronization_incomplete" };

  it("creates no notices when all dashboard data is resolved", () => {
    expect(dashboardOverviewNotices({ unresolvedStatusProjects: 0, customFieldConflictProjects: 0, missingVerticalProjects: 0, unrecognizedVerticalProjects: 0, incompleteVerticalProjects: 0 }, hrefs)).toEqual([]);
    expect(dashboardTimeNotices(true)).toEqual([]);
  });

  it("uses singular wording for one affected project", () => {
    const notices = dashboardOverviewNotices({ unresolvedStatusProjects: 1, customFieldConflictProjects: 1, missingVerticalProjects: 1, unrecognizedVerticalProjects: 1, incompleteVerticalProjects: 1 }, hrefs);
    expect(notices.map((notice) => notice.message)).toEqual([
      "1 project has an unclassified or unresolved Wrike status.",
      "1 project has conflicting Dashboard custom-field sources.",
      "1 project has no Associated Vertical.",
      "1 project contains an unrecognized Associated Vertical value.",
      "1 project has unverified custom-field data; retained values may be from an earlier synchronization.",
    ]);
  });

  it("creates all nonfatal notices and retains the Vertical drill-down", () => {
    const notices = [
      ...dashboardOverviewNotices({ unresolvedStatusProjects: 2, customFieldConflictProjects: 3, missingVerticalProjects: 4, unrecognizedVerticalProjects: 5, incompleteVerticalProjects: 6 }, hrefs),
      ...dashboardTimeNotices(false),
    ];
    expect(notices.map((notice) => notice.id)).toEqual(["unresolved-statuses", "custom-field-conflicts", "missing-verticals", "unrecognized-verticals", "incomplete-vertical-sync", "time-data-not-synchronized"]);
    expect(notices.slice(2, 5).map((notice) => notice.href)).toEqual(Object.values(hrefs));
    expect(notices[2]).toMatchObject({ actionLabel: "Review affected projects" });
  });

  it("combines notice sources and removes only the unmounted source", () => {
    let sources: DashboardNoticeSources = {};
    sources = replaceDashboardNoticeSource(sources, "overview", dashboardOverviewNotices({ unresolvedStatusProjects: 2, customFieldConflictProjects: 0, missingVerticalProjects: 0, unrecognizedVerticalProjects: 0, incompleteVerticalProjects: 0 }, hrefs));
    sources = replaceDashboardNoticeSource(sources, "time", dashboardTimeNotices(false));
    expect(dashboardNoticesFromSources(sources).map((notice) => notice.id)).toEqual(["unresolved-statuses", "time-data-not-synchronized"]);

    sources = removeDashboardNoticeSource(sources, "overview");
    expect(dashboardNoticesFromSources(sources).map((notice) => notice.id)).toEqual(["time-data-not-synchronized"]);
  });

  it("hides an empty pin and exposes an accessible notice count", () => {
    expect(renderToStaticMarkup(<DashboardNoticePin notices={[]} />)).toBe("");
    const markup = renderToStaticMarkup(<DashboardNoticePin notices={dashboardTimeNotices(false)} />);
    expect(markup).toContain('aria-label="1 Dashboard notice"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("dashboard-notice-count");
  });

  it("keeps blocking query failures and chart empty states inline", () => {
    const page = readFileSync(join(process.cwd(), "app", "page.tsx"), "utf8");
    const charts = readFileSync(join(process.cwd(), "components", "dashboard-charts.tsx"), "utf8");
    expect(page).toContain("<DashboardQueryError error={result.error} />");
    expect(page).toContain('role="alert"');
    expect(charts).toContain('className="chart-empty"');
    expect(page).not.toContain('className="notice error"');
  });
});
