import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { SURVEY_TYPES } from "@/lib/surveys/domain";

export async function GET(request: NextRequest) {
  const { user, profile, supabase } = await requireCapability("view_surveys");
  const parsed = z.object({
    taskId: z.string().uuid(),
    type: z.enum(SURVEY_TYPES),
  }).safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Survey context is unavailable." }, { status: 400 });
  const { data, error } = await supabase.rpc("survey_context_for_task", {
    target_task_id: parsed.data.taskId,
    requested_type: parsed.data.type,
  });
  if (error || !data) {
    return NextResponse.json({ error: "Survey context is unavailable." }, { status: !error || error.code === "42501" ? 404 : 400 });
  }
  if (profile.role !== "sme") return NextResponse.json({ context: data });
  const { organizationId: _organizationId, taskWrikeId: _taskWrikeId, assignedSmes, ...safeContext } = data as Record<string, unknown>;
  const ownAssignment = Array.isArray(assignedSmes)
    ? assignedSmes.filter((item) => {
      const assignment = item as Record<string, unknown>;
      return assignment.applicationUserId === user.id;
    }).map((item) => {
      const { wrikeId: _wrikeId, ...safeAssignment } = item as Record<string, unknown>;
      return safeAssignment;
    })
    : [];
  return NextResponse.json({ context: { ...safeContext, assignedSmes: ownAssignment } });
}
