import { describe, expect, it } from "vitest";
import { allocatedMinutes, entryMinutes, plannedMinutes, taskPath } from "@/lib/wrike/sync";

describe("Wrike synchronization contracts", () => {
  it("requests reporting fields, descendants, subtasks, and an incremental overlap boundary", () => {
    const path = taskPath({ id: "scope", label: "Courses", scope_type: "folder", source_ids: ["folder/1"] }, "2026-07-01T00:00:00.000Z");
    expect(path).toContain("/folders/folder%2F1/tasks?");
    expect(decodeURIComponent(path)).toContain('"responsibleIds"');
    expect(decodeURIComponent(path)).toContain("descendants=true");
    expect(decodeURIComponent(path)).toContain("subTasks=true");
    expect(decodeURIComponent(path)).toContain("updatedDate=");
  });
  it("builds an account-wide read-only task request for the one-click import", () => {
    const path = taskPath({ id: "scope", label: "All Wrike data", scope_type: "account", source_ids: ["account"] });
    expect(path).toMatch(/^\/tasks\?/);
    expect(decodeURIComponent(path)).toContain("subTasks=true");
    expect(decodeURIComponent(path)).toContain('"customFields"');
    expect(decodeURIComponent(path)).toContain('"effortAllocation"');
  });
  it("uses exact task-id paths and normalizes effort and time to minutes", () => {
    expect(taskPath({ id: "scope", label: "List", scope_type: "list", source_ids: ["A", "B"] })).toMatch(/^\/tasks\/A,B\?/);
    expect(plannedMinutes({ id: "T", title: "Task", status: "Active", effortAllocation: { totalEffort: 125, allocatedEffort: 90 } })).toBe(125);
    expect(allocatedMinutes({ id: "T", title: "Task", status: "Active", effortAllocation: { totalEffort: 125, allocatedEffort: 90 } })).toBe(90);
    expect(entryMinutes({ id: "E", taskId: "T", trackedDate: "2026-07-01", hours: 1.25 })).toBe(75);
  });
  it("builds the configured Space import as a descendant and subtask GET", () => {
    const path = decodeURIComponent(taskPath({ id: "space-import", label: "Space", scope_type: "space", source_ids: ["IEACHQK7I46YBWEN"] }));
    expect(path).toContain("/spaces/IEACHQK7I46YBWEN/tasks?");
    expect(path).toContain("descendants=true");
    expect(path).toContain("subTasks=true");
  });
});
