import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function PATCH(request: NextRequest) {
  const { user, profile } = await requireContext();
  const parsed = z.object({ displayName: z.string().trim().min(2).max(100) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Display name must be between 2 and 100 characters." }, { status: 400 });
  const { error } = await createAdminClient().from("application_users").update({
    display_name: parsed.data.displayName,
    updated_at: new Date().toISOString(),
  }).eq("id", user.id).eq("organization_id", profile.organization_id);
  return error
    ? NextResponse.json({ error: "Your profile could not be updated." }, { status: 500 })
    : NextResponse.json({ ok: true });
}
