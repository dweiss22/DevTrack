import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { normalizeWrikeCustomFieldTitle } from "@/lib/wrike/custom-field-normalization";
import { rebuildNormalizedCustomFieldsFromRaw } from "@/lib/wrike/custom-field-rebuild";
import { createAdminClient } from "@/lib/supabase/admin";
import { markResolvedWrikeReferences, upsertUnresolvedWrikeReferences } from "@/lib/wrike/unresolved-references";

const mappingSchema = z.object({
  wrikeFieldId: z.string().min(1).max(256),
  action: z.enum(["map_existing", "create_new", "ignore"]),
  targetNormalizedFieldId: z.string().uuid().optional(),
  newTitle: z.string().trim().min(1).max(200).optional()
}).superRefine((value, context) => {
  if (value.action === "map_existing" && !value.targetNormalizedFieldId) context.addIssue({ code: "custom", message: "Select an existing normalized field." });
  if (value.action === "create_new" && !value.newTitle) context.addIssue({ code: "custom", message: "Enter a normalized field title." });
});

async function claimLease(db: ReturnType<typeof createAdminClient>, organizationId: string) {
  const token = crypto.randomUUID();
  const { data, error } = await db.rpc("claim_wrike_sync_lease", { target_organization_id: organizationId, target_token: token, lease_minutes: 10 });
  if (error) throw new Error(`Unable to acquire the mapping lock: ${error.message}`);
  if (!data) throw new Error("A Wrike import or mapping rebuild is already running.");
  return token;
}

export async function POST(request: NextRequest) {
  const { user, profile } = await requireAdmin();
  const parsed = mappingSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid custom-field mapping." }, { status: 400 });
  const db = createAdminClient();
  const { data: field } = await db.from("wrike_custom_fields").select("id,wrike_id").eq("organization_id", profile.organization_id).eq("wrike_id", parsed.data.wrikeFieldId).maybeSingle();
  if (!field) return NextResponse.json({ error: "The Wrike custom field is outside this organization." }, { status: 404 });
  let targetId = parsed.data.targetNormalizedFieldId ?? null;
  let manualLabel = parsed.data.newTitle ?? null;
  if (parsed.data.action === "map_existing") {
    const { data: target } = await db.from("wrike_normalized_custom_fields").select("id,title").eq("organization_id", profile.organization_id).eq("id", targetId).maybeSingle();
    if (!target) return NextResponse.json({ error: "The normalized field is outside this organization." }, { status: 400 });
    manualLabel = target.title;
  }
  const leaseToken = await claimLease(db, profile.organization_id).catch(() => null as string | null);
  if (!leaseToken) return NextResponse.json({ error: "A Wrike import or mapping rebuild is already running." }, { status: 409 });
  try {
    const now = new Date().toISOString();
    if (parsed.data.action === "create_new") {
      const normalized = normalizeWrikeCustomFieldTitle(parsed.data.newTitle!);
      const { data: target, error } = await db.from("wrike_normalized_custom_fields").upsert({
        organization_id: profile.organization_id,
        normalized_key: normalized.normalizedKey,
        title: normalized.normalizedTitle,
        updated_at: now
      }, { onConflict: "organization_id,normalized_key" }).select("id,title").single();
      if (error || !target) return NextResponse.json({ error: "Unable to create the normalized field." }, { status: 500 });
      targetId = target.id;
      manualLabel = target.title;
    }
    const { data: mapping, error } = await db.from("wrike_manual_mappings").upsert({
      organization_id: profile.organization_id,
      reference_type: "custom_field",
      wrike_id: parsed.data.wrikeFieldId,
      action: parsed.data.action,
      target_normalized_field_id: targetId,
      manual_label: manualLabel,
      reprocess_status: "pending",
      reprocess_error: null,
      created_by: user.id,
      updated_by: user.id,
      updated_at: now
    }, { onConflict: "organization_id,reference_type,wrike_id" }).select("id").single();
    if (error || !mapping) throw new Error(error?.message ?? "Unable to save the mapping.");
    await db.from("wrike_custom_fields").update({ has_manual_mapping: true, is_unresolved: false, updated_at: now }).eq("id", field.id);
    try {
      const result = await rebuildNormalizedCustomFieldsFromRaw(db, profile.organization_id, parsed.data.wrikeFieldId);
      await db.from("wrike_manual_mappings").update({ reprocess_status: "succeeded", reprocess_error: null, updated_at: result.rebuiltAt }).eq("id", mapping.id);
      await markResolvedWrikeReferences(db, profile.organization_id, [{ referenceType: "custom_field", wrikeId: parsed.data.wrikeFieldId, ignored: parsed.data.action === "ignore", manualMappingId: mapping.id }], result.rebuiltAt);
      return NextResponse.json({ ok: true, mappingId: mapping.id, ...result });
    } catch (rebuildError) {
      const message = rebuildError instanceof Error ? rebuildError.message : "Custom-field reprocessing failed.";
      await db.from("wrike_manual_mappings").update({ reprocess_status: "failed", reprocess_error: message.slice(0, 500), updated_at: now }).eq("id", mapping.id);
      return NextResponse.json({ error: message, mappingSaved: true }, { status: 500 });
    }
  } finally {
    await db.rpc("release_wrike_sync_lease", { target_organization_id: profile.organization_id, target_token: leaseToken });
  }
}

export async function DELETE(request: NextRequest) {
  const { profile } = await requireAdmin();
  const parsed = z.object({ wrikeFieldId: z.string().min(1).max(256) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid custom-field mapping." }, { status: 400 });
  const db = createAdminClient();
  const leaseToken = await claimLease(db, profile.organization_id).catch(() => null);
  if (!leaseToken) return NextResponse.json({ error: "A Wrike import or mapping rebuild is already running." }, { status: 409 });
  try {
    const { data: field } = await db.from("wrike_custom_fields").select("id,original_title").eq("organization_id", profile.organization_id).eq("wrike_id", parsed.data.wrikeFieldId).maybeSingle();
    if (!field) return NextResponse.json({ error: "The Wrike custom field is outside this organization." }, { status: 404 });
    const { error } = await db.from("wrike_manual_mappings").delete().eq("organization_id", profile.organization_id).eq("reference_type", "custom_field").eq("wrike_id", parsed.data.wrikeFieldId);
    if (error) return NextResponse.json({ error: "Unable to remove the custom-field mapping." }, { status: 500 });
    const unresolved = !field.original_title;
    await db.from("wrike_custom_fields").update({ has_manual_mapping: false, is_unresolved: unresolved, updated_at: new Date().toISOString() }).eq("id", field.id);
    const result = await rebuildNormalizedCustomFieldsFromRaw(db, profile.organization_id, parsed.data.wrikeFieldId);
    if (unresolved) await upsertUnresolvedWrikeReferences(db, profile.organization_id, [{ referenceType: "custom_field", wrikeId: parsed.data.wrikeFieldId, lastError: "The manual mapping was removed and no Wrike definition is available." }], result.rebuiltAt);
    return NextResponse.json({ ok: true, ...result });
  } finally {
    await db.rpc("release_wrike_sync_lease", { target_organization_id: profile.organization_id, target_token: leaseToken });
  }
}
