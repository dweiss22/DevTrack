import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IdDashboardAnalyticsSection } from "@/components/id-dashboard-analytics";
import {
  categoryPeriodForYear,
  loadIdDashboardAnalytics,
  normalizeIdDashboardAnalytics,
  type IdDashboardAnalytics,
} from "@/lib/dashboards/id-analytics";

const root = process.cwd();
const source = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const migration = source("supabase/migrations/202607270002_id_dashboard_analytics.sql");

const analytics: IdDashboardAnalytics = {
  timeDataSynchronized: true,
  developmentTimeByYear: [
    { year: 2023, projectCount: 2, averageMinutes: 180, totalMinutes: 360 },
    { year: 2024, projectCount: 0, averageMinutes: null, totalMinutes: null },
    { year: 2025, projectCount: 1, averageMinutes: 300, totalMinutes: 300 },
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
        year: 2025, qualifyingProjectCount: 1, totalMinutes: 240, entryCount: 2,
        categories: [{ name: "Development", averageMinutes: 240, totalMinutes: 240, percentage: 100 }],
      },
    ],
  },
};

describe("ID Dashboard analytics", () => {
  it("builds the annual series from the first qualifying assigned-project year through the current year", () => {
    expect(migration).toContain("first_assignment_year");
    expect(migration).toContain("generate_series(");
    expect(migration).toContain("first_year.first_year,current_year");
    expect(migration).toContain("extract(year from task.completed_at)");
    expect(migration).toContain("status.dashboard_classification='completed'");
  });

  it("averages one total logged-time value per completed assigned project and preserves empty years", () => {
    expect(migration).toContain("development_minutes_by_project");
    expect(migration).toContain("group by project.task_id,project.completion_year");
    expect(migration).toContain("round(avg(project.total_minutes)::numeric,2)");
    expect(migration).toContain("when count(project.task_id)=0 then null");
    expect(analytics.developmentTimeByYear[1]).toEqual({
      year: 2024, projectCount: 0, averageMinutes: null, totalMinutes: null,
    });
  });

  it("uses a common distinct-project denominator for all-time and year category averages", () => {
    expect(migration).toContain("count(distinct entry.task_id)");
    expect(migration).toContain("category.total_minutes::numeric/");
    expect(migration).toContain("period.qualifying_project_count");
    expect(migration).toContain("'all'::text period_key");
    expect(migration).toContain("extract(year from entry.entry_date)");
    expect(categoryPeriodForYear(analytics, "all").qualifyingProjectCount).toBe(2);
    expect(categoryPeriodForYear(analytics, 2025).categories[0].averageMinutes).toBe(240);
  });

  it("returns only years with qualifying entries to the category selector and keeps uncategorized time", () => {
    expect(analytics.categoryTime.years.map((period) => period.year)).toEqual([2024, 2025]);
    expect(categoryPeriodForYear(analytics, 2024).categories[0].name).toBe("Uncategorized");
    expect(migration).toContain("then 'Uncategorized'");
    expect(migration).toContain("category.id is null or category.is_unresolved");
  });

  it("scopes the RPC to the selected identity, assigned tasks, organization, and authorized roles", () => {
    expect(migration).toContain("public.current_effective_user_id()");
    expect(migration).toContain("viewer.role not in ('super_admin','admin')");
    expect(migration).toContain("target_wrike_user_id:=public.current_id_operational_identity()");
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

  it("renders chart definitions, accessible data, year choices, and honest gap values", () => {
    const html = renderToStaticMarkup(<IdDashboardAnalyticsSection analytics={analytics} />);
    expect(html).toContain("Average Development Time by Year");
    expect(html).toContain("Average Time by Time Entry Category");
    expect(html).toContain("All time");
    expect(html).toContain("2024");
    expect(html).toContain("No qualifying projects");
    expect(html).toContain("Uncategorized");
    expect(html).toContain("View accessible data");
  });

  it("renders concise empty and independent analytics-error states", () => {
    const empty = normalizeIdDashboardAnalytics({
      timeDataSynchronized: true,
      developmentTimeByYear: [],
      categoryTime: { allTime: {}, years: [] },
    });
    const html = renderToStaticMarkup(<IdDashboardAnalyticsSection analytics={empty} />);
    expect(html).toContain("No completed, dated projects are available for this ID.");
    expect(html).toContain("No qualifying time entries are available for this ID.");

    const error = renderToStaticMarkup(<IdDashboardAnalyticsSection analytics={null} error="Analytics failed." />);
    expect(error).toContain("ID analytics unavailable");
    expect(error).toContain("Assigned-project details remain available below.");
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
