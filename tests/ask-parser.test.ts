import { describe, expect, it } from "vitest";
import { parseAsk, relativeDateRange, type AskReferences } from "@/lib/reporting/ask";

const references: AskReferences = { users: [{ id: "u1", name: "Alex Smith" }], scopes: [{ id: "s1", name: "Course Production" }], projects: [{ id: "p1", name: "Academy Launch" }], statuses: ["In Progress", "Completed"], customFields: [{ id: "00000000-0000-0000-0000-000000000001", name: "[LCT]" }], customOptions: [{ fieldId: "00000000-0000-0000-0000-000000000001", fieldName: "[LCT]", name: "Course" }] };
describe("Ask DevTrack parser", () => {
  it("parses date phrases, people, sources, and time breakdowns", () => {
    const parsed = parseAsk("How much time last week by person for Alex Smith in Course Production?", references, "America/Chicago", {}, new Date("2026-07-16T18:00:00Z"));
    expect(parsed).toMatchObject({ intent: "time-breakdown", groupBy: "person", filters: { assigneeIds: ["u1"], scopeIds: ["s1"], from: "2026-07-06", to: "2026-07-12" } });
  });
  it("parses custom-field grouping and planned-versus-actual questions", () => {
    const grouped = parseAsk("Show time this quarter by [LCT]", references, "America/Chicago", {}, new Date("2026-07-16T18:00:00Z"));
    expect(grouped).toMatchObject({ intent: "time-breakdown", groupBy: "custom", filters: { groupCustomFieldId: "00000000-0000-0000-0000-000000000001" } });
    expect(parseAsk("Compare planned and actual time", references, "America/Chicago").intent).toBe("compare");
  });
  it("resolves last month and explicit dates deterministically", () => {
    expect(relativeDateRange("last month", "America/Chicago", new Date("2026-07-16T18:00:00Z"))).toEqual({ from: "2026-06-01", to: "2026-06-30" });
    expect(relativeDateRange("from 2026-01-02 to 2026-01-31", "America/Chicago")).toEqual({ from: "2026-01-02", to: "2026-01-31" });
  });
  it("resolves projects and custom options and rejects unsupported analysis", () => {
    expect(parseAsk("Show tasks for Academy Launch with Course", references, "America/Chicago").filters).toMatchObject({ projectIds: ["p1"], customFields: { "00000000-0000-0000-0000-000000000001": "Course" } });
    expect(parseAsk("Predict which work will slip", references, "America/Chicago").intent).toBe("unsupported");
  });
});
