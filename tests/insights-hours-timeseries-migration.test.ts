import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("reporting_hours_timeseries migration", () => {
  const migration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202609250001_reporting_hours_timeseries.sql"), "utf8");

  it("reuses the shared organization-wide task filter instead of duplicating filter logic", () => {
    expect(migration).toContain("public.reporting_filtered_tasks(filters)");
  });

  it("buckets recorded hours by calendar month and excludes deleted or zero-length entries", () => {
    expect(migration).toContain("date_trunc('month', entry.entry_date)");
    expect(migration).toContain("not entry.is_deleted and entry.minutes > 0");
  });

  it("grants execute only to authenticated and service_role, matching other reporting RPCs", () => {
    expect(migration).toContain("revoke all on function public.reporting_hours_timeseries(jsonb) from public");
    expect(migration).toContain("grant execute on function public.reporting_hours_timeseries(jsonb) to authenticated,service_role");
  });
});
