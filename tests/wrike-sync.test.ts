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
  it("uses exact task-id paths and normalizes effort and time to minutes", () => {
    expect(taskPath({ id: "scope", label: "List", scope_type: "list", source_ids: ["A", "B"] })).toMatch(/^\/tasks\/A,B\?/);
    expect(plannedMinutes({ id: "T", title: "Task", status: "Active", effortAllocation: { totalEffort: 125, allocatedEffort: 90 } })).toBe(125);
    expect(allocatedMinutes({ id: "T", title: "Task", status: "Active", effortAllocation: { totalEffort: 125, allocatedEffort: 90 } })).toBe(90);
    expect(entryMinutes({ id: "E", taskId: "T", trackedDate: "2026-07-01", hours: 1.25 })).toBe(75);
  });
});
