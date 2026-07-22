import { describe, expect, it } from "vitest";
import { reportingFailure } from "@/lib/reporting/failure";

describe("reporting failure diagnostics", () => {
  it("classifies schema, timeout, permission, and unknown database failures", () => {
    expect(reportingFailure({ code: "PGRST202", message: "not in schema cache" }, "Projects", "migration.sql")).toMatchObject({ kind: "migration_required", diagnosticCode: "PGRST202" });
    expect(reportingFailure({ code: "57014", message: "canceling statement due to statement timeout" }, "Projects")).toMatchObject({ kind: "timeout", diagnosticCode: "57014" });
    expect(reportingFailure({ code: "57014", message: "statement timeout" }, "Projects", "performance.sql").message).toContain("performance.sql");
    expect(reportingFailure({ code: "42501", message: "permission denied" }, "Projects")).toMatchObject({ kind: "permission_denied" });
    expect(reportingFailure({ code: "XX000", message: "database problem" }, "Projects")).toMatchObject({ kind: "query_failed", technicalMessage: "database problem" });
  });
});
