import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { finalizedCourseDraftUrlSchema } from "@/lib/projects/finalized-draft";

const idSchema = z.string().uuid();

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireCapability("view_surveys");
  const parsed = z.object({ url: finalizedCourseDraftUrlSchema }).safeParse(await request.json().catch(() => null));
  if (!idSchema.safeParse(id).success || !parsed.success) {
    return NextResponse.json({
      error: parsed.success ? "Project action is unavailable." : parsed.error.issues[0]?.message ?? "Enter a valid finalized course draft link.",
    }, { status: parsed.success ? 404 : 400 });
  }
  const { data, error } = await supabase.rpc("save_project_finalized_course_draft", {
    target_task_id: id,
    target_url: parsed.data.url,
  });
  if (error) {
    return NextResponse.json({
      error: error.code === "42501" ? "Project action is unavailable." : error.message || "The finalized course draft link could not be saved.",
    }, { status: error.code === "42501" ? 404 : 400 });
  }
  return NextResponse.json(data);
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireCapability("view_surveys");
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Project action is unavailable." }, { status: 404 });
  }
  const { data, error } = await supabase.rpc("remove_project_finalized_course_draft", {
    target_task_id: id,
  });
  if (error) {
    return NextResponse.json({
      error: error.code === "42501" ? "Project action is unavailable." : error.message || "The finalized course draft link could not be removed.",
    }, { status: error.code === "42501" ? 404 : 400 });
  }
  return NextResponse.json(data);
}
