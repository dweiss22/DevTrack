import { describe, expect, it } from "vitest";
import { classifyVerticalState, customFieldsResponseState, resolveTaskCustomFields, taskDetailsPath, taskNeedsCustomFieldHydration, type TaskCustomFieldObservation } from "@/lib/wrike/task-custom-fields";
import { normalizeVerticalValue } from "@/lib/wrike/vertical-normalization";
import type { WrikeTask } from "@/lib/wrike/types";

const task = (id: string, customFields?: WrikeTask["customFields"]): WrikeTask => ({ id, title: id === "T-NAMED" ? "De-escalation Strategies and Techniques" : `Task ${id}`, status: "Active", ...(customFields === undefined ? {} : { customFields }) });
const observation = (value: WrikeTask, sourceFolderId = "F1"): TaskCustomFieldObservation => ({ task: value, sourceFolderId });

describe("task custom-field completeness", () => {
  it("distinguishes complete empty payloads from omitted and malformed payloads", () => {
    expect(customFieldsResponseState(task("A", []))).toBe("empty");
    expect(customFieldsResponseState(task("B", [{ id: "V", value: "General" }]))).toBe("present");
    expect(customFieldsResponseState(task("C"))).toBe("omitted");
    expect(customFieldsResponseState({ ...task("D"), customFields: null as never })).toBe("invalid");
  });

  it("accepts consistent folder observations without detail hydration", () => {
    const observations = [observation(task("A", [{ id: "V", value: "P1A" }]), "F1"), observation(task("A", [{ id: "V", value: "P1A" }]), "F2")];
    expect(taskNeedsCustomFieldHydration(observations)).toBe(false);
    expect(resolveTaskCustomFields(observations)).toMatchObject({ authoritative: true, syncState: "complete", responseState: "present", hydrationRequired: false });
  });

  it("hydrates duplicate presence/content disagreements and honors an authoritative empty detail response", () => {
    const observations = [observation(task("A"), "F1"), observation(task("A", [{ id: "V", value: "P1A" }]), "F2")];
    expect(taskNeedsCustomFieldHydration(observations)).toBe(true);
    expect(resolveTaskCustomFields(observations, task("A", []))).toMatchObject({ authoritative: true, responseState: "empty", hydrationRequired: true, hydrationSucceeded: true, disagreement: true, task: { customFields: [] } });
  });

  it("retains the richest prior values when hydration fails for the named regression case", () => {
    const current = [observation(task("T-NAMED"), "F1"), observation(task("T-NAMED"), "F2")];
    const prior = task("T-NAMED", [{ id: "VERTICAL", value: "General" }, { id: "YEAR", value: "2026 Courses" }]);
    const result = resolveTaskCustomFields(current, undefined, prior);
    expect(result).toMatchObject({ authoritative: false, syncState: "incomplete", retainedPrevious: true, hydrationRequired: true });
    expect(result.task.customFields).toEqual(prior.customFields);
    expect(classifyVerticalState({ customFieldsSyncState: result.syncState, vertical: normalizeVerticalValue("General") })).toBe("synchronization_incomplete");
  });

  it("batches only detail-supported fields and enforces batches of 100", () => {
    expect(taskDetailsPath(["A", "B"])).toBe('/tasks/A,B?plainTextCustomFields=true&fields=%5B%22effortAllocation%22%5D');
    expect(() => taskDetailsPath(Array.from({ length: 101 }, (_, index) => `T${index}`))).toThrow(/100/);
  });

  it("classifies all five Vertical states", () => {
    expect(classifyVerticalState({ customFieldsSyncState: "complete", vertical: normalizeVerticalValue("P1A") })).toBe("resolved");
    expect(classifyVerticalState({ customFieldsSyncState: "complete", vertical: normalizeVerticalValue("General") })).toBe("cross_vertical");
    expect(classifyVerticalState({ customFieldsSyncState: "complete", vertical: normalizeVerticalValue("") })).toBe("missing");
    expect(classifyVerticalState({ customFieldsSyncState: "complete", vertical: normalizeVerticalValue("P1A, Mystery") })).toBe("unrecognized");
    expect(classifyVerticalState({ customFieldsSyncState: "incomplete", vertical: normalizeVerticalValue("P1A") })).toBe("synchronization_incomplete");
  });
});
