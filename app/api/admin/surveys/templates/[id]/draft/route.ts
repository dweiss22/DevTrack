import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { surveyDefinitionSchema } from "@/lib/surveys/definition";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireCapability("manage_surveys");
  const parsed = z.object({
    definition: surveyDefinitionSchema,
    expectedLockVersion: z.number().int().positive(),
  }).safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) {
    return NextResponse.json({
      error: parsed.success ? "Survey template is unavailable." : parsed.error.issues[0]?.message ?? "Review the survey definition.",
    }, { status: 400 });
  }
  const { data, error } = await supabase.rpc("survey_admin_save_draft", {
    target_template_id: id,
    next_definition: parsed.data.definition,
    expected_lock_version: parsed.data.expectedLockVersion,
  });
  return error
    ? NextResponse.json({ error: error.message || "The survey draft could not be saved." }, { status: error.code === "40001" ? 409 : 400 })
    : NextResponse.json({ lockVersion: data });
}
