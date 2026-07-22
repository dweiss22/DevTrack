import { normalizeVerticalValue, type NormalizedVerticalResult } from "@/lib/wrike/vertical-normalization";

export const CUSTOM_FIELD_TITLE_ALIASES = {
  "authoring tool used": "Authoring Tool",
  "course development type": "Course Type",
  "primary product area": "Product Area"
} as const;

export type CustomFieldSourceDesignation = "M" | "L" | null;

export type NormalizedCustomFieldTitle = {
  normalizedTitle: string;
  normalizedKey: string;
  sourceDesignation: CustomFieldSourceDesignation;
};

export type CustomFieldNormalizationSource = {
  id: string;
  title: string;
  type: string | null;
  rawValue: unknown;
  displayValue: unknown;
  resolved: boolean;
  ignored?: boolean;
  normalizedTitleOverride?: string | null;
};

export type NormalizedCustomFieldSource = {
  wrikeFieldId: string;
  originalTitle: string;
  sourceDesignation: CustomFieldSourceDesignation;
  rawValue: unknown;
  displayValue: unknown;
  displayValues: string[];
};

export type NormalizedCustomFieldValue = {
  normalizedKey: string;
  normalizedTitle: string;
  displayValues: string[];
  sourceFieldIds: string[];
  sourceTitles: string[];
  sources: NormalizedCustomFieldSource[];
  conflict: boolean;
  conflictMetadata: { distinctValueSets: { wrikeFieldId: string; values: string[] }[] } | null;
  verticalNormalization?: NormalizedVerticalResult;
};

const collapseWhitespace = (value: string) => value.trim().replace(/\s+/g, " ");

export function normalizeWrikeCustomFieldTitle(title: string): NormalizedCustomFieldTitle {
  const original = collapseWhitespace(title);
  let normalized = original.replace(/^\[lct\]\s*/i, "");
  const sourceMatch = normalized.match(/\s*\(([ml])\)\s*$/i);
  const sourceDesignation = sourceMatch ? sourceMatch[1].toUpperCase() as "M" | "L" : null;
  if (sourceMatch) normalized = normalized.slice(0, sourceMatch.index);
  normalized = collapseWhitespace(normalized) || original;
  const alias = CUSTOM_FIELD_TITLE_ALIASES[normalized.toLocaleLowerCase() as keyof typeof CUSTOM_FIELD_TITLE_ALIASES];
  const normalizedTitle = alias ?? normalized;
  return { normalizedTitle, normalizedKey: normalizedTitle.toLocaleLowerCase(), sourceDesignation };
}

export function customFieldDisplayValues(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return uniqueDisplayValues(value.flatMap(customFieldDisplayValues));
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  return [JSON.stringify(value)];
}

function valueSetSignature(values: string[]) {
  return JSON.stringify(uniqueDisplayValues(values).map((value) => value.toLocaleLowerCase()).sort());
}

function uniqueDisplayValues(values: readonly string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function mergeNormalizedCustomFields(fields: readonly CustomFieldNormalizationSource[]): NormalizedCustomFieldValue[] {
  const grouped = new Map<string, { title: string; sources: NormalizedCustomFieldSource[] }>();
  for (const field of fields.filter((item) => item.resolved && !item.ignored)) {
    const title = normalizeWrikeCustomFieldTitle(field.normalizedTitleOverride ?? field.title);
    const source: NormalizedCustomFieldSource = {
      wrikeFieldId: field.id,
      originalTitle: field.title,
      sourceDesignation: title.sourceDesignation,
      rawValue: field.rawValue,
      displayValue: field.displayValue,
      displayValues: customFieldDisplayValues(field.displayValue)
    };
    const group = grouped.get(title.normalizedKey);
    if (group) group.sources.push(source);
    else grouped.set(title.normalizedKey, { title: title.normalizedTitle, sources: [source] });
  }
  return [...grouped.entries()].map(([normalizedKey, group]) => {
    const verticalSources = normalizedKey === "vertical"
      ? group.sources.map((source) => ({ ...source, displayValues: normalizeVerticalValue(source.displayValue).normalizedVerticals }))
      : group.sources;
    const populated = verticalSources.filter((source) => source.displayValues.length > 0);
    const distinctSignatures = new Set(populated.map((source) => valueSetSignature(source.displayValues)));
    const conflict = distinctSignatures.size > 1;
    const verticalNormalization = normalizedKey === "vertical"
      ? normalizeVerticalValue(group.sources.length === 1 ? group.sources[0].displayValue : group.sources.map((source) => source.displayValue))
      : undefined;
    const displayValues = verticalNormalization?.normalizedVerticals
      ?? uniqueDisplayValues(populated.flatMap((source) => source.displayValues));
    return {
      normalizedKey,
      normalizedTitle: group.title,
      displayValues,
      sourceFieldIds: group.sources.map((source) => source.wrikeFieldId),
      sourceTitles: group.sources.map((source) => source.originalTitle),
      sources: group.sources,
      conflict,
      conflictMetadata: conflict ? { distinctValueSets: populated.map((source) => ({ wrikeFieldId: source.wrikeFieldId, values: source.displayValues })) } : null,
      verticalNormalization
    };
  });
}
