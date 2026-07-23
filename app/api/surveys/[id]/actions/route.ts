import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("unlock"), reason: z.string().trim().min(1).max(2000), reviserId: z.string().uuid().nullable().optional() }),
  z.object({ action: z.literal("relock") }),
  z.object({ action: z.literal("assign_reviser"), reviserId: z.string().uuid() }),
  z.object({ action: z.literal("correct_context"), corrections: z.object({
    originalDueYear: z.coerce.number().int().min(1000).max(9999).optional(),
    publicationYear: z.coerce.number().int().min(1000).max(9999).optional(),
    vertical: z.string().max(50).optional(),
  }) }),
]);

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireCapability("manage_surveys");
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) {
    return NextResponse.json({ error: "The survey action is invalid." }, { status: 400 });
  }
  const body = parsed.data;
  const call = body.action === "unlock"
    ? supabase.rpc("survey_unlock", { target_submission_id: id, unlock_reason_text: body.reason, assigned_reviser_id: body.reviserId ?? null })
    : body.action === "relock"
      ? supabase.rpc("survey_relock", { target_submission_id: id })
      : body.action === "assign_reviser"
        ? supabase.rpc("survey_assign_reviser", { target_submission_id: id, assigned_reviser_id: body.reviserId })
        : supabase.rpc("survey_correct_context", { target_submission_id: id, corrections: body.corrections });
  const { error } = await call;
  return error
    ? NextResponse.json({ error: error.message || "The survey action could not be completed." }, { status: error.code === "42501" ? 403 : 400 })
    : NextResponse.json({ ok: true });
}
