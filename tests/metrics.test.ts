import { describe, expect, it } from "vitest";
import { isOverdue, overview } from "@/lib/metrics";

describe("reporting metrics", () => {
  const task = { id: "a", status: "Active", dueDate: "2026-01-01", completedAt: null, plannedMinutes: 60, actualMinutes: 90, assignees: ["u1", "u2"] };
  it("counts shared tasks once while retaining each contributor", () => expect(overview([task])).toMatchObject({ trackedTasks: 1, contributors: 2, overPlanTasks: 1 }));
  it("marks unfinished past-due tasks overdue", () => expect(isOverdue(task, new Date("2026-07-16"))).toBe(true));
});
