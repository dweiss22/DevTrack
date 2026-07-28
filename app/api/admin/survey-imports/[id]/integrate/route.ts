import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireCapability("manage_data");
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid import batch." }, { status: 400 });
  const { data, error } = await supabase.rpc("integrate_historical_survey_import_batch", { target_batch_id: id });
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 400 });
  for (const path of ["/admin", "/admin/surveys", "/surveys", "/sme-management", "/sme-dashboard", "/id-dashboard"]) revalidatePath(path);
  return NextResponse.json({ ok: true, result: data });
}
