import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";

const schema = z.object({ action: z.enum(["duplicate", "archive", "restore"]) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireCapability("manage_surveys");
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) {
    return NextResponse.json({ error: "Survey template action is unavailable." }, { status: 400 });
  }
  const call = parsed.data.action === "duplicate"
    ? supabase.rpc("survey_admin_duplicate_template", { target_template_id: id })
    : supabase.rpc("survey_admin_set_template_archived", {
      target_template_id: id,
      archive_template: parsed.data.action === "archive",
    });
  const { data, error } = await call;
  return error
    ? NextResponse.json({ error: error.message || "The survey template action failed." }, { status: error.code === "42501" ? 404 : 400 })
    : NextResponse.json({ id: data ?? id });
}
