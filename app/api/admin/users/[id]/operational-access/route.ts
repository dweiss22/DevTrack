import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile, user } = await requireCapability("manage_users");
  const parsed = z.object({
    roles: z.array(z.enum(["id", "sme"])).max(2),
    wrikeUserId: z.string().uuid().nullable(),
  }).safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) {
    return NextResponse.json({ error: "Select valid operational access." }, { status: 400 });
  }
  const { error } = await createAdminClient().rpc("set_application_user_operational_access", {
    target_organization_id: profile.organization_id,
    target_user_id: id,
    target_roles: [...new Set(parsed.data.roles)],
    target_wrike_user_id: parsed.data.wrikeUserId,
    acting_user_id: user.id,
  });
  return error
    ? NextResponse.json({ error: error.message || "Operational access could not be updated." }, { status: error.code === "42501" ? 403 : 400 })
    : NextResponse.json({ ok: true });
}
