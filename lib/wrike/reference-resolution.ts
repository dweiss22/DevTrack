export type WrikeResolutionSource =
  | "database"
  | "wrike_api"
  | "manual_mapping"
  | "configured_fallback"
  | "historical"
  | "unresolved";

export type ResolvedWrikeReference<T> = {
  id: string;
  resolved: boolean;
  value: T | null;
  fallbackLabel: string;
  resolutionSource: WrikeResolutionSource;
  lastResolvedAt: string | null;
};

export type WrikeReferenceType =
  | "custom_field"
  | "user"
  | "custom_status"
  | "workflow"
  | "folder"
  | "space"
  | "timelog_category";

export type WrikeUnresolvedReferenceInput = {
  referenceType: WrikeReferenceType;
  wrikeId: string;
  occurrenceCount?: number;
  sampleValues?: unknown[];
  relatedRecords?: { type: string; id: string }[];
  lastError?: string | null;
  attempted?: boolean;
};

export const UNRESOLVED_REFERENCE_MESSAGES: Record<WrikeReferenceType, string> = {
  custom_field: "The name of this Wrike field could not be identified. Its Wrike ID is being shown temporarily. This field can be mapped or corrected later.",
  user: "This Wrike user could not be identified. The Wrike user ID is being shown temporarily and will be resolved during a future data sync.",
  custom_status: "The name and classification of this Wrike status could not be identified. Its Wrike custom status ID is being shown temporarily.",
  workflow: "This Wrike workflow could not be identified. Its Wrike ID is being shown temporarily.",
  folder: "This Wrike folder could not be identified. Its Wrike ID is being shown temporarily.",
  space: "This Wrike space could not be identified. Its Wrike ID is being shown temporarily.",
  timelog_category: "This Wrike timelog category could not be identified. Its Wrike ID is being shown temporarily."
};

export function unresolvedWrikeReference<T>(id: string): ResolvedWrikeReference<T> {
  return { id, resolved: false, value: null, fallbackLabel: id, resolutionSource: "unresolved", lastResolvedAt: null };
}

export function resolvedWrikeReference<T>(
  id: string,
  value: T,
  options: { source?: WrikeResolutionSource; lastResolvedAt?: string | null; fallbackLabel?: string } = {}
): ResolvedWrikeReference<T> {
  return {
    id,
    resolved: true,
    value,
    fallbackLabel: options.fallbackLabel ?? id,
    resolutionSource: options.source ?? "database",
    lastResolvedAt: options.lastResolvedAt ?? null
  };
}

type ReferenceCandidate<T> = { value: T; lastResolvedAt?: string | null };

export function resolveWrikeReferenceByPrecedence<T>(
  id: string,
  candidates: {
    manualMapping?: ReferenceCandidate<T> | null;
    synchronized?: ReferenceCandidate<T> | null;
    historical?: ReferenceCandidate<T> | null;
    configuredFallback?: ReferenceCandidate<T> | null;
  }
): ResolvedWrikeReference<T> {
  if (candidates.manualMapping) return resolvedWrikeReference(id, candidates.manualMapping.value, { source: "manual_mapping", lastResolvedAt: candidates.manualMapping.lastResolvedAt });
  if (candidates.synchronized) return resolvedWrikeReference(id, candidates.synchronized.value, { source: "database", lastResolvedAt: candidates.synchronized.lastResolvedAt });
  if (candidates.historical) return resolvedWrikeReference(id, candidates.historical.value, { source: "historical", lastResolvedAt: candidates.historical.lastResolvedAt });
  if (candidates.configuredFallback) return resolvedWrikeReference(id, candidates.configuredFallback.value, { source: "configured_fallback", lastResolvedAt: candidates.configuredFallback.lastResolvedAt });
  return unresolvedWrikeReference<T>(id);
}

export function referenceLabel<T>(reference: ResolvedWrikeReference<T>, getLabel: (value: T) => string) {
  return reference.resolved && reference.value ? getLabel(reference.value) : reference.fallbackLabel;
}

export function isWrikeEntityId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z0-9]{8}$/.test(value);
}

export function uniqueWrikeIds(values: Iterable<unknown>) {
  return [...new Set([...values].filter(isWrikeEntityId))];
}
