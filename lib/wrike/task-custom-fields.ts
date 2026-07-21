import { createHash } from "node:crypto";
import type { NormalizedVerticalResult } from "@/lib/wrike/vertical-normalization";
import type { WrikeTask } from "@/lib/wrike/types";
import type { VerticalState } from "@/lib/wrike/vertical-normalization";

export type CustomFieldsResponseState = "present" | "empty" | "omitted" | "invalid";
export type CustomFieldsSyncState = "complete" | "incomplete" | "unknown";

export type TaskCustomFieldObservation = {
  task: WrikeTask;
  sourceFolderId: string;
};

export const CUSTOM_FIELD_DETAIL_VERIFICATION_VERSION = 2;

export type CustomFieldPayloadEvidence = {
  responseState: CustomFieldsResponseState;
  customFieldCount: number | null;
  customFieldIds: string[];
  fingerprint: string | null;
};

export type ResolvedTaskCustomFields = {
  task: WrikeTask;
  authoritative: boolean;
  syncState: Exclude<CustomFieldsSyncState, "unknown">;
  responseState: CustomFieldsResponseState;
  hydrationRequired: boolean;
  hydrationSucceeded: boolean;
  retainedPrevious: boolean;
  disagreement: boolean;
  selectedSource: "task_detail" | "folder_list_verified" | "prior" | "incomplete";
  authoritativeFingerprint: string | null;
  detailVerificationFingerprint: string | null;
  detail: CustomFieldPayloadEvidence | null;
  previous: CustomFieldPayloadEvidence | null;
  observations: (CustomFieldPayloadEvidence & { sourceFolderId: string })[];
};

const owns = (value: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key);

