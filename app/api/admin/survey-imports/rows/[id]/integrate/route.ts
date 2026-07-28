import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireCapability("manage_data");
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Historical row not found." }, { status: 404 });
  const { data, error } = await supabase.rpc("integrate_historical_survey_import_row", { target_row_id: id });
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 409 });
  revalidatePath("/admin");
  revalidatePath("/admin/surveys");
  return NextResponse.json({ ok: true, submissionId: data });
}
