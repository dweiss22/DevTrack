import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { hasCapability } from "@/lib/auth/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  applyContextBindings,
  orderedQuestions,
  questionIsVisible,
  surveyDefinitionSchema,
  validateSurveyAnswers,
} from "@/lib/surveys/definition";
import { loadSurveyDetail, surveyDetailForSme } from "@/lib/surveys/server";
import { dispatchPendingSmeDebriefNotifications } from "@/lib/notifications/sme-debrief";

const idSchema = z.string().uuid();

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile, supabase } = await requireCapability("view_surveys");
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: "Survey is unavailable." }, { status: 404 });
  const { data: refresh, error: refreshError } = await supabase.rpc("refresh_sme_debrief_draft_context", {
    target_submission_id: id,
  });
  if (refreshError && refreshError.code !== "42501") {
    console.error("sme_debrief_context_refresh_failed", {
      submissionId: id, code: refreshError.code, message: refreshError.message,
    });
  }
  const refreshResult = refresh as { cleanupObjectKeys?: string[] } | null;
  if (refreshResult?.cleanupObjectKeys?.length) {
    await createAdminClient().storage.from("survey-invoices").remove(refreshResult.cleanupObjectKeys);
  }
  const detail = await loadSurveyDetail(supabase, id);
  if (!detail) return NextResponse.json({ error: "Survey is unavailable." }, { status: 404 });
  const { data: canEdit } = await supabase.rpc("can_edit_survey", { target_submission_id: id });
  if (!hasCapability(profile.access, "manage_surveys")) {
    const visibleDetail = profile.access.operationalRoles.includes("sme")
      && detail.submission.survey_type === "course_development_debrief"
      ? surveyDetailForSme(detail) : detail;
    return NextResponse.json({ ...visibleDetail, viewer: { role: profile.role, canEdit: Boolean(canEdit), canManage: false } });
  }
  const [audit, revisions, revisers, actors, notificationEvents, historicalImport] = await Promise.all([
    supabase.from("survey_audit_log").select("id,event_type,actor_id,actor_role,reason,previous_values,new_values,created_at").eq("submission_id", id).order("created_at", { ascending: false }),
    supabase.from("survey_revisions").select("id,revision_number,changed_fields,submitted_by,submitted_at").eq("submission_id", id).order("revision_number", { ascending: false }),
    supabase.from("application_users").select("id,display_name").eq("organization_id", profile.organization_id).eq("role", "id").order("display_name"),
    supabase.from("application_users").select("id,display_name").eq("organization_id", profile.organization_id),
    supabase.from("sme_debrief_notification_events").select("id,revision_number,created_at")
      .eq("submission_id", id).order("revision_number", { ascending: false }),
    supabase.from("survey_historical_import_integrations")
      .select("fingerprint,source_row_id,batch_id,integrated_at,row:survey_historical_import_rows!inner(row_number),batch:survey_historical_import_batches!inner(source_filename,source_timezone,file_checksum)")
      .eq("submission_id", id).is("rolled_back_at", null).order("integrated_at", { ascending: true }),
  ]);
  const eventIds = (notificationEvents.data ?? []).map((event) => event.id);
  const { data: notificationDeliveries } = eventIds.length
    ? await supabase.from("sme_debrief_notification_deliveries")
      .select("id,event_id,recipient_application_user_id,status,attempt_count,provider_message_id,last_error,delivered_at,next_attempt_at,updated_at")
      .in("event_id", eventIds).order("updated_at", { ascending: false })
    : { data: [] };
  const historicalIds = [...new Set([
    ...(audit.data ?? []).map((event) => event.actor_id),
    ...(revisions.data ?? []).map((revision) => revision.submitted_by),
  ])];
  const admin = createAdminClient();
  const { data: principals } = historicalIds.length
    ? await admin.from("application_user_principals").select("id,display_name,state")
      .eq("organization_id", profile.organization_id).in("id", historicalIds)
    : { data: [] };
  const actorNames = Object.fromEntries([
    ...(actors.data ?? []).map((actor) => [actor.id, actor.display_name ?? "Unnamed user"]),
    ...(principals ?? []).map((principal) => [
      principal.id,
      principal.state === "deleted" ? "Deleted user" : principal.display_name ?? "Unnamed user",
    ]),
  ]);
  return NextResponse.json({
    ...detail,
    viewer: { role: profile.role, canEdit: Boolean(canEdit), canManage: true },
    audit: (audit.data ?? []).map((event) => ({ ...event, actor_name: actorNames[event.actor_id] ?? "Deleted user" })),
    revisions: (revisions.data ?? []).map((revision) => ({ ...revision, submitted_by_name: actorNames[revision.submitted_by] ?? "Deleted user" })),
    revisers: revisers.data ?? [],
    actors: actorNames,
    notifications: (notificationDeliveries ?? []).map((delivery) => ({
      ...delivery,
      recipient_name: actorNames[delivery.recipient_application_user_id] ?? "Coordinator",
      revision_number: (notificationEvents.data ?? [])
        .find((event) => event.id === delivery.event_id)?.revision_number ?? null,
    })),
    historicalImport: historicalImport.data ?? [],
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile, supabase } = await requireCapability("view_surveys");
  const parsed = z.object({
    submit: z.boolean().default(false),
    answers: z.record(z.unknown()),
  }).safeParse(await request.json().catch(() => null));
  if (!idSchema.safeParse(id).success || !parsed.success) {
    return NextResponse.json({ error: "Review the highlighted survey fields." }, { status: 400 });
  }
  const detail = await loadSurveyDetail(supabase, id);
  const definition = surveyDefinitionSchema.safeParse(detail?.definition);
  if (!detail || !definition.success) return NextResponse.json({ error: "Survey is unavailable." }, { status: 404 });
  const answers = applyContextBindings(definition.data, parsed.data.answers, detail.submission.context_snapshot);
  const attachmentIds = new Set(detail.attachments.map((attachment) => attachment.question_id));
  const validation = validateSurveyAnswers(definition.data, answers, attachmentIds);
  if (parsed.data.submit && !validation.success) {
    return NextResponse.json({
      error: "Complete every required field before submitting.",
      fieldErrors: validation.errors,
    }, { status: 400 });
  }
  const draftErrors = Object.fromEntries(
    Object.entries(validation.errors).filter(([, message]) =>
      message !== "This field is required." && message !== "A file is required."),
  );
  if (!parsed.data.submit && Object.keys(draftErrors).length) {
    return NextResponse.json({
      error: "Review the highlighted survey fields before saving.",
      fieldErrors: draftErrors,
    }, { status: 400 });
  }
  // Persist only visible, schema-valid values even for drafts so changing a
  // conditional answer cannot leave hidden data behind.
  const nextAnswers = validation.answers;
  const hiddenFileQuestionIds = new Set(orderedQuestions(definition.data)
    .filter((question) => question.type === "file_upload" && !questionIsVisible(question, nextAnswers))
    .map((question) => question.id));
  let hiddenDraftObjectKeys: string[] = [];
  if (detail.submission.status === "draft" && hiddenFileQuestionIds.size) {
    const hiddenAttachmentIds = detail.attachments
      .filter((attachment) => hiddenFileQuestionIds.has(attachment.question_id))
      .map((attachment) => attachment.id);
    if (hiddenAttachmentIds.length) {
      const admin = createAdminClient();
      const { data: hiddenFiles } = await admin.from("survey_attachments")
        .select("object_key").in("id", hiddenAttachmentIds);
      hiddenDraftObjectKeys = (hiddenFiles ?? []).map((file) => file.object_key);
    }
  }
  const { data, error } = await supabase.rpc("survey_save_versioned", {
    target_submission_id: id,
    next_answers: nextAnswers,
    submit_now: parsed.data.submit,
  });
  if (error) {
    const configurationError = error.message?.includes("configured")
      || error.message?.includes("Reporting Year")
      || error.message?.includes("Wrike identity")
      || error.message?.includes("Wrike SME field");
    return NextResponse.json(
      { error: error.message || "The survey could not be saved." },
      { status: error.code === "42501" ? 403 : configurationError ? 409 : 400 },
    );
  }
  const saveResult = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown> : {};
  const cleanupObjectKeys = Array.isArray(saveResult.cleanupObjectKeys)
    ? saveResult.cleanupObjectKeys.filter((key): key is string => typeof key === "string") : [];
  if (cleanupObjectKeys.length) {
    await createAdminClient().storage.from("survey-invoices").remove(cleanupObjectKeys);
  }
  if (hiddenDraftObjectKeys.length) {
    await createAdminClient().storage.from("survey-invoices").remove(hiddenDraftObjectKeys);
  }
  if (parsed.data.submit
    && detail.submission.survey_type === "course_development_debrief"
    && profile.access.operationalRoles.includes("sme")) {
    const { data: receipt } = await createAdminClient().from("survey_submissions")
      .select("latest_submitted_at")
      .eq("id", id)
      .eq("organization_id", profile.organization_id)
      .eq("status", "submitted")
      .maybeSingle();
    await dispatchPendingSmeDebriefNotifications(10).catch((reason) => {
      console.error("sme_debrief_notification_dispatch_failed", {
        submissionId: id,
        message: reason instanceof Error ? reason.message : "Unknown notification failure",
      });
    });
    return NextResponse.json({
      ...saveResult,
      cleanupObjectKeys: undefined,
      submittedAt: receipt?.latest_submitted_at ?? null,
    });
  }
  return NextResponse.json(data);
}
