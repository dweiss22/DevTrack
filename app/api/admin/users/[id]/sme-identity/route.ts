import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, profile } = await requireCapability("manage_users");
  const parsed = z.object({
    smeIdentityId: z.string().uuid(),
    confirmReplacement: z.boolean().default(false),
  }).safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) {
    return NextResponse.json({ error: "Select a valid SME and field-derived identity." }, { status: 400 });
  }
  const { error } = await createAdminClient().rpc("link_application_user_sme_identity", {
    target_organization_id: profile.organization_id,
    target_application_user_id: id,
    target_sme_identity_id: parsed.data.smeIdentityId,
    acting_user_id: user.id,
    confirm_replacement: parsed.data.confirmReplacement,
  });
  if (error) {
    const confirmation = error.code === "P0001";
    return NextResponse.json({
      error: confirmation
        ? "Confirmation is required before replacing or resolving this SME identity linkage."
        : "The SME identity linkage could not be updated."
    }, { status: confirmation ? 409 : 400 });
  }
  return NextResponse.json({ ok: true });
}
