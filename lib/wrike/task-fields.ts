export const WRIKE_TASK_FIELDS = [
  "description",
  "responsibleIds",
  "parentIds",
  "superTaskIds",
  "subTaskIds",
  "customFields",
  "authorIds",
  "effortAllocation"
] as const;

export type WrikeTaskField = (typeof WRIKE_TASK_FIELDS)[number];
