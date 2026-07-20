import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { completedReportingYearAverages, dashboardCategory, dashboardMetricCounts, loadDashboardAnalyticsResult, normalizeDashboardValues, normalizeReportingYear, ONLINE_LEARNING_WORKFLOW_ID } from "@/lib/reporting/dashboard";
import { APPLICATION_NAVIGATION, navigationForRole } from "@/lib/navigation";
import { assignedDashboardRows, dashboardDrilldownHref, safeDashboardReturnTo, safeProjectsReturnTo } from "@/lib/reporting/dashboard-navigation";

describe("application navigation", () => {
  it("uses the requested order, two dividers, and Projects presentation", () => {
    expect(APPLICATION_NAVIGATION.map((entry) => entry.kind === "divider" ? "divider" : entry.label)).toEqual([
      "Dashboard", "Development", "SME Collaboration", "Other Teams", "divider", "Projects", "divider", "User Management", "Data"
    ]);
    expect(APPLICATION_NAVIGATION.some((entry) => entry.kind === "link" && entry.label === "Tasks")).toBe(false);
  });

  it("removes administrative links and their empty divider for members", () => {
    const memberItems = navigationForRole(false);
    expect(memberItems.some((entry) => entry.kind === "link" && (entry.id === "users" || entry.id === "data"))).toBe(false);
    expect(memberItems.filter((entry) => entry.kind === "divider")).toHaveLength(1);
    expect(navigationForRole(true).filter((entry) => entry.kind === "divider")).toHaveLength(2);
  });

  it("keeps a Lexipol-branded operational logout control", () => {
    const sidebar = fs.readFileSync(path.join(process.cwd(), "components/sidebar-navigation.tsx"), "utf8");
    const logoutRoute = fs.readFileSync(path.join(process.cwd(), "app/api/auth/logout/route.ts"), "utf8");
    expect(sidebar).toContain("Lexipol_logo_wht-60.png");
    expect(sidebar).toContain('aria-label={mobileOpen ? "Close navigation" : "Open navigation"}');
    expect(sidebar).toContain('fetch("/api/auth/logout"');
    expect(logoutRoute).toContain("supabase.auth.signOut()");
  });
});

describe("Online Learning dashboard calculations", () => {
  it("removes Unassigned buckets from graph presentation", () => {
    expect(assignedDashboardRows([{ label: "2025" }, { label: " Unassigned " }, { label: "2026" }], "label")).toEqual([{ label: "2025" }, { label: "2026" }]);
  });

  it("builds exact project drill-down filters and preserves the dashboard return URL", () => {
    const href = dashboardDrilldownHref({ sort: "title", page: 2, pageSize: 25, q: "academy" }, { kind: "year", year: 2026, classification: "completed" });
    const url = new URL(href, "https://devtrack.test");
    expect(url.pathname).toBe("/projects");
    expect(url.searchParams.get("reportingYear")).toBe("2026");
    expect(url.searchParams.get("validReportingYearOnly")).toBe("true");
    expect(url.searchParams.get("dashboardClassification")).toBe("completed");
    expect(url.searchParams.get("workflowIds")).toBe(ONLINE_LEARNING_WORKFLOW_ID);
    expect(url.searchParams.get("returnTo")).toContain("q=academy");
    expect(url.searchParams.get("page")).toBe("1");
    expect(safeDashboardReturnTo(url.searchParams.get("returnTo") ?? undefined)).toContain("q=academy");
    expect(safeDashboardReturnTo("https://malicious.example")).toBeUndefined();
    expect(safeProjectsReturnTo("/projects?reportingYear=2026")).toBe("/projects?reportingYear=2026");
    expect(safeProjectsReturnTo("//malicious.example/projects")).toBeUndefined();
  });

  it("turns a missing Dashboard RPC into an actionable migration notice", async () => {
    const rpc = async () => ({ data: null, error: { code: "PGRST202", message: "Could not find public.reporting_online_learning_dashboard_v2" } });
    const result = await loadDashboardAnalyticsResult({ rpc } as never, { sort: "updated", page: 1, pageSize: 50 });
    expect(result).toMatchObject({ data: null, error: { kind: "migration_required", diagnosticCode: "PGRST202" } });
    expect(result.error?.message).toContain("202607170005_dashboard_analytics.sql");
  });

  it("includes only Online Learning projects and classifies metrics from normalized status mappings", () => {
    expect(dashboardMetricCounts([
      { workflowId: ONLINE_LEARNING_WORKFLOW_ID, classification: "active" },
      { workflowId: ONLINE_LEARNING_WORKFLOW_ID, classification: "completed" },
      { workflowId: ONLINE_LEARNING_WORKFLOW_ID, classification: "stalled_or_canceled" },
      { workflowId: "OTHER", statusWorkflowId: "OTHER", classification: "completed" }
    ])).toEqual({ totalProjects: 3, activeProjects: 1, completedProjects: 1 });
  });

  it("validates and chronologically sorts reporting years", () => {
    expect(normalizeReportingYear(["2025 Courses"])).toBe(2025);
    expect(normalizeReportingYear([" 2026   courses "])).toBe(2026);
    expect(normalizeReportingYear(["2027 Courses", "2027 COURSES"])).toBe(2027);
    expect(normalizeReportingYear(["2025"])).toBeNull();
    expect(normalizeReportingYear(["FY2026"])).toBeNull();
    expect(normalizeReportingYear(["2027 Reporting Year"])).toBeNull();
    expect(normalizeReportingYear(["not a year"])).toBeNull();
    expect(normalizeReportingYear(["2025 Courses", "bad value"])).toBeNull();
    expect(normalizeReportingYear(["2025 Courses", "2026 Courses"])).toBeNull();
  });

  it("averages project totals rather than individual timelog rows", () => {
    const result = completedReportingYearAverages([
      { workflowId: ONLINE_LEARNING_WORKFLOW_ID, classification: "completed", reportingValues: ["2025 Courses"], actualMinutes: 180 },
      { workflowId: ONLINE_LEARNING_WORKFLOW_ID, classification: "completed", reportingValues: ["2025 COURSES"], actualMinutes: 60 },
      { workflowId: ONLINE_LEARNING_WORKFLOW_ID, classification: "completed", reportingValues: ["2024 Courses"], actualMinutes: 30 },
      { workflowId: ONLINE_LEARNING_WORKFLOW_ID, classification: "active", reportingValues: ["2025 Courses"], actualMinutes: 999 }
    ]);
    expect(result).toEqual([
      { label: "2024", sortYear: 2024, projectCount: 1, totalMinutes: 30, averageMinutes: 30 },
      { label: "2025", sortYear: 2025, projectCount: 2, totalMinutes: 240, averageMinutes: 120 }
    ]);
  });

  it("deduplicates category casing and follows single-project multiple-value rules", () => {
    expect(normalizeDashboardValues([" EMS ", "ems", "Law  Enforcement"])).toEqual(["EMS", "Law Enforcement"]);
    expect(dashboardCategory([], "Cross Vertical")).toBe("Unassigned");
    expect(dashboardCategory(["EMS", "ems"], "Cross Vertical")).toBe("EMS");
    expect(dashboardCategory(["EMS", "Fire"], "Cross Vertical")).toBe("Cross Vertical");
    expect(dashboardCategory(["A future tool"], "Multiple Authoring Tools")).toBe("A future tool");
  });
});
