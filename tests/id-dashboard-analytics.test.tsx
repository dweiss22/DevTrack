import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  categoryTrend,
  CategoryTimeTooltip,
  DevelopmentTimeTooltip,
  IdDashboardAnalyticsSection,
} from "@/components/id-dashboard-analytics";
import {
  categoryPeriodForYear,
  loadIdDashboardAnalytics,
  normalizeIdDashboardAnalytics,
  type IdDashboardAnalytics,
} from "@/lib/dashboards/id-analytics";
import {
  compactWorkflowCategoryLabel,
  UNCATEGORIZED_WORKFLOW_COLOR,
  workflowCategoryColor,
  WORKFLOW_CATEGORY_PALETTE,
} from "@/lib/reporting/workflow-category-colors";

const root = process.cwd();
const source = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const migration = source("supabase/migrations/202608250001_id_dashboard_org_trend_lines.sql");
const currentYear = new Date().getFullYear();

const analytics: IdDashboardAnalytics = {
  timeDataSynchronized: true,
  developmentTimeByYear: [
    { year: 2023, projectCount: 2, averageMinutes: 180, totalMinutes: 360 },
    { year: 2024, projectCount: 1, averageMinutes: 0, totalMinutes: 0 },
    { year: currentYear, projectCount: 1, averageMinutes: 300, totalMinutes: 300 },
  ],
  categoryTime: {
    denominatorDefinition: "Distinct ID-assigned projects on which the selected ID logged time in the selected period.",
    allTime: {
      year: null, qualifyingProjectCount: 2, totalMinutes: 300, entryCount: 3,
      categories: [
        { name: "Development", averageMinutes: 120, totalMinutes: 240, percentage: 80 },
        { name: "Uncategorized", averageMinutes: 30, totalMinutes: 60, percentage: 20 },
      ],
    },
    years: [
      {
        year: 2024, qualifyingProjectCount: 1, totalMinutes: 60, entryCount: 1,
        categories: [{ name: "Uncategorized", averageMinutes: 60, totalMinutes: 60, percentage: 100 }],
      },
      {
        year: currentYear, qualifyingProjectCount: 1, totalMinutes: 240, entryCount: 2,
        categories: [{ name: "Development", averageMinutes: 240, totalMinutes: 240, percentage: 100 }],
      },
    ],
  },
  otherIdentitiesByYear: [
    { wrikeUserId: "other-1", displayName: "Other ID", points: [{ year: 2023, averageMinutes: 90 }, { year: currentYear, averageMinutes: 150 }] },
  ],
  yAxisMaxMinutes: 300,
  currentYearProgress: { year: currentYear, startMinutes: 120, currentAverageMinutes: 300, asOfDate: "2026-01-15" },
};

