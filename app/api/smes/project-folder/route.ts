import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const { supabase } = await requireCapability("view_sme_dashboard");
  const parsed = z.object({
    smeIdentityId: z.string().uuid(),
    url: z.string(),
  }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid SME and URL." }, { status: 400 });
  const { data, error } = await supabase.rpc("set_sme_project_folder_url", {
    target_sme_identity_id: parsed.data.smeIdentityId,
    target_url: parsed.data.url,
  });
  if (error) return NextResponse.json({ error: error.message || "The project folder link could not be saved." }, { status: error.code === "42501" ? 403 : 400 });
  return NextResponse.json(data);
}
