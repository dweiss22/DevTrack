import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireCapability("manage_surveys");
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Survey template is unavailable." }, { status: 404 });
  }
  const { data, error } = await supabase.rpc("survey_admin_publish", { target_template_id: id });
  return error
    ? NextResponse.json({ error: error.message || "The survey could not be published." }, { status: error.code === "42501" ? 404 : 400 })
    : NextResponse.json({ version: data });
}
