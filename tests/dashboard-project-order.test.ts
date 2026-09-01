import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  dashboardProjectRecency,
  sortDashboardProjectsNewestFirst,
  type DashboardProjectOrderRow,
} from "@/lib/dashboards/project-order";

const project = (
  task_id: string,
  title: string,
  values: Partial<DashboardProjectOrderRow> = {},
): DashboardProjectOrderRow => ({ task_id, title, ...values });

describe("dashboard project recency ordering", () => {
  it("sorts project rows from the newest meaningful project date to the oldest", () => {
    const rows = [
      project("old", "Older", { completed_at: "2024-03-01T18:00:00Z" }),
      project("future", "Upcoming", { due_date: "2026-10-15" }),
      project("published", "Published", { publication_date: "2026-06-01" }),
      project("current", "Current", { start_date: "2025-04-01", due_date: "2026-08-01" }),
    ];
    expect(sortDashboardProjectsNewestFirst(rows).map((row) => row.task_id))
      .toEqual(["future", "current", "published", "old"]);
    expect(rows.map((row) => row.task_id)).toEqual(["old", "future", "published", "current"]);
  });

  it("uses the latest available milestone, with reporting year and sync date only as fallbacks", () => {
    const withSeveralDates = project("multi", "Several dates", {
      start_date: "2025-01-01",
      completed_at: "2025-05-01T23:00:00Z",
      due_date: "2025-06-01",
      updated_at_wrike: "2026-12-01T00:00:00Z",
    });
    expect(dashboardProjectRecency(withSeveralDates))
      .toBe(Date.UTC(2025, 5, 1));
    expect(dashboardProjectRecency(project("year", "Year", { reporting_year: 2026 })))
      .toBe(Date.UTC(2026, 11, 31));
    expect(dashboardProjectRecency(project("sync", "Sync", {
      updated_at_wrike: "2025-11-04T19:00:00Z",
    }))).toBe(Date.UTC(2025, 10, 4));
  });

  it("keeps equal-date rows deterministic and repeated ID review rows adjacent", () => {
    const rows = [
      project("task-b", "Bravo", { due_date: "2026-01-01" }),
      project("task-a", "Alpha", { due_date: "2026-01-01", reviewed_sme_name: "Zed" }),
      project("task-a", "Alpha", { due_date: "2026-01-01", reviewed_sme_name: "Amy" }),
    ];
    expect(sortDashboardProjectsNewestFirst(rows).map((row) => `${row.task_id}:${row.reviewed_sme_name ?? ""}`))
      .toEqual(["task-a:Amy", "task-a:Zed", "task-b:"]);
  });

  it("applies the shared order to both dashboard tables", () => {
    const root = process.cwd();
    for (const file of ["components/id-dashboard.tsx", "components/sme-dashboard.tsx"]) {
      const source = fs.readFileSync(path.join(root, file), "utf8");
      expect(source).toContain("sortDashboardProjectsNewestFirst(rows)");
    }
    const idTable = fs.readFileSync(path.join(root, "components/id-dashboard-project-table.tsx"), "utf8");
    expect(idTable).toContain("rows.map");
    expect(idTable).toContain("Projects ordered from most recent to oldest");
    const smeDashboard = fs.readFileSync(path.join(root, "components/sme-dashboard.tsx"), "utf8");
    expect(smeDashboard).toContain("orderedRows.map");
    expect(smeDashboard).toContain("Projects ordered from most recent to oldest");
  });
});
