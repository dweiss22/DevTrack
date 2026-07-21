import { describe, expect, it } from "vitest";
import { parseDiagnosticTaskIds, summarizeCustomFieldPayload } from "@/lib/wrike/custom-field-diagnostics";

describe("bounded custom-field acquisition diagnostics", () => {
  it("accepts, trims, and deduplicates at most ten valid Wrike IDs", () => {
    expect(parseDiagnosticTaskIds([" MAAAAAECJ2DX ", "MAAAAAEMqHAo", "MAAAAAECJ2DX"])).toEqual(["MAAAAAECJ2DX", "MAAAAAEMqHAo"]);
    expect(() => parseDiagnosticTaskIds([])).toThrow(/at least one/i);
    expect(() => parseDiagnosticTaskIds(["not/a/wrike/id"])).toThrow(/invalid/i);
    expect(() => parseDiagnosticTaskIds(Array.from({ length: 11 }, (_, index) => `TASK-${index}`))).toThrow(/limited to 10/i);
  });

  it("returns bounded field-level evidence without returning a complete payload", () => {
    const result = summarizeCustomFieldPayload({
      id: "MAAAAAAEMqHAo",
      title: "De-escalation Strategies and Techniques",
      customFields: [{ id: "IEACHQK7JUAFJ7V3", value: "x".repeat(600) }],
      secretUnrelatedProperty: "must not be returned"
    });
    expect(result).toMatchObject({ hasOwnProperty: true, responseState: "present", count: 1, fieldsTruncated: false });
    expect(result.fields[0].id).toBe("IEACHQK7JUAFJ7V3");
    expect(String(result.fields[0].value).length).toBeLessThan(600);
    expect(result).not.toHaveProperty("secretUnrelatedProperty");
    expect(summarizeCustomFieldPayload({})).toMatchObject({ hasOwnProperty: false, responseState: "omitted", count: null });
  });
});
