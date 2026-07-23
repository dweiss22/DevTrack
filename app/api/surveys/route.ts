import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { hasCapability } from "@/lib/auth/roles";
import { SURVEY_TYPES } from "@/lib/surveys/domain";

export async function POST(request: NextRequest) {
  const { profile, supabase } = await requireCapability("view_surveys");
  const parsed = z.object({
    taskId: z.string().uuid(),
    surveyType: z.enum(SURVEY_TYPES),
    smeApplicationUserId: z.string().uuid().nullable().optional(),
  }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Survey context is unavailable." }, { status: 400 });
  const capability = parsed.data.surveyType === "course_development_debrief" ? "create_sme_debrief" : "create_id_review";
  if (!hasCapability(profile.role, capability)) return NextResponse.json({ error: "Survey context is unavailable." }, { status: 404 });
  const { data, error } = await supabase.rpc("survey_create_or_resume", {
    target_task_id: parsed.data.taskId,
    requested_type: parsed.data.surveyType,
    target_sme_application_user_id: parsed.data.smeApplicationUserId ?? null,
  });
  return error
    ? NextResponse.json({ error: "Survey context is unavailable." }, { status: error.code === "42501" ? 404 : 400 })
    : NextResponse.json({ id: data });
}
