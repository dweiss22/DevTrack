import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateInvoiceFile } from "@/lib/surveys/domain";

const idSchema = z.string().uuid();

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, actor, identity, profile, supabase } = await requireCapability("view_surveys");
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: "Survey is unavailable." }, { status: 404 });
  const [{ data: canEdit }, { data: submission }] = await Promise.all([
    supabase.rpc("can_edit_survey", { target_submission_id: id }),
    supabase.from("survey_submissions").select("id,organization_id,survey_type,revision_number").eq("id", id).maybeSingle(),
  ]);
  if (!canEdit || !submission || submission.survey_type !== "course_development_debrief") {
    return NextResponse.json({ error: "Survey is unavailable." }, { status: 404 });
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("invoice");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose an invoice file." }, { status: 400 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const validationError = validateInvoiceFile(file.name, file.type || "application/octet-stream", bytes);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

  const safeName = file.name.normalize("NFKC").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-120);
  const objectKey = `${profile.organization_id}/${id}/${submission.revision_number}/${crypto.randomUUID()}-${safeName}`;
  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage.from("survey-invoices").upload(objectKey, bytes, {
    contentType: file.type,
    upsert: false,
  });
  if (uploadError) return NextResponse.json({ error: "The invoice could not be uploaded." }, { status: 500 });

  const { data: previous } = await admin.from("survey_attachments").select("id,object_key,original_filename")
    .eq("submission_id", id).eq("revision_number", submission.revision_number).eq("is_active", true);
  if (previous?.length) {
    await admin.from("survey_attachments").update({ is_active: false, removed_by: user.id, removed_at: new Date().toISOString() })
      .in("id", previous.map((item) => item.id));
  }
  const { data: created, error: metadataError } = await admin.from("survey_attachments").insert({
    submission_id: id,
    organization_id: profile.organization_id,
    revision_number: submission.revision_number,
    original_filename: file.name,
    object_key: objectKey,
    mime_type: file.type,
    size_bytes: bytes.length,
    uploaded_by: user.id,
  }).select("id,original_filename,mime_type,size_bytes,uploaded_at").single();
  if (metadataError) {
    await admin.storage.from("survey-invoices").remove([objectKey]);
    if (previous?.length) {
      await admin.from("survey_attachments").update({ is_active: true, removed_by: null, removed_at: null })
        .in("id", previous.map((item) => item.id));
    }
    return NextResponse.json({ error: "The invoice metadata could not be saved." }, { status: 500 });
  }
  if (previous?.length) {
    await admin.storage.from("survey-invoices").remove(previous.map((item) => item.object_key));
  }
  await admin.from("survey_audit_log").insert({
    submission_id: id,
    organization_id: profile.organization_id,
    event_type: previous?.length ? "invoice_replaced" : "invoice_uploaded",
    actor_id: user.id,
    authenticated_actor_id: actor.id,
    actor_role: profile.role,
    operational_persona_role: identity.operationalPersonaRole ?? null,
    previous_values: previous?.length ? { filenames: previous.map((item) => item.original_filename) } : {},
    new_values: { filename: file.name, mimeType: file.type, size: bytes.length },
  });
  await supabase.rpc("record_impersonated_external_mutation", {
    target_relation_name: "public.survey_attachments",
    target_operation: "INSERT",
    target_record_identifier: created.id,
  });
  return NextResponse.json({ attachment: created });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, actor, identity, profile, supabase } = await requireCapability("view_surveys");
  const parsed = z.object({ attachmentId: z.string().uuid() }).safeParse(await request.json().catch(() => null));
  if (!idSchema.safeParse(id).success || !parsed.success) return NextResponse.json({ error: "Invoice is unavailable." }, { status: 404 });
  const { data: canEdit } = await supabase.rpc("can_edit_survey", { target_submission_id: id });
  if (!canEdit) return NextResponse.json({ error: "Invoice is unavailable." }, { status: 404 });
  const admin = createAdminClient();
  const { data: attachment } = await admin.from("survey_attachments").select("id,object_key,original_filename")
    .eq("id", parsed.data.attachmentId).eq("submission_id", id).eq("organization_id", profile.organization_id).eq("is_active", true).maybeSingle();
  if (!attachment) return NextResponse.json({ error: "Invoice is unavailable." }, { status: 404 });
  await admin.storage.from("survey-invoices").remove([attachment.object_key]);
  const { error } = await admin.from("survey_attachments").update({
    is_active: false, removed_by: user.id, removed_at: new Date().toISOString(),
  }).eq("id", attachment.id);
  if (error) return NextResponse.json({ error: "The invoice could not be removed." }, { status: 500 });
  await admin.from("survey_audit_log").insert({
    submission_id: id, organization_id: profile.organization_id, event_type: "invoice_removed",
    actor_id: user.id, authenticated_actor_id: actor.id, actor_role: profile.role,
    operational_persona_role: identity.operationalPersonaRole ?? null,
    previous_values: { filename: attachment.original_filename },
  });
  await supabase.rpc("record_impersonated_external_mutation", {
    target_relation_name: "public.survey_attachments",
    target_operation: "DELETE",
    target_record_identifier: attachment.id,
  });
  return NextResponse.json({ ok: true });
}
