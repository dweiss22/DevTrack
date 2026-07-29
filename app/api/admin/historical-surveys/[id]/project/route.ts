import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";

const inputSchema = z.object({ matchedTaskId: z.string().uuid().nullable() });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireCapability("manage_data");
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !input.success) {
    return NextResponse.json({ error: "Invalid historical response project match." }, { status: 400 });
  }
  const { error } = await supabase.rpc("match_historical_survey_response_project", {
    target_response_id: id,
    target_task_id: input.data.matchedTaskId,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 400 });
  revalidatePath("/admin/survey-imports");
  revalidatePath("/admin/surveys");
  return NextResponse.json({ ok: true });
}
