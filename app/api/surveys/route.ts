import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const { supabase } = await requireCapability("view_personal_surveys");
  const parsed = z.object({
    taskId: z.string().uuid(),
    reviewedWrikeUserId: z.string().uuid().nullable().optional(),
  }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Survey context is unavailable." }, { status: 400 });
  const { data, error } = await supabase.rpc("survey_personal_create_or_resume", {
    target_task_id: parsed.data.taskId,
    target_reviewed_wrike_user_id: parsed.data.reviewedWrikeUserId ?? null,
  });
  return error
    ? NextResponse.json({ error: "Survey context is unavailable." }, { status: error.code === "42501" ? 404 : 400 })
    : NextResponse.json({ id: data });
}
