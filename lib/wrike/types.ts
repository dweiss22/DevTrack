export type WrikeEffortAllocation = {
  mode?: string;
  allocatedEffort?: number;
  totalEffort?: number;
};
export type WrikeTask = { id: string; title: string; description?: string; permalink?: string; status: string; importance?: string; createdDate?: string; updatedDate?: string; dates?: { start?: string; due?: string; completed?: string; type?: string }; parentIds?: string[]; superTaskIds?: string[]; subTaskIds?: string[]; responsibleIds?: string[]; authorIds?: string[]; customStatusId?: string; workflowId?: string; customFields?: { id: string; value: unknown }[]; effortAllocation?: WrikeEffortAllocation; [key: string]: unknown };
export type WrikeTimeEntry = { id: string; taskId: string; userId?: string; trackedDate: string; hours?: number; minutes?: number; categoryId?: string; comment?: string; createdDate?: string; updatedDate?: string; [key: string]: unknown };
export type WrikeUserProfile = { accountId?: string; email?: string; role?: string; external?: boolean; admin?: boolean; owner?: boolean; active?: boolean; [key: string]: unknown };
export type WrikeUser = { id: string; firstName?: string; lastName?: string; primaryEmail?: string; title?: string; avatarUrl?: string; timezone?: string; locale?: string; deleted?: boolean; profiles?: WrikeUserProfile[]; [key: string]: unknown };
export interface WrikeFolderProjectMetadata {
  authorId?: string;
  ownerIds?: string[];
  status?: string;
  customStatusId?: string;
  createdDate?: string;
  [key: string]: unknown;
}
export interface WrikeFolderDefinition {
  id: string;
  title: string;
  childIds: string[];
  scope: string;
  project?: WrikeFolderProjectMetadata;
  [key: string]: unknown;
}
export interface WrikeFolderTreeResponse {
  kind: string;
  data: WrikeFolderDefinition[];
  [key: string]: unknown;
}
export type WrikeFolder = WrikeFolderDefinition & { parentIds?: string[]; space?: boolean };
export type WrikeWorkflowStatus = { id: string; name: string; group?: string; standard?: boolean; hidden?: boolean; color?: string; [key: string]: unknown };
export type WrikeWorkflow = { id: string; name?: string; description?: string; hidden?: boolean; customStatuses?: WrikeWorkflowStatus[]; [key: string]: unknown };
export interface WrikeCustomFieldOption {
  value: string;
  color?: string;
  [key: string]: unknown;
}
export interface WrikeCustomFieldSettings {
  inheritanceType?: string;
  applicableEntityTypes?: string[];
  values?: string[];
  options?: WrikeCustomFieldOption[];
  optionColorsEnabled?: boolean;
  allowOtherValues?: boolean;
  readOnly?: boolean;
  allowTime?: boolean;
  [key: string]: unknown;
}
export interface WrikeCustomFieldDefinition {
  id: string;
  accountId?: string;
  title: string;
  type: string;
  spaceId?: string;
  sharedIds?: string[];
  sharing?: Record<string, unknown>;
  settings?: WrikeCustomFieldSettings;
  description?: string;
  archived?: boolean;
  [key: string]: unknown;
}
export interface WrikeCustomFieldsResponse {
  kind: string;
  data: WrikeCustomFieldDefinition[];
  [key: string]: unknown;
}
export type WrikeCustomField = WrikeCustomFieldDefinition;
export type WrikeTimelogCategory = { id: string; name?: string; title?: string; hidden?: boolean; order?: number; [key: string]: unknown };