describe("ID Dashboard analytics", () => {
  it("groups projects and time-entry periods by course reporting year instead of calendar dates", () => {
    expect(migration).toContain("value.reporting_year");
    expect(migration).toContain("field.normalized_key in ('reporting','reporting year')");
    expect(migration).toContain("project.reporting_year");
    expect(migration).toContain("entry.reporting_year::text");
    expect(migration).not.toContain("extract(year from task.completed_at)");
    expect(migration).not.toContain("extract(year from entry.entry_date)");
  });

  it("divides the selected ID's total minutes by distinct qualifying projects and preserves zero averages", () => {
    expect(migration).toContain("development_minutes_by_project");
    expect(migration).toContain("sum(project.total_minutes)::numeric/");
    expect(migration).toContain("count(distinct project.task_id)");
    expect(migration).toContain("coalesce(sum(entry.minutes)");
    expect(migration).toContain("entry.user_id=selected_identity.id");
    expect(analytics.developmentTimeByYear[1]).toEqual({
      year: 2024, projectCount: 1, averageMinutes: 0, totalMinutes: 0,
    });
  });

  it("uses a common distinct-project denominator for all-time and reporting-year category periods", () => {
    expect(migration).toContain("count(distinct entry.task_id)");
    expect(migration).toContain("category.total_minutes::numeric/");
    expect(migration).toContain("period.qualifying_project_count");
    expect(migration).toContain("'all'::text period_key");
    expect(migration).toContain("entry.reporting_year::text");
    expect(categoryPeriodForYear(analytics, "all").qualifyingProjectCount).toBe(2);
    expect(categoryPeriodForYear(analytics, currentYear).categories[0].averageMinutes).toBe(240);
  });

  it("returns only reporting years with qualifying entries, keeps uncategorized time, and removes empty categories", () => {
    expect(analytics.categoryTime.years.map((period) => period.year)).toEqual([2024, currentYear]);
    expect(categoryPeriodForYear(analytics, 2024).categories[0].name).toBe("Uncategorized");
    expect(migration).toContain("then 'Uncategorized'");
    expect(migration).toContain("category.id is null or category.is_unresolved");
    expect(migration).toContain("having sum(entry.minutes)>0");
    const normalized = normalizeIdDashboardAnalytics({
      timeDataSynchronized: true,
      categoryTime: {
        allTime: { categories: [
          { name: "Empty", totalMinutes: 0, averageMinutes: 0, percentage: 0 },
          { name: "Development", totalMinutes: 60, averageMinutes: 60, percentage: 100 },
        ] },
        years: [],
      },
    });
    expect(normalized.categoryTime.allTime.categories.map((category) => category.name)).toEqual(["Development"]);
  });

  it("scopes the RPC to the selected identity, assigned tasks, organization, and authorized roles", () => {
    expect(migration).toContain("public.current_effective_user_id()");
    expect(migration).toContain("public.current_has_management_role('admin')");
    expect(migration).toContain("public.current_has_management_role('super_admin')");
    expect(migration).toContain("target_wrike_user_id:=public.current_operational_identity('id')");
    expect(migration).toContain("course_development_person_assignments_with_personas");
    expect(migration).toContain("task.organization_id=viewer.organization_id");
    expect(migration).toContain("entry.organization_id=viewer.organization_id");
    expect(migration).toContain("identity.organization_id=viewer.organization_id");
  });

  it("loads both aggregates in one RPC without raw browser-side time-entry queries", async () => {
    const calls: { name: string; args: unknown }[] = [];
    const supabase = {
      rpc: async (name: string, args: unknown) => {
        calls.push({ name, args });
        return { data: analytics, error: null };
      },
    };
    const result = await loadIdDashboardAnalytics(supabase as never, "wrike-user");
    expect(result.error).toBeNull();
    expect(calls).toEqual([{
      name: "reporting_id_dashboard_analytics",
      args: { target_wrike_user_id: "wrike-user" },
    }]);
    expect(source("components/id-dashboard-analytics.tsx")).not.toContain('.from("wrike_time_entries")');
  });

  it("renders consistent chart definitions, reporting-year choices, zero values, and accessible data", () => {
    const html = renderToStaticMarkup(<IdDashboardAnalyticsSection analytics={analytics} />);
    expect(html).toContain("Average Development Time by Course Reporting Year");
    expect(html).toContain("Time by Workflow Category");
    expect(html).toContain("Average hours per project");
    expect(html).toContain("Course reporting year");
    expect(html).toContain("All time");
    expect(html).toContain("2024");
    expect(html).toContain("0.0");
    expect(html).toContain("Development");
    expect(html).toContain("Workflow category legend");
    expect(html).toContain("View accessible data");
  });

  it("formats both custom tooltips with exact hours and percentages", () => {
    const development = renderToStaticMarkup(<DevelopmentTimeTooltip active payload={[{
      payload: analytics.developmentTimeByYear[0],
    }]} />);
    expect(development).toContain("Course reporting year 2023");
    expect(development).toContain("3.0 hours per project");
    const category = renderToStaticMarkup(<CategoryTimeTooltip active payload={[{
      payload: analytics.categoryTime.allTime.categories[0],
    }]} />);
    expect(category).toContain("Development");
    expect(category).toContain("Hours: 4.0");
    expect(category).toContain("Percentage: 80.0%");
  });

  it("uses one stable workflow-category color mapping and compact legend labels everywhere", () => {
    expect(workflowCategoryColor("Development")).toBe(workflowCategoryColor(" development "));
    expect(WORKFLOW_CATEGORY_PALETTE).toContain(workflowCategoryColor("Development") as never);
    expect(workflowCategoryColor("Uncategorized")).toBe(UNCATEGORIZED_WORKFLOW_COLOR);
    expect(compactWorkflowCategoryLabel("A workflow category with an unusually long display name", 20)).toBe("A workflow category…");
    for (const component of [
      "components/id-dashboard-analytics.tsx",
      "components/project-time-analytics.tsx",
      "components/sme-project-category-chart.tsx",
    ]) expect(source(component)).toContain("workflowCategoryColor");
  });

  it("keeps the legend beside wide charts, below narrow charts, and allows vertical growth", () => {
    const css = source("app/globals.css");
    expect(css).toContain(".id-dashboard-chart { display: flex;");
    expect(css).toContain("overflow: visible");
    expect(css).toContain("@container (min-width: 500px)");
    expect(css).toContain(".id-category-visual { grid-template-columns:");
    expect(css).toContain(".id-category-legend span { overflow: hidden;");
    expect(source("components/id-dashboard-analytics.tsx")).not.toContain("<Legend");
  });

  it("renders concise empty and independent analytics-error states", () => {
    const empty = normalizeIdDashboardAnalytics({
      timeDataSynchronized: true,
      developmentTimeByYear: [],
      categoryTime: { allTime: {}, years: [] },
    });
    const html = renderToStaticMarkup(<IdDashboardAnalyticsSection analytics={empty} />);
    expect(html).toContain("No assigned projects with a course reporting year are available for this ID.");
    expect(html).toContain("No qualifying time entries are available for this ID.");

    const error = renderToStaticMarkup(<IdDashboardAnalyticsSection analytics={null} error="Analytics failed." />);
    expect(error).toContain("ID analytics unavailable");
    expect(error).toContain("Assigned-project details remain available below.");
  });

  it("returns org-wide context for faded other-ID lines, a shared Y-axis max, and current-year progress", () => {
    expect(migration).toContain("otherIdentitiesByYear");
    expect(migration).toContain("yAxisMaxMinutes");
    expect(migration).toContain("currentYearProgress");
    expect(migration).toContain("identity.id<>selected_identity.id");
    expect(migration).toContain("org_assigned_tasks");

    const normalized = normalizeIdDashboardAnalytics({
      timeDataSynchronized: true,
      developmentTimeByYear: [],
      categoryTime: { allTime: {}, years: [] },
      otherIdentitiesByYear: [
        { wrikeUserId: "abc", displayName: "Someone Else", points: [{ year: 2024, averageMinutes: 90 }] },
      ],
      yAxisMaxMinutes: 480,
      currentYearProgress: { year: currentYear, startMinutes: 60, currentAverageMinutes: 150, asOfDate: "2026-02-01" },
    });
    expect(normalized.otherIdentitiesByYear).toEqual([
      { wrikeUserId: "abc", displayName: "Someone Else", points: [{ year: 2024, averageMinutes: 90 }] },
    ]);
    expect(normalized.yAxisMaxMinutes).toBe(480);
    expect(normalized.currentYearProgress).toEqual({
      year: currentYear, startMinutes: 60, currentAverageMinutes: 150, asOfDate: "2026-02-01",
    });

    const empty = normalizeIdDashboardAnalytics({ timeDataSynchronized: false });
    expect(empty.otherIdentitiesByYear).toEqual([]);
    expect(empty.yAxisMaxMinutes).toBeNull();
    expect(empty.currentYearProgress).toBeNull();
  });

  it("defaults the workflow-category donut to the current reporting year and shows the current-year progress note", () => {
    const html = renderToStaticMarkup(<IdDashboardAnalyticsSection analytics={analytics} />);
    expect(html).toContain(`Donut chart of time by workflow category for ${currentYear}`);
    expect(html).toContain("is still in progress");
    expect(html).toContain("started at 2.0h");
    expect(html).toContain("now averaging 5.0h");
  });

  it("shows a legend trend arrow only against a completed prior year, never for all-time or the current year", () => {
    expect(categoryTrend(
      { name: "Development", averageMinutes: 240, totalMinutes: 300, percentage: 100 },
      { year: 2024, qualifyingProjectCount: 1, totalMinutes: 200, entryCount: 1, categories: [
        { name: "Development", averageMinutes: 200, totalMinutes: 200, percentage: 100 },
      ] },
      2025,
    )).toEqual({ direction: "up", priorMinutes: 200 });
    expect(categoryTrend(
      { name: "Development", averageMinutes: 240, totalMinutes: 300, percentage: 100 }, null, "all",
    )).toBeNull();
    expect(categoryTrend(
      { name: "Development", averageMinutes: 240, totalMinutes: 300, percentage: 100 }, null, currentYear,
    )).toBeNull();
  });

  it("keeps Super Admin persona selection wired to the same selected-ID analytics RPC", () => {
    const page = source("app/id-dashboard/page.tsx");
    expect(page).toContain('profile.role === "super_admin" ? supabase.rpc("superadmin_id_persona")');
    expect(page).toContain("requested ?? persona?.wrike_user_id");
    expect(page).toContain("loadIdDashboardAnalytics(supabase, selected.wrike_user_id)");
    expect(page).toContain('profile.role === "id"');
    expect(page).toContain('profile.role === "super_admin"');
  });
});
