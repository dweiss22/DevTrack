import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, profile } = await requireCapability("manage_users");
  const parsed = z.object({ wrikeUserId: z.string().uuid().nullable() }).safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) {
    return NextResponse.json({ error: "Select a valid application user and synchronized identity." }, { status: 400 });
  }
  const { error } = await createAdminClient().rpc("set_application_user_wrike_identity", {
    target_organization_id: profile.organization_id,
    target_user_id: id,
    target_wrike_user_id: parsed.data.wrikeUserId,
    acting_user_id: user.id,
  });
  if (error) {
    const duplicate = error.code === "23505";
    return NextResponse.json({
      error: duplicate ? "That synchronized identity is already mapped to another account." : "The Wrike identity mapping could not be updated."
    }, { status: duplicate ? 409 : 400 });
  }
  return NextResponse.json({ ok: true });
}
