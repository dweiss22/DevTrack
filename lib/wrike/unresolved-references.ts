import type { createAdminClient } from "@/lib/supabase/admin";
import type { WrikeReferenceType, WrikeUnresolvedReferenceInput } from "@/lib/wrike/reference-resolution";

type AdminClient = ReturnType<typeof createAdminClient>;

function uniqueJson<T>(items: T[], limit: number) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}

export async function upsertUnresolvedWrikeReferences(db: AdminClient, organizationId: string, inputs: readonly WrikeUnresolvedReferenceInput[], encounteredAt: string) {
  const grouped = new Map<string, WrikeUnresolvedReferenceInput>();
  for (const input of inputs.filter((item) => item.wrikeId)) {
    const key = `${input.referenceType}:${input.wrikeId}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.occurrenceCount = (existing.occurrenceCount ?? 1) + (input.occurrenceCount ?? 1);
      existing.sampleValues = uniqueJson([...(existing.sampleValues ?? []), ...(input.sampleValues ?? [])], 5);
      existing.relatedRecords = uniqueJson([...(existing.relatedRecords ?? []), ...(input.relatedRecords ?? [])], 10);
      existing.attempted = existing.attempted || input.attempted;
      existing.lastError = input.lastError ?? existing.lastError;
    } else grouped.set(key, { ...input, occurrenceCount: input.occurrenceCount ?? 1 });
  }
  if (!grouped.size) return { unresolvedCount: 0 };
  const { data: existingRows, error: loadError } = await db.from("wrike_unresolved_references")
    .select("reference_type,wrike_id,occurrence_count,resolution_attempts,sample_values,related_records")
    .eq("organization_id", organizationId);
  if (loadError) throw new Error(`Supabase could not load unresolved Wrike references: ${loadError.message}`);
  const existingByKey = new Map((existingRows ?? []).map((row) => [`${row.reference_type}:${row.wrike_id}`, row]));
  const rows = [...grouped.entries()].map(([key, input]) => {
    const existing = existingByKey.get(key);
    return {
      organization_id: organizationId,
      reference_type: input.referenceType,
      wrike_id: input.wrikeId,
      sample_values: uniqueJson([...(existing?.sample_values ?? []), ...(input.sampleValues ?? [])], 5),
      related_records: uniqueJson([...(existing?.related_records ?? []), ...(input.relatedRecords ?? [])], 10),
      occurrence_count: (existing?.occurrence_count ?? 0) + (input.occurrenceCount ?? 1),
      resolution_attempts: (existing?.resolution_attempts ?? 0) + (input.attempted ? 1 : 0),
      last_encountered_at: encounteredAt,
      last_attempted_at: input.attempted ? encounteredAt : null,
      last_error: input.lastError ?? null,
      resolution_status: "unresolved",
      resolved_at: null,
      updated_at: encounteredAt
    };
  });
  const { error } = await db.from("wrike_unresolved_references").upsert(rows, { onConflict: "organization_id,reference_type,wrike_id" });
  if (error) throw new Error(`Supabase could not save unresolved Wrike references: ${error.message}`);
  return { unresolvedCount: rows.length };
}

export async function markResolvedWrikeReferences(
  db: AdminClient,
  organizationId: string,
  references: readonly { referenceType: WrikeReferenceType; wrikeId: string; ignored?: boolean; manualMappingId?: string | null }[],
  resolvedAt: string
) {
  const ordinaryReferences = new Map<WrikeReferenceType, Set<string>>();
  const exceptionalReferences: typeof references[number][] = [];
  for (const reference of references) {
    if (reference.ignored || reference.manualMappingId) {
      exceptionalReferences.push(reference);
      continue;
    }
    const ids = ordinaryReferences.get(reference.referenceType) ?? new Set<string>();
    ids.add(reference.wrikeId);
    ordinaryReferences.set(reference.referenceType, ids);
  }

  for (const [referenceType, ids] of ordinaryReferences) {
    const wrikeIds = [...ids];
    for (let offset = 0; offset < wrikeIds.length; offset += 250) {
      const chunk = wrikeIds.slice(offset, offset + 250);
      const { error } = await db.from("wrike_unresolved_references").update({
        resolution_status: "resolved",
        resolved_at: resolvedAt,
        manual_mapping_id: null,
        last_error: null,
        updated_at: resolvedAt
      }).eq("organization_id", organizationId).eq("reference_type", referenceType).in("wrike_id", chunk);
      if (error) throw new Error(`Supabase could not resolve ${referenceType} references: ${error.message}`);
    }
  }

  for (const reference of exceptionalReferences) {
    const { error } = await db.from("wrike_unresolved_references").update({
      resolution_status: reference.ignored ? "ignored" : "resolved",
      resolved_at: resolvedAt,
      manual_mapping_id: reference.manualMappingId ?? null,
      last_error: null,
      updated_at: resolvedAt
    }).eq("organization_id", organizationId).eq("reference_type", reference.referenceType).eq("wrike_id", reference.wrikeId);
    if (error) throw new Error(`Supabase could not resolve ${reference.referenceType} ${reference.wrikeId}: ${error.message}`);
  }
}
