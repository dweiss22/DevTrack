export type WrikeEffortAllocation = {
  mode?: string;
  allocatedEffort?: number;
  totalEffort?: number;
};
export type WrikeTask = { id: string; title: string; description?: string; permalink?: string; status: string; importance?: string; createdDate?: string; updatedDate?: string; dates?: { start?: string; due?: string; completed?: string; type?: string }; parentIds?: string[]; superTaskIds?: string[]; subTaskIds?: string[]; responsibleIds?: string[]; authorIds?: string[]; customStatusId?: string; workflowId?: string; customFields?: { id: string; value: unknown }[]; effortAllocation?: WrikeEffortAllocation; [key: string]: unknown };
export type WrikeTimeEntry = { id: string; taskId: string; userId?: string; trackedDate: string; hours?: number; minutes?: number; categoryId?: string; comment?: string; createdDate?: string; updatedDate?: string; [key: string]: unknown };
export type WrikeUser = { id: string; firstName?: string; lastName?: string; deleted?: boolean; profiles?: { accountId?: string; email?: string }[]; [key: string]: unknown };
export type WrikeFolder = { id: string; title: string; parentIds?: string[]; space?: boolean; project?: { ownerIds?: string[]; status?: string; customStatusId?: string }; [key: string]: unknown };
export type WrikeWorkflow = { id: string; name?: string; customStatuses?: { id: string; name: string; group?: string }[]; [key: string]: unknown };
export type WrikeCustomField = { id: string; title: string; type?: string; settings?: { values?: { id?: string; value?: string }[] }; [key: string]: unknown };
export type WrikeTimelogCategory = { id: string; name?: string; title?: string; [key: string]: unknown };
