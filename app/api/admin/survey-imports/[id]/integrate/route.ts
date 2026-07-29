import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { markBatchFailed } from "@/lib/surveys/finalized-historical-import-server";

const inputSchema = z.object({ idempotencyKey: z.string().uuid() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile, supabase } = await requireCapability("manage_data");
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid import batch." }, { status: 400 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A valid idempotency key is required." }, { status: 400 });
  const { data, error } = await supabase.rpc("execute_finalized_historical_survey_import", {
    target_batch_id: id,
    requested_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) {
    await markBatchFailed(supabase, profile.organization_id, id, error.message);
    return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 400 });
  }
  revalidatePath("/admin/survey-imports");
  for (const path of ["/admin", "/admin/surveys", "/surveys", "/sme-management", "/sme-dashboard", "/id-dashboard"]) revalidatePath(path);
  return NextResponse.json({ ok: true, result: data });
}
