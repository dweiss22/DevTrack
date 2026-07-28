import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const inputSchema = z.object({
  matchedTaskId: z.string().uuid().optional(),
  respondentPrincipalId: z.string().uuid().optional(),
  reviewedWrikeUserId: z.string().uuid().optional(),
  historicalWrikeUserId: z.string().uuid().optional(),
  historicalRole: z.enum(["id", "sme"]).optional(),
  correctedAnswers: z.record(z.unknown()).optional(),
  confirmAssignment: z.boolean().optional(),
  repeatResolution: z.enum(["retain", "revision"]).optional(),
  revisionOrder: z.number().int().positive().optional(),
  ignoreReason: z.string().trim().min(3).max(2_000).optional(),
}).refine((value) => !value.historicalWrikeUserId || value.historicalRole, {
  message: "Select the historical operational role.",
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile, user, supabase } = await requireCapability("manage_data");
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) {
    return NextResponse.json({ error: parsed.error?.issues[0]?.message ?? "Invalid historical row." }, { status: 400 });
  }
  const admin = createAdminClient();
  const { data: row, error: rowError } = await admin.from("survey_historical_import_rows").select("*")
    .eq("id", id).eq("organization_id", profile.organization_id).maybeSingle();
  if (rowError || !row) return NextResponse.json({ error: "Historical row not found." }, { status: 404 });
  const previous = {
    matchedTaskId: row.matched_task_id, respondentPrincipalId: row.respondent_principal_id,
    reviewedWrikeUserId: row.reviewed_wrike_user_id, answers: row.normalized_answers,
    repeatResolution: row.repeat_resolution, revisionOrder: row.revision_order, status: row.row_status,
  };
  if (parsed.data.ignoreReason) {
    await admin.from("survey_historical_import_rows").update({
      row_status: "ignored", ignored_reason: parsed.data.ignoreReason, updated_at: new Date().toISOString(),
    }).eq("id", id);
    await admin.from("survey_historical_import_issues").update({
      resolution_status: "ignored", resolution: { reason: parsed.data.ignoreReason },
      resolved_by: user.id, resolved_at: new Date().toISOString(),
    }).eq("row_id", id).eq("resolution_status", "open");
  } else {
    let respondentPrincipalId = parsed.data.respondentPrincipalId ?? row.respondent_principal_id;
    if (parsed.data.historicalWrikeUserId) {
      const { data: principalId, error } = await supabase.rpc("create_historical_survey_principal", {
        target_wrike_user_id: parsed.data.historicalWrikeUserId,
        target_role: parsed.data.historicalRole,
      });
      if (error || !principalId) return NextResponse.json({ error: error?.message ?? "Historical principal could not be created." }, { status: 400 });
      respondentPrincipalId = principalId;
    }
    const matchedTaskId = parsed.data.matchedTaskId ?? row.matched_task_id;
    const reviewedWrikeUserId = parsed.data.reviewedWrikeUserId ?? row.reviewed_wrike_user_id;
    const updates: Record<string, unknown> = {
      matched_task_id: matchedTaskId,
      respondent_principal_id: respondentPrincipalId,
      reviewed_wrike_user_id: reviewedWrikeUserId,
      normalized_answers: parsed.data.correctedAnswers ?? row.normalized_answers,
      repeat_resolution: parsed.data.repeatResolution ?? row.repeat_resolution,
      revision_order: parsed.data.revisionOrder ?? row.revision_order,
      updated_at: new Date().toISOString(), last_validated_at: new Date().toISOString(),
    };
    const context = { ...(row.context_snapshot as Record<string, unknown>) };
    if (parsed.data.matchedTaskId) {
      const [{ data: task }, { data: reporting }] = await Promise.all([
        admin.from("wrike_tasks").select("id,wrike_id,title,status").eq("id", parsed.data.matchedTaskId)
          .eq("organization_id", profile.organization_id).eq("is_deleted", false).maybeSingle(),
        admin.from("wrike_task_normalized_custom_field_values").select("reporting_year")
          .eq("task_id", parsed.data.matchedTaskId).not("reporting_year", "is", null).limit(1).maybeSingle(),
      ]);
      if (!task) return NextResponse.json({ error: "Select a synchronized project in this organization." }, { status: 400 });
      Object.assign(context, {
        taskId: task.id, taskWrikeId: task.wrike_id, taskTitle: task.title,
        status: task.status, reportingYear: reporting?.reporting_year ?? null,
      });
      updates.context_snapshot = context;
    }
    const now = new Date().toISOString();
    const resolvedCodes: string[] = [];
    if (parsed.data.matchedTaskId) resolvedCodes.push("missing_project", "ambiguous_project");
    if (respondentPrincipalId && (parsed.data.respondentPrincipalId || parsed.data.historicalWrikeUserId)) resolvedCodes.push("missing_respondent", "ambiguous_respondent");
    if (parsed.data.reviewedWrikeUserId) resolvedCodes.push("missing_reviewed_sme", "ambiguous_reviewed_sme");
    if (parsed.data.correctedAnswers) resolvedCodes.push("invalid_answer");
    if (parsed.data.confirmAssignment) resolvedCodes.push("missing_assignment");
    if (parsed.data.repeatResolution) resolvedCodes.push("repeat_identity", "duplicate_response");
    if (resolvedCodes.length) await admin.from("survey_historical_import_issues").update({
      resolution_status: "resolved", resolution: parsed.data, resolved_by: user.id, resolved_at: now,
    }).eq("row_id", id).in("issue_code", resolvedCodes).eq("resolution_status", "open");
    const { data: openIssues } = await admin.from("survey_historical_import_issues").select("id")
      .eq("row_id", id).eq("resolution_status", "open").eq("severity", "blocking");
    const required = matchedTaskId && respondentPrincipalId && reviewedWrikeUserId
      && row.source_submitted_at && row.survey_version_id;
    updates.row_status = required && !(openIssues?.length) ? "ready" : "issues";
    const { error } = await admin.from("survey_historical_import_rows").update(updates).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }
  const { data: updated } = await admin.from("survey_historical_import_rows").select("*").eq("id", id).single();
  await admin.from("survey_historical_import_resolution_audit").insert({
    organization_id: profile.organization_id, batch_id: row.batch_id, row_id: id,
    action: parsed.data.ignoreReason ? "ignored" : "row_resolved",
    previous_values: previous, new_values: updated, actor_id: user.id,
  });
  const { data: summary } = await supabase.rpc("refresh_historical_survey_import_summary", { target_batch_id: row.batch_id });
  revalidatePath("/admin");
  return NextResponse.json({ ok: true, row: updated, summary });
}
