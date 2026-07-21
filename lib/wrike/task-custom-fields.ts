import type { NormalizedVerticalResult } from "@/lib/wrike/vertical-normalization";
import type { WrikeTask } from "@/lib/wrike/types";
import type { VerticalState } from "@/lib/wrike/vertical-normalization";

export type CustomFieldsResponseState = "present" | "empty" | "omitted" | "invalid";
export type CustomFieldsSyncState = "complete" | "incomplete" | "unknown";

export type TaskCustomFieldObservation = {
  task: WrikeTask;
  sourceFolderId: string;
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
  observations: { sourceFolderId: string; responseState: CustomFieldsResponseState; customFieldCount: number | null }[];
};

const owns = (value: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key);

export function customFieldsResponseState(task: WrikeTask): CustomFieldsResponseState {
  if (!owns(task, "customFields")) return "omitted";
  if (!Array.isArray(task.customFields)) return "invalid";
  return task.customFields.length ? "present" : "empty";
}

function customFieldsSignature(task: WrikeTask) {
  if (!Array.isArray(task.customFields)) return null;
  return JSON.stringify([...task.customFields]
    .map((field) => [field.id, field.value] as const)
    .sort(([left], [right]) => left.localeCompare(right)));
}

export function taskNeedsCustomFieldHydration(observations: readonly TaskCustomFieldObservation[]) {
  const signatures = new Set(observations.map((observation) => customFieldsSignature(observation.task)));
  return observations.every((observation) => customFieldsSignature(observation.task) == null)
    || signatures.size > 1;
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
  previousTask?: WrikeTask
): ResolvedTaskCustomFields {
  if (!observations.length) throw new Error("At least one folder task observation is required.");
  const base = newestTask(observations) ?? observations[0].task;
  const hydrationRequired = taskNeedsCustomFieldHydration(observations);
  const disagreement = new Set(observations.map((observation) => customFieldsSignature(observation.task))).size > 1;
  const detailState = detailTask ? customFieldsResponseState(detailTask) : null;
  const observationEvidence = observations.map(({ task, sourceFolderId }) => ({
    sourceFolderId,
    responseState: customFieldsResponseState(task),
    customFieldCount: Array.isArray(task.customFields) ? task.customFields.length : null
  }));

  if (detailTask && (detailState === "present" || detailState === "empty")) return {
    task: { ...base, ...detailTask, customFields: detailTask.customFields },
    authoritative: true,
    syncState: "complete",
    responseState: detailState,
    hydrationRequired,
    hydrationSucceeded: true,
    retainedPrevious: false,
    disagreement,
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
      observations: observationEvidence
    };
  }

  const currentComplete = richestTask(observations.map((observation) => observation.task));
  const retained = richestTask([...(currentComplete ? [currentComplete] : []), ...(previousTask ? [previousTask] : [])]);
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
