import { describe, expect, it } from "vitest";
import { persistedVerticalState, verticalPersistenceMatches, verticalSnapshotChanged } from "@/lib/wrike/vertical-repair";
import fs from "node:fs";
import path from "node:path";

describe("Vertical repair persistence read-back", () => {
  it("derives every displayed state from the persisted normalized row", () => {
    expect(persistedVerticalState(null)).toBe("missing");
    expect(persistedVerticalState({ task_id: "A", normalized_verticals: ["P1A"], unresolved_vertical_tokens: [], has_conflict: false, vertical_reporting_category: "P1A" })).toBe("resolved");
    expect(persistedVerticalState({ task_id: "B", normalized_verticals: ["P1A", "EMS1"], unresolved_vertical_tokens: [], has_conflict: false, vertical_reporting_category: "Cross Vertical" })).toBe("cross_vertical");
    expect(persistedVerticalState({ task_id: "C", normalized_verticals: [], unresolved_vertical_tokens: ["Mystery"], has_conflict: false, vertical_reporting_category: "Unresolved Vertical" })).toBe("unrecognized");
    expect(persistedVerticalState({ task_id: "D", normalized_verticals: [], unresolved_vertical_tokens: ["Conflicting Vertical sources"], has_conflict: true, vertical_reporting_category: "Unresolved Vertical" })).toBe("unrecognized");
  });

  it("never treats prior normalized data as current when synchronization is incomplete", () => {
    expect(persistedVerticalState({ task_id: "A", normalized_verticals: ["P1A"], unresolved_vertical_tokens: [], has_conflict: false, vertical_reporting_category: "P1A" }, "incomplete")).toBe("synchronization_incomplete");
  });

  it("requires a successful normalized-row read-back before a repair can be counted", () => {
    const stored = { task_id: "A", normalized_verticals: ["P1A"], unresolved_vertical_tokens: [], has_conflict: false, vertical_reporting_category: "P1A" };
    expect(verticalPersistenceMatches("resolved", ["P1A"], stored)).toBe(true);
    expect(verticalPersistenceMatches("resolved", ["EMS1"], stored)).toBe(false);
    expect(verticalPersistenceMatches("missing", [], null)).toBe(true);
  });

  it("is idempotent when the state and persisted snapshot already match", () => {
    const stored = { task_id: "A", normalized_verticals: ["EMS1"], unresolved_vertical_tokens: [], has_conflict: false, vertical_reporting_category: "EMS1" };
    expect(verticalSnapshotChanged("resolved", stored, "resolved", { ...stored })).toBe(false);
    expect(verticalSnapshotChanged("missing", null, "resolved", stored)).toBe(true);
  });

  it("paginates the full synchronized dataset and persists verified task states in batches", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "lib/wrike/vertical-repair.ts"), "utf8");
    expect(source).toContain(".range(offset, offset + 999)");
    expect(source).toContain('from("wrike_tasks").upsert(taskUpdates.slice(offset, offset + 500)');
    expect(source).not.toContain("if (task.state === task.row.vertical_state) unchanged++");
  });
});
