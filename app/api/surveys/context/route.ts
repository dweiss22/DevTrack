import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { SURVEY_TYPES } from "@/lib/surveys/domain";

export async function GET(request: NextRequest) {
  const { supabase } = await requireCapability("view_surveys");
  const parsed = z.object({
    taskId: z.string().uuid(),
    type: z.enum(SURVEY_TYPES),
  }).safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Survey context is unavailable." }, { status: 400 });
  const { data, error } = await supabase.rpc("survey_context_for_task", {
    target_task_id: parsed.data.taskId,
    requested_type: parsed.data.type,
  });
  return error
    ? NextResponse.json({ error: "Survey context is unavailable." }, { status: error.code === "42501" ? 404 : 400 })
    : NextResponse.json({ context: data });
}
