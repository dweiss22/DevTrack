import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({
  mappingTarget: z.enum(["answer", "context", "identity", "timestamp", "ignored"]),
  canonicalQuestionId: z.string().trim().min(1).max(100).optional(),
  conversion: z.string().trim().min(1).max(500).optional(),
  reason: z.string().trim().min(3).max(2_000),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile, user, supabase } = await requireCapability("manage_data");
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) {
    return NextResponse.json({ error: parsed.error?.issues[0]?.message ?? "Invalid column mapping." }, { status: 400 });
  }
  const admin = createAdminClient();
  const { data: column } = await admin.from("survey_historical_import_column_mappings").select("*")
    .eq("id", id).eq("organization_id", profile.organization_id).maybeSingle();
  if (!column) return NextResponse.json({ error: "Column mapping not found." }, { status: 404 });
  const next = {
    mapping_target: parsed.data.mappingTarget,
    canonical_question_id: parsed.data.canonicalQuestionId ?? null,
    normalized_conversion: parsed.data.conversion ?? parsed.data.reason,
    mapping_source: "administrator_confirmed",
    confirmed_by: user.id,
    confirmed_at: new Date().toISOString(),
  };
  const { error } = await admin.from("survey_historical_import_column_mappings").update(next).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (parsed.data.mappingTarget === "ignored" || parsed.data.canonicalQuestionId) {
    await admin.from("survey_historical_import_issues").update({
      resolution_status: "resolved", resolution: { ...parsed.data },
      resolved_by: user.id, resolved_at: new Date().toISOString(),
    }).eq("batch_id", column.batch_id).eq("source_field", column.original_heading)
      .eq("issue_code", "question_mapping_problem").eq("resolution_status", "open");
  }
  const [{ data: stagedRows }, { data: blockingIssues }] = await Promise.all([
    admin.from("survey_historical_import_rows")
      .select("id,matched_task_id,respondent_principal_id,reviewed_wrike_user_id,source_submitted_at,survey_version_id,row_status")
      .eq("batch_id", column.batch_id).eq("row_status", "issues"),
    admin.from("survey_historical_import_issues").select("row_id")
      .eq("batch_id", column.batch_id).eq("resolution_status", "open").eq("severity", "blocking"),
  ]);
  const blockedRows = new Set((blockingIssues ?? []).map((issue) => issue.row_id).filter(Boolean));
  const newlyReady = (stagedRows ?? []).filter((row) =>
    row.matched_task_id && row.respondent_principal_id && row.reviewed_wrike_user_id
    && row.source_submitted_at && row.survey_version_id && !blockedRows.has(row.id)
  ).map((row) => row.id);
  if (newlyReady.length) {
    await admin.from("survey_historical_import_rows").update({
      row_status: "ready", last_validated_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).in("id", newlyReady);
  }
  await admin.from("survey_historical_import_resolution_audit").insert({
    organization_id: profile.organization_id, batch_id: column.batch_id, column_mapping_id: id,
    action: "column_mapping_confirmed", previous_values: column, new_values: next, actor_id: user.id,
  });
  const { data: summary } = await supabase.rpc("refresh_historical_survey_import_summary", { target_batch_id: column.batch_id });
  revalidatePath("/admin");
  return NextResponse.json({ ok: true, summary });
}