export function customFieldsResponseState(task: WrikeTask): CustomFieldsResponseState {
  if (!owns(task, "customFields")) return "omitted";
  if (!Array.isArray(task.customFields)) return "invalid";
  return task.customFields.length ? "present" : "empty";
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

function customFieldsSignature(task: WrikeTask) {
  if (!Array.isArray(task.customFields)) return null;
  return stableJson([...task.customFields]
    .map((field) => ({ id: field.id, value: field.value }))
    .sort((left, right) => left.id.localeCompare(right.id)));
}

export function customFieldsFingerprint(task: WrikeTask) {
  const signature = customFieldsSignature(task);
  return signature == null ? null : createHash("sha256").update(signature).digest("hex");
}

function payloadEvidence(task: WrikeTask): CustomFieldPayloadEvidence {
  return {
    responseState: customFieldsResponseState(task),
    customFieldCount: Array.isArray(task.customFields) ? task.customFields.length : null,
    customFieldIds: Array.isArray(task.customFields) ? [...new Set(task.customFields.map((field) => field.id))].sort() : [],
    fingerprint: customFieldsFingerprint(task)
  };
}

export function detailVerificationFingerprint(diagnostics: unknown) {
  if (!diagnostics || typeof diagnostics !== "object") return null;
  const record = diagnostics as Record<string, unknown>;
  return record.detailVerificationVersion === CUSTOM_FIELD_DETAIL_VERIFICATION_VERSION
    && typeof record.detailVerificationFingerprint === "string"
    ? record.detailVerificationFingerprint
    : null;
}

export function isTaskCustomFieldsDetailVerified(task: WrikeTask, diagnostics: unknown) {
  const fingerprint = customFieldsFingerprint(task);
  return fingerprint !== null && fingerprint === detailVerificationFingerprint(diagnostics);
}

export function taskNeedsCustomFieldHydration(
  observations: readonly TaskCustomFieldObservation[],
  previousTask?: WrikeTask,
  previousDiagnostics?: unknown
) {
  const signatures = new Set(observations.map((observation) => customFieldsSignature(observation.task)));
  if (observations.every((observation) => customFieldsSignature(observation.task) == null) || signatures.size > 1) return true;
  const complete = richestTask(observations.map((observation) => observation.task));
  if (!complete) return true;
  const currentFingerprint = customFieldsFingerprint(complete);
  const priorDetailFingerprint = detailVerificationFingerprint(previousDiagnostics);
  if (!currentFingerprint || currentFingerprint !== priorDetailFingerprint) return true;
  return Boolean(previousTask && Array.isArray(previousTask.customFields)
    && previousTask.customFields.length > (complete.customFields?.length ?? 0));
}

export function taskDetailsPath(taskIds: readonly string[]) {
  if (!taskIds.length || taskIds.length > 100) throw new Error("Task detail hydration requires between 1 and 100 task IDs.");
  const fields = encodeURIComponent(JSON.stringify(["effortAllocation"]));
  return `/tasks/${taskIds.map(encodeURIComponent).join(",")}?plainTextCustomFields=true&fields=${fields}`;
}

function newestTask(observations: readonly TaskCustomFieldObservation[]) {
  return [...observations].sort((left, right) => {
    const leftDate = Date.parse(left.task.updatedDate ?? "") || 0;
    const rightDate = Date.parse(right.task.updatedDate ?? "") || 0;
    return rightDate - leftDate;
  })[0]?.task;
}

function richestTask(tasks: readonly WrikeTask[]) {
  return [...tasks].filter((task) => Array.isArray(task.customFields)).sort((left, right) =>
    (right.customFields?.length ?? 0) - (left.customFields?.length ?? 0)
  )[0];
}

export function resolveTaskCustomFields(
  observations: readonly TaskCustomFieldObservation[],
  detailTask?: WrikeTask,
  previousTask?: WrikeTask,
  previousDiagnostics?: unknown
): ResolvedTaskCustomFields {
  if (!observations.length) throw new Error("At least one folder task observation is required.");
  const base = newestTask(observations) ?? observations[0].task;
  const hydrationRequired = taskNeedsCustomFieldHydration(observations, previousTask, previousDiagnostics);
  const disagreement = new Set(observations.map((observation) => customFieldsSignature(observation.task))).size > 1;
  const detailState = detailTask ? customFieldsResponseState(detailTask) : null;
  const observationEvidence = observations.map(({ task, sourceFolderId }) => ({ sourceFolderId, ...payloadEvidence(task) }));
  const detailEvidence = detailTask ? payloadEvidence(detailTask) : null;
  const previousEvidence = previousTask ? payloadEvidence(previousTask) : null;

  if (detailTask && (detailState === "present" || detailState === "empty")) return {
    task: { ...base, ...detailTask, customFields: detailTask.customFields },
    authoritative: true,
    syncState: "complete",
    responseState: detailState,
    hydrationRequired,
    hydrationSucceeded: true,
    retainedPrevious: false,
    disagreement,
    selectedSource: "task_detail",
    authoritativeFingerprint: customFieldsFingerprint(detailTask),
    detailVerificationFingerprint: customFieldsFingerprint(detailTask),
    detail: detailEvidence,
    previous: previousEvidence,
    observations: observationEvidence
  };

  if (!hydrationRequired) {
    const complete = richestTask(observations.map((observation) => observation.task))!;
    const responseState = customFieldsResponseState(complete);
    return {
      task: { ...base, customFields: complete.customFields },
      authoritative: true,
      syncState: "complete",
      responseState,
      hydrationRequired: false,
      hydrationSucceeded: false,
      retainedPrevious: false,
      disagreement: false,
      selectedSource: "folder_list_verified",
      authoritativeFingerprint: customFieldsFingerprint(complete),
      detailVerificationFingerprint: detailVerificationFingerprint(previousDiagnostics),
      detail: detailEvidence,
      previous: previousEvidence,
      observations: observationEvidence
    };
  }

  const currentComplete = richestTask(observations.map((observation) => observation.task));
  const previousComplete = previousTask && Array.isArray(previousTask.customFields) ? previousTask : undefined;
  const retained = previousComplete && (!currentComplete || previousComplete.customFields!.length >= currentComplete.customFields!.length)
    ? previousComplete
    : currentComplete;
  const retainedPrevious = Boolean(retained && retained === previousTask);
  const fallbackState = detailState ?? customFieldsResponseState(base);
  return {
    task: retained ? { ...base, customFields: retained.customFields } : base,
    authoritative: false,
    syncState: "incomplete",
    responseState: fallbackState,
    hydrationRequired: true,
    hydrationSucceeded: false,
    retainedPrevious,
    disagreement,
    selectedSource: retainedPrevious ? "prior" : "incomplete",
    authoritativeFingerprint: null,
    detailVerificationFingerprint: retainedPrevious ? detailVerificationFingerprint(previousDiagnostics) : null,
    detail: detailEvidence,
    previous: previousEvidence,
    observations: observationEvidence
  };
}

export function classifyVerticalState(input: {
  customFieldsSyncState: CustomFieldsSyncState;
  vertical?: NormalizedVerticalResult;
  unresolvedCustomFieldDefinitions?: boolean;
}): VerticalState {
  if (input.customFieldsSyncState !== "complete") return "synchronization_incomplete";
  if (!input.vertical && input.unresolvedCustomFieldDefinitions) return "synchronization_incomplete";
  return input.vertical?.verticalState ?? "missing";
}
