import { z } from "zod";
import type {
  WrikeCustomFieldDefinition,
  WrikeCustomFieldsResponse,
  WrikeFolderDefinition,
  WrikeFolderTreeResponse,
  WrikeTask
} from "@/lib/wrike/types";
import { mergeNormalizedCustomFields, type NormalizedCustomFieldValue } from "@/lib/wrike/custom-field-normalization";
import { scopedWrikeFolderIds } from "@/lib/wrike/selected-folders";

const folderProjectSchema = z.object({
  authorId: z.string().optional(),
  ownerIds: z.array(z.string()).optional(),
  status: z.string().optional(),
  customStatusId: z.string().optional(),
  createdDate: z.string().optional()
}).passthrough();

const folderDefinitionSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  childIds: z.array(z.string()),
  scope: z.string().min(1),
  project: folderProjectSchema.optional()
}).passthrough();

export const wrikeFolderTreeResponseSchema = z.object({
  kind: z.string().min(1),
  data: z.array(folderDefinitionSchema)
}).passthrough();

const customFieldOptionSchema = z.object({
  value: z.string(),
  color: z.string().optional()
}).passthrough();

const customFieldSettingsSchema = z.object({
  inheritanceType: z.string().optional(),
  applicableEntityTypes: z.array(z.string()).optional(),
  values: z.array(z.string()).optional(),
  options: z.array(customFieldOptionSchema).optional(),
  optionColorsEnabled: z.boolean().optional(),
  allowOtherValues: z.boolean().optional(),
  readOnly: z.boolean().optional(),
  allowTime: z.boolean().optional()
}).passthrough();

const customFieldDefinitionSchema = z.object({
  id: z.string().min(1),
  accountId: z.string().optional(),
  title: z.string(),
  type: z.string().min(1),
  spaceId: z.string().optional(),
  sharedIds: z.array(z.string()).optional(),
  sharing: z.record(z.unknown()).optional(),
  settings: customFieldSettingsSchema.optional(),
  description: z.string().optional(),
  archived: z.boolean().optional()
}).passthrough();

export const wrikeCustomFieldsResponseSchema = z.object({
  kind: z.string().min(1),
  data: z.array(customFieldDefinitionSchema)
}).passthrough();

export function parseFolderTreeResponse(payload: unknown): WrikeFolderTreeResponse {
  return wrikeFolderTreeResponseSchema.parse(payload) as WrikeFolderTreeResponse;
}

export function parseCustomFieldsResponse(payload: unknown): WrikeCustomFieldsResponse {
  return wrikeCustomFieldsResponseSchema.parse(payload) as WrikeCustomFieldsResponse;
}

export function buildCustomFieldsPath(title?: string) {
  const url = new URL("/customfields", "https://wrike.invalid");
  if (title) url.searchParams.set("title", title);
  return `${url.pathname}${url.search}`;
}

export function buildFolderDefinitionsById(definitions: WrikeFolderDefinition[]) {
  return new Map(definitions.map((folder) => [folder.id, folder]));
}

export function buildCustomFieldDefinitionsById(definitions: WrikeCustomFieldDefinition[]) {
  return new Map(definitions.map((field) => [field.id, field]));
}

export function isLctCustomField(field: WrikeCustomFieldDefinition) {
  const title = field.title.trim().toLocaleLowerCase();
  return title === "lct" || title.startsWith("lct ") || title.startsWith("[lct]");
}

export function resolveCustomFieldDisplayValue(rawValue: unknown, definition?: WrikeCustomFieldDefinition): unknown {
  if (!definition || rawValue == null) return rawValue;
  const configuredValues = new Set([
    ...(definition.settings?.values ?? []),
    ...(definition.settings?.options ?? []).map((option) => option.value)
  ]);
  if (typeof rawValue === "string") return configuredValues.has(rawValue) ? rawValue : rawValue;
  if (Array.isArray(rawValue)) return rawValue.map((value) => typeof value === "string" && configuredValues.has(value) ? value : value);
  return rawValue;
}

export type ResolvedFolder = { id: string; title: string; scope: string | null; resolved: boolean };
export type ResolvedCustomField = { id: string; title: string; type: string | null; rawValue: unknown; displayValue: unknown; resolved: boolean; ignored?: boolean; normalizedTitleOverride?: string | null; resolutionSource?: "database" | "manual_mapping" | "unresolved" };
export type EnrichedTaskMetadata = { folderIds: string[]; folders: ResolvedFolder[]; folderNames: string[]; customFields: ResolvedCustomField[]; customFieldsNormalized: NormalizedCustomFieldValue[] };

export function enrichTaskMetadata(
  task: WrikeTask,
  folderDefinitionsById: Map<string, WrikeFolderDefinition>,
  customFieldDefinitionsById: Map<string, WrikeCustomFieldDefinition>,
  manualMappings: Map<string, { action: "map_existing" | "create_new" | "ignore"; normalizedTitle: string | null }> = new Map()
): EnrichedTaskMetadata {
  const folderIds = scopedWrikeFolderIds(task.parentIds);
  const folders = folderIds.map((id) => {
    const definition = folderDefinitionsById.get(id);
    return { id, title: definition?.title ?? id, scope: definition?.scope ?? null, resolved: Boolean(definition) };
  });
  const customFields = (task.customFields ?? []).map((field) => {
    const definition = customFieldDefinitionsById.get(field.id);
    const mapping = manualMappings.get(field.id);
    return {
      id: field.id,
      title: definition?.title ?? field.id,
      type: definition?.type ?? null,
      rawValue: field.value,
      displayValue: resolveCustomFieldDisplayValue(field.value, definition),
      resolved: Boolean(definition) || Boolean(mapping && mapping.action !== "ignore"),
      ignored: mapping?.action === "ignore",
      normalizedTitleOverride: mapping?.normalizedTitle ?? null,
      resolutionSource: mapping ? "manual_mapping" as const : definition ? "database" as const : "unresolved" as const
    };
  });
  return { folderIds, folders, folderNames: folders.filter((folder) => folder.resolved).map((folder) => folder.title), customFields, customFieldsNormalized: mergeNormalizedCustomFields(customFields) };
}
