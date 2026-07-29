import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { hasCapability } from "@/lib/auth/roles";
import { separateSourceIdForRow } from "@/lib/surveys/finalized-historical-import-server";
import { createAdminClient } from "@/lib/supabase/admin";

const inputSchema = z.object({
  selected: z.boolean().optional(),
  duplicateAction: z.enum(["skip", "separate", "replace"]).optional(),
  matchedTaskId: z.string().uuid().nullable().optional(),
  explicitlyUnmatched: z.boolean().optional(),
  respondentPrincipalId: z.string().uuid().nullable().optional(),
  reviewedWrikeUserId: z.string().uuid().nullable().optional(),
}).refine((value) => !(value.matchedTaskId && value.explicitlyUnmatched), {
  message: "Choose a project or import unmatched, not both.",
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await requireCapability("manage_data");
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) {
    return NextResponse.json({ error: parsed.error?.issues[0]?.message ?? "Invalid import row." }, { status: 400 });
  }
  const admin = createAdminClient();
  const { data: row, error: rowError } = await admin.from("survey_historical_import_rows")
    .select("*").eq("id", id).eq("organization_id", context.profile.organization_id).maybeSingle();
  if (rowError || !row) return NextResponse.json({ error: "Historical import row not found." }, { status: 404 });
  const { data: batch } = await admin.from("survey_historical_import_batches")
    .select("id,finalized_at").eq("id", row.batch_id).eq("organization_id", context.profile.organization_id).maybeSingle();
  if (!batch || batch.finalized_at) return NextResponse.json({ error: "This batch can no longer be changed." }, { status: 409 });

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const nextDiagnostics = { ...(row.match_diagnostics as Record<string, unknown>) };
  if ("matchedTaskId" in parsed.data) {
    if (parsed.data.matchedTaskId) {
      const { data: task } = await admin.from("wrike_tasks").select("id,wrike_id,title")
        .eq("id", parsed.data.matchedTaskId).eq("organization_id", context.profile.organization_id)
        .eq("is_deleted", false).maybeSingle();
      if (!task) return NextResponse.json({ error: "Select an eligible DevTrack project." }, { status: 400 });
      updates.matched_task_id = task.id;
      updates.explicit_unmatched = false;
      updates.context_snapshot = {
        ...(row.context_snapshot as Record<string, unknown>),
        matchedWrikeTaskId: task.wrike_id,
        matchMethod: "administrator",
        matchConfidence: 1,
      };
      nextDiagnostics.status = "Ready with warnings";
      nextDiagnostics.explicitlyUnmatched = false;
      await admin.from("survey_historical_import_issues").update({
        resolution_status: "resolved",
        resolution: { matchedTaskId: task.id },
        resolved_by: context.user.id,
        resolved_at: new Date().toISOString(),
      }).eq("row_id", id).in("issue_code", ["missing_project", "ambiguous_project"]).eq("resolution_status", "open");
    } else updates.matched_task_id = null;
  }
  if (parsed.data.explicitlyUnmatched) {
    updates.matched_task_id = null;
    updates.explicit_unmatched = true;
    updates.context_snapshot = {
      ...(row.context_snapshot as Record<string, unknown>),
      matchedWrikeTaskId: null,
      matchMethod: null,
      matchConfidence: null,
    };
    nextDiagnostics.status = "Ready with warnings";
    nextDiagnostics.explicitlyUnmatched = true;
    await admin.from("survey_historical_import_issues").update({
      resolution_status: "resolved",
      resolution: { explicitlyUnmatched: true },
      resolved_by: context.user.id,
      resolved_at: new Date().toISOString(),
    }).eq("row_id", id).in("issue_code", ["missing_project", "ambiguous_project"]).eq("resolution_status", "open");
  }

  if ("respondentPrincipalId" in parsed.data) {
    if (parsed.data.respondentPrincipalId) {
      const { data: principal } = await admin.from("application_user_principals").select("id")
        .eq("id", parsed.data.respondentPrincipalId).eq("organization_id", context.profile.organization_id).maybeSingle();
      if (!principal) return NextResponse.json({ error: "Select a person in this organization." }, { status: 400 });
    }
    updates.respondent_principal_id = parsed.data.respondentPrincipalId ?? null;
  }
  if ("reviewedWrikeUserId" in parsed.data) {
    if (parsed.data.reviewedWrikeUserId) {
      const { data: user } = await admin.from("wrike_users").select("id")
        .eq("id", parsed.data.reviewedWrikeUserId).eq("organization_id", context.profile.organization_id)
        .eq("identity_verified", true).eq("is_unresolved", false).maybeSingle();
      if (!user) return NextResponse.json({ error: "Select a verified SME contact." }, { status: 400 });
    }
    updates.reviewed_wrike_user_id = parsed.data.reviewedWrikeUserId ?? null;
  }

  if (parsed.data.duplicateAction) {
    if (parsed.data.duplicateAction === "replace") {
      if (!hasCapability(context.profile.access, "manage_surveys")) {
        return NextResponse.json({ error: "Replacing historical responses requires survey-management access." }, { status: 403 });
      }
      if (!row.duplicate_target_response_id) {
        return NextResponse.json({ error: "This duplicate is not a replaceable historical response." }, { status: 400 });
      }
      updates.effective_source_response_id = row.source_response_id;
      updates.selected_for_import = true;
      nextDiagnostics.status = "Ready with warnings";
    } else if (parsed.data.duplicateAction === "separate") {
      updates.effective_source_response_id = separateSourceIdForRow(row.source_response_id, row.batch_id, row.id);
      updates.selected_for_import = true;
      nextDiagnostics.status = "Ready with warnings";
    } else updates.selected_for_import = false;
    updates.duplicate_action = parsed.data.duplicateAction;
    await admin.from("survey_historical_import_issues").update({
      resolution_status: parsed.data.duplicateAction === "skip" ? "ignored" : "resolved",
      resolution: { duplicateAction: parsed.data.duplicateAction },
      resolved_by: context.user.id,
      resolved_at: new Date().toISOString(),
    }).eq("row_id", id).eq("issue_code", "duplicate_response").eq("resolution_status", "open");
  }

  const { data: remainingBlocking } = await admin.from("survey_historical_import_issues").select("id,issue_code")
    .eq("row_id", id).eq("severity", "blocking").eq("resolution_status", "open");
  const duplicateResolved = parsed.data.duplicateAction && parsed.data.duplicateAction !== "skip";
  const canBeReady = !(remainingBlocking ?? []).some((issue) =>
    issue.issue_code !== "duplicate_response" || !duplicateResolved);
  if (canBeReady && (row.row_status === "duplicate" || row.row_status === "issues")) updates.row_status = "ready";
  if (parsed.data.selected != null) {
    if (parsed.data.selected && !canBeReady && row.row_status !== "ready") {
      return NextResponse.json({ error: "Resolve blocking issues before selecting this row." }, { status: 400 });
    }
    updates.selected_for_import = parsed.data.selected;
  }
  updates.match_diagnostics = nextDiagnostics;

  const { data: updated, error } = await admin.from("survey_historical_import_rows")
    .update(updates).eq("id", id).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await admin.from("survey_historical_import_resolution_audit").insert({
    organization_id: context.profile.organization_id,
    batch_id: row.batch_id,
    row_id: row.id,
    action: "finalized_row_updated",
    previous_values: row,
    new_values: updated,
    actor_id: context.user.id,
  });
  const { data: summary } = await context.supabase.rpc("finalized_historical_import_summary", {
    target_batch_id: row.batch_id,
  });
  await admin.from("survey_historical_import_batches").update({ summary }).eq("id", row.batch_id);
  revalidatePath("/admin/survey-imports");
  return NextResponse.json({ ok: true, row: updated, summary });
}
