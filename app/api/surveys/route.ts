import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { SURVEY_TYPES } from "@/lib/surveys/domain";

export async function POST(request: NextRequest) {
  const { supabase } = await requireCapability("view_personal_surveys");
  const parsed = z.object({
    taskId: z.string().uuid(),
    surveyType: z.enum(SURVEY_TYPES),
    reviewedSmeIdentityId: z.string().uuid().nullable().optional(),
    reviewedWrikeUserId: z.string().uuid().nullable().optional(),
  }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Survey context is unavailable." }, { status: 400 });
  const { data, error } = parsed.data.surveyType === "course_development_debrief"
    ? await supabase.rpc("survey_personal_create_or_resume_sme_debrief", {
      target_task_id: parsed.data.taskId,
    })
    : parsed.data.reviewedSmeIdentityId
      ? await supabase.rpc("survey_personal_create_or_resume_for_sme_identity", {
        target_task_id: parsed.data.taskId,
        target_sme_identity_id: parsed.data.reviewedSmeIdentityId,
      })
      : await supabase.rpc("survey_personal_create_or_resume", {
        target_task_id: parsed.data.taskId,
        target_reviewed_wrike_user_id: parsed.data.reviewedWrikeUserId ?? null,
      });
  return error
    ? NextResponse.json({ error: "Survey context is unavailable." }, { status: error.code === "42501" ? 404 : 400 })
    : NextResponse.json({ id: data });
}
