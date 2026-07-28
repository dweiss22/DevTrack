import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile, user, supabase } = await requireCapability("manage_data");
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Import batch not found." }, { status: 404 });
  const admin = createAdminClient();
  const { data: batch } = await admin.from("survey_historical_import_batches").select("id")
    .eq("id", id).eq("organization_id", profile.organization_id).maybeSingle();
  if (!batch) return NextResponse.json({ error: "Import batch not found." }, { status: 404 });
  const [{ data: rows }, { data: blockingIssues }] = await Promise.all([
    admin.from("survey_historical_import_rows")
      .select("id,matched_task_id,respondent_principal_id,reviewed_wrike_user_id,source_submitted_at,survey_version_id,row_status")
      .eq("batch_id", id).in("row_status", ["issues", "ready", "failed"]),
    admin.from("survey_historical_import_issues").select("row_id")
      .eq("batch_id", id).eq("resolution_status", "open").eq("severity", "blocking"),
  ]);
  const blocked = new Set((blockingIssues ?? []).map((issue) => issue.row_id).filter(Boolean));
  let ready = 0;
  let issues = 0;
  for (const row of rows ?? []) {
    const complete = row.matched_task_id && row.respondent_principal_id && row.reviewed_wrike_user_id
      && row.source_submitted_at && row.survey_version_id && !blocked.has(row.id);
    await admin.from("survey_historical_import_rows").update({
      row_status: complete ? "ready" : "issues",
      last_validated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", row.id);
    if (complete) ready += 1; else issues += 1;
  }
  await admin.from("survey_historical_import_resolution_audit").insert({
    organization_id: profile.organization_id, batch_id: id, action: "batch_revalidated",
    previous_values: {}, new_values: { ready, issues }, actor_id: user.id,
  });
  const { data: summary, error } = await supabase.rpc("refresh_historical_survey_import_summary", { target_batch_id: id });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  revalidatePath("/admin");
  return NextResponse.json({ ok: true, summary });
}
