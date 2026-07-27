import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateInvoiceFile } from "@/lib/surveys/domain";
import { orderedQuestions, surveyDefinitionSchema } from "@/lib/surveys/definition";

const idSchema = z.string().uuid();
export type SurveyAttachmentRouteContext = { params: Promise<{ id: string }> };

export async function handleAttachmentPost(
  request: NextRequest,
  { params }: SurveyAttachmentRouteContext,
  options: { fileField?: string; forcedQuestionId?: string } = {},
) {
  const { id } = await params;
  const { profile, supabase } = await requireCapability("view_surveys");
  if (!idSchema.safeParse(id).success) return unavailable();
  const [{ data: canEdit }, { data: submission }] = await Promise.all([
    supabase.rpc("can_edit_survey", { target_submission_id: id }),
    supabase.from("survey_submissions").select("id,organization_id,status,revision_number,definition_snapshot").eq("id", id).maybeSingle(),
  ]);
  if (!canEdit || !submission) return unavailable();
  const definition = surveyDefinitionSchema.safeParse(submission.definition_snapshot);
  const form = await request.formData().catch(() => null);
  const questionId = options.forcedQuestionId ?? String(form?.get("questionId") ?? "");
  const file = form?.get(options.fileField ?? "file");
  const question = definition.success
    ? orderedQuestions(definition.data).find((item) => item.id === questionId && item.type === "file_upload")
    : null;
  if (!question || !(file instanceof File)) {
    return NextResponse.json({ error: "Choose an available survey file." }, { status: 400 });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > (question.validation.maxSizeBytes ?? 10 * 1024 * 1024)) {
    return NextResponse.json({ error: "The file is larger than this question permits." }, { status: 400 });
  }
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (question.validation.allowedExtensions?.length && !question.validation.allowedExtensions.includes(extension as never)) {
    return NextResponse.json({ error: "Use one of the file types allowed for this question." }, { status: 400 });
  }
  const validationError = validateInvoiceFile(file.name, file.type || "application/octet-stream", bytes);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
  const safeName = file.name.normalize("NFKC").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-120);
  const objectKey = `${profile.organization_id}/${id}/${submission.revision_number}/${questionId}/${crypto.randomUUID()}-${safeName}`;
  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage.from("survey-invoices").upload(objectKey, bytes, {
    contentType: file.type, upsert: false,
  });
  if (uploadError) return NextResponse.json({ error: "The file could not be uploaded." }, { status: 500 });
  const { data: metadata, error: metadataError } = await supabase.rpc("survey_register_attachment", {
    target_submission_id: id,
    target_question_id: questionId,
    target_object_key: objectKey,
    target_original_filename: file.name,
    target_mime_type: file.type || "application/octet-stream",
    target_extension: extension,
    target_size_bytes: bytes.length,
  });
  if (metadataError) {
    await admin.storage.from("survey-invoices").remove([objectKey]);
    return NextResponse.json({ error: "The file metadata could not be saved." }, { status: 500 });
  }
  const result = metadata as {
    attachment: {
      id: string; question_id: string; original_filename: string;
      mime_type: string; size_bytes: number; uploaded_at: string;
    };
    previousDraftObjectKeys?: string[];
  };
  if (result.previousDraftObjectKeys?.length) {
    await admin.storage.from("survey-invoices").remove(result.previousDraftObjectKeys);
  }
  await supabase.rpc("record_impersonated_external_mutation", {
    target_relation_name: "public.survey_attachments", target_operation: "INSERT",
    target_record_identifier: result.attachment.id,
  });
  return NextResponse.json({ attachment: result.attachment });
}

export async function handleAttachmentDelete(
  request: NextRequest,
  { params }: SurveyAttachmentRouteContext,
) {
  const { id } = await params;
  const { supabase } = await requireCapability("view_surveys");
  const parsed = z.object({ attachmentId: z.string().uuid() }).safeParse(await request.json().catch(() => null));
  if (!idSchema.safeParse(id).success || !parsed.success) return unavailable();
  const { data, error } = await supabase.rpc("survey_remove_attachment", {
    target_submission_id: id,
    target_attachment_id: parsed.data.attachmentId,
  });
  if (error || !data) return unavailable();
  const result = data as { id: string; draftObjectKey?: string | null };
  if (result.draftObjectKey) {
    const admin = createAdminClient();
    await admin.storage.from("survey-invoices").remove([result.draftObjectKey]);
  }
  await supabase.rpc("record_impersonated_external_mutation", {
    target_relation_name: "public.survey_attachments", target_operation: "DELETE",
    target_record_identifier: result.id,
  });
  return NextResponse.json({ ok: true });
}

function unavailable() {
  return NextResponse.json({ error: "Survey is unavailable." }, { status: 404 });
}
