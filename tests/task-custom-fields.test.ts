import { describe, expect, it } from "vitest";
import { CUSTOM_FIELD_DETAIL_VERIFICATION_VERSION, classifyVerticalState, customFieldsFingerprint, customFieldsResponseState, isTaskCustomFieldsDetailVerified, resolveTaskCustomFields, taskDetailsPath, taskNeedsCustomFieldHydration, type TaskCustomFieldObservation } from "@/lib/wrike/task-custom-fields";
import { normalizeVerticalValue } from "@/lib/wrike/vertical-normalization";
import type { WrikeTask } from "@/lib/wrike/types";

const task = (id: string, customFields?: WrikeTask["customFields"]): WrikeTask => ({ id, title: id === "T-NAMED" ? "De-escalation Strategies and Techniques" : `Task ${id}`, status: "Active", ...(customFields === undefined ? {} : { customFields }) });
const observation = (value: WrikeTask, sourceFolderId = "F1"): TaskCustomFieldObservation => ({ task: value, sourceFolderId });
const verifiedDiagnostics = (value: WrikeTask) => ({ detailVerificationVersion: CUSTOM_FIELD_DETAIL_VERIFICATION_VERSION, detailVerificationFingerprint: customFieldsFingerprint(value) });
const richFields = Array.from({ length: 9 }, (_, index) => ({ id: `FIELD-${index + 1}`, value: index === 0 ? "2026-07-08" : `Value ${index + 1}` }));
const sparseFields = richFields.slice(0, 1);

describe("task custom-field completeness", () => {
  it("distinguishes complete empty payloads from omitted and malformed payloads", () => {
    expect(customFieldsResponseState(task("A", []))).toBe("empty");
    expect(customFieldsResponseState(task("B", [{ id: "V", value: "General" }]))).toBe("present");
    expect(customFieldsResponseState(task("C"))).toBe("omitted");
    expect(customFieldsResponseState({ ...task("D"), customFields: null as never })).toBe("invalid");
  });

  it("reuses a consistent folder payload only after the same values were detail-verified", () => {
    const previous = task("A", [{ id: "V", value: { second: 2, first: 1 } }]);
    const observations = [observation(task("A", [{ id: "V", value: { first: 1, second: 2 } }]), "F1"), observation(task("A", [{ id: "V", value: { second: 2, first: 1 } }]), "F2")];
    expect(taskNeedsCustomFieldHydration(observations)).toBe(true);
    expect(taskNeedsCustomFieldHydration(observations, previous, verifiedDiagnostics(previous))).toBe(false);
    expect(resolveTaskCustomFields(observations, undefined, previous, verifiedDiagnostics(previous))).toMatchObject({ authoritative: true, syncState: "complete", responseState: "present", hydrationRequired: false, selectedSource: "folder_list_verified" });
    expect(isTaskCustomFieldsDetailVerified(observations[0].task, verifiedDiagnostics(previous))).toBe(true);
  });

  it("requires detail verification for both rich and sparse first observations", () => {
    expect(taskNeedsCustomFieldHydration([observation(task("MAAAAAECJ2DX", richFields))])).toBe(true);
    expect(taskNeedsCustomFieldHydration([observation(task("MAAAAAAEMqHAo", sparseFields))])).toBe(true);
  });

  it("selects the richer task-detail payload for the supplied sparse regression shape", () => {
    const observations = [observation(task("MAAAAAAEMqHAo", sparseFields), "MQAAAABntYVL")];
    const result = resolveTaskCustomFields(observations, task("MAAAAAAEMqHAo", richFields));
    expect(result).toMatchObject({ authoritative: true, hydrationRequired: true, hydrationSucceeded: true, selectedSource: "task_detail" });
    expect(result.task.customFields).toEqual(richFields);
    expect(result.detail?.customFieldIds).toHaveLength(9);
  });

  it("records a still-sparse detail response as authoritative without fabricating fields", () => {
    const observations = [observation(task("MAAAAAAEMqHAo", sparseFields))];
    const result = resolveTaskCustomFields(observations, task("MAAAAAAEMqHAo", sparseFields));
    expect(result).toMatchObject({ authoritative: true, hydrationSucceeded: true, responseState: "present" });
    expect(result.task.customFields).toEqual(sparseFields);
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

  it("does not let an unverified explicit empty list clear prior values", () => {
    const previous = task("T-NAMED", richFields);
    const observations = [observation(task("T-NAMED", []))];
    expect(resolveTaskCustomFields(observations, undefined, previous, verifiedDiagnostics(previous))).toMatchObject({ authoritative: false, retainedPrevious: true, task: { customFields: richFields } });
    expect(resolveTaskCustomFields(observations, task("T-NAMED", []), previous, verifiedDiagnostics(previous))).toMatchObject({ authoritative: true, hydrationSucceeded: true, task: { customFields: [] } });
  });

  it("retains the prior payload on equal-richness disagreement when detail hydration fails", () => {
    const previous = task("A", [{ id: "VERTICAL", value: "P1A" }]);
    const observations = [observation(task("A", [{ id: "YEAR", value: "2026 Courses" }]))];
    const result = resolveTaskCustomFields(observations, undefined, previous, verifiedDiagnostics(previous));
    expect(result).toMatchObject({ authoritative: false, retainedPrevious: true });
    expect(result.task.customFields).toEqual(previous.customFields);
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
