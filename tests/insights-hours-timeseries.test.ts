import { describe, expect, it } from "vitest";
import { hoursFromMinutes, loadHoursTimeseries, percentDifference } from "@/lib/reporting/insights";

describe("insights hours time series", () => {
  it("converts minutes to hours", () => {
    expect(hoursFromMinutes(90)).toBe(1.5);
    expect(hoursFromMinutes(0)).toBe(0);
  });

  it("computes a percentage difference between two totals", () => {
    expect(percentDifference(100, 150)).toBe(50);
    expect(percentDifference(100, 50)).toBe(-50);
    expect(percentDifference(0, 0)).toBe(0);
    expect(percentDifference(0, 40)).toBeNull();
  });

  it("builds a running cumulative total across ordered monthly periods", async () => {
    const rpc = async (name: string) => {
      expect(name).toBe("reporting_hours_timeseries");
      return {
        data: {
          totalCourses: 3,
          totalMinutes: 300,
          periods: [
            { periodStart: "2026-01-01", minutes: 120, projectCount: 2 },
            { periodStart: "2026-02-01", minutes: 180, projectCount: 1 }
          ]
        },
        error: null
      };
    };
    const result = await loadHoursTimeseries({ rpc } as never, {} as never);
    expect(result.totalCourses).toBe(3);
    expect(result.totalMinutes).toBe(300);
    expect(result.periods).toEqual([
      { periodStart: "2026-01-01", label: "Jan 2026", minutes: 120, cumulativeMinutes: 120, projectCount: 2 },
      { periodStart: "2026-02-01", label: "Feb 2026", minutes: 180, cumulativeMinutes: 300, projectCount: 1 }
    ]);
  });

  it("surfaces the RPC error instead of swallowing it", async () => {
    const rpc = async () => ({ data: null, error: { code: "PGRST202", message: "missing function" } });
    await expect(loadHoursTimeseries({ rpc } as never, {} as never)).rejects.toMatchObject({ code: "PGRST202" });
  });
});
