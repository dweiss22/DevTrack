import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const { profile, user } = await requireCapability("manage_users");
  const parsed = z.object({ role: z.enum(["sme_coordinator", "admin"]), enabled: z.boolean() })
    .safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "Select a valid management role." }, { status: 400 });
  const { error } = await createAdminClient().rpc("set_application_user_management_role", {
    target_organization_id: profile.organization_id, target_user_id: id, target_role: parsed.data.role,
    target_enabled: parsed.data.enabled, acting_user_id: user.id,
  });
  return error ? NextResponse.json({ error: error.message || "Management access could not be updated." }, { status: error.code === "42501" ? 403 : 400 })
    : NextResponse.json({ ok: true });
}
