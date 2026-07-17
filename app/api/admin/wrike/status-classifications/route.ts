import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { automaticStatusClassification } from "@/lib/wrike/reference-data";
import { SELECTED_WRIKE_WORKFLOW } from "@/lib/wrike/selected-workflow";

const schema = z.object({
  wrikeStatusId: z.string().min(1).max(256),
  classification: z.enum(["active", "completed", "stalled_or_canceled"]).nullable(),
  automatic: z.boolean().default(false)
});

export async function POST(request: NextRequest) {
  const { user, profile } = await requireAdmin();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid workflow status classification." }, { status: 400 });
  const db = createAdminClient();
  const { data: status } = await db.from("wrike_workflow_statuses").select("id,title,status_group,workflow_id").eq("organization_id", profile.organization_id).eq("wrike_id", parsed.data.wrikeStatusId).maybeSingle();
  if (!status || status.workflow_id !== SELECTED_WRIKE_WORKFLOW.wrikeWorkflowId) return NextResponse.json({ error: "The status is not part of the Online Learning workflow." }, { status: 404 });
  const classification = parsed.data.automatic ? automaticStatusClassification({ name: status.title, group: status.status_group ?? undefined }) : parsed.data.classification;
  const now = new Date().toISOString();
  const { error } = await db.from("wrike_workflow_statuses").update({
    dashboard_classification: classification,
    classification_source: parsed.data.automatic ? (classification ? "automatic" : null) : "manual",
    classification_updated_by: parsed.data.automatic ? null : user.id,
    classification_updated_at: now,
    updated_at: now
  }).eq("id", status.id);
  if (error) return NextResponse.json({ error: "Unable to update the status classification." }, { status: 500 });
  return NextResponse.json({ ok: true, classification, source: parsed.data.automatic ? "automatic" : "manual" });
}
