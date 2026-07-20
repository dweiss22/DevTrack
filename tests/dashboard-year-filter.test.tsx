import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDashboardOverview, loadDashboardTimeAnalytics, loadDashboardYearOptions } from "@/lib/reporting/dashboard";

describe("all-years Dashboard", () => {
  it("has no Reporting Year filter on the main Dashboard", () => {
    const source = readFileSync(join(process.cwd(), "app", "page.tsx"), "utf8");
    expect(source).toContain("across all valid Reporting Years");
    expect(source).not.toContain("DashboardYearFilter");
    expect(source).not.toContain("requestedYear");
  });

  it("loads the no-argument all-years overview and time RPCs", async () => {
    const calls: { name: string; args: unknown }[] = [];
    const rpc = async (name: string, args: unknown) => {
      calls.push({ name, args });
      return { data: name.endsWith("overview_v4") ? { metrics: {} } : { averageTimeByReportingYear: [], timeDataSynchronized: true }, error: null };
    };
    await loadDashboardOverview({ rpc } as never);
    await loadDashboardTimeAnalytics({ rpc } as never);
    expect(calls).toEqual([
      { name: "reporting_online_learning_dashboard_overview_v4", args: undefined },
      { name: "reporting_online_learning_dashboard_time_v4", args: undefined },
    ]);
  });

  it("turns a missing reporting RPC into an actionable migration result", async () => {
    const rpc = async () => ({ data: null, error: { code: "PGRST202", message: "function was not found in the schema cache" } });
    const result = await loadDashboardYearOptions({ rpc } as never);
    expect(result).toMatchObject({ data: null, error: { kind: "migration_required", diagnosticCode: "PGRST202" } });
    expect(result.error?.message).toContain("202607200006");
  });

  it("catches transport exceptions without substituting zeroes", async () => {
    const rpc = async () => { throw new Error("network timeout"); };
    const result = await loadDashboardOverview({ rpc } as never);
    expect(result).toMatchObject({ data: null, error: { kind: "query_failed", title: "Dashboard query timed out" } });
  });
});
