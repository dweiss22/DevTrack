import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, profile } = await requireCapability("manage_users");
  const parsed = z.object({
    smeIdentityId: z.string().uuid().optional(),
    newDisplayName: z.string().trim().min(1).max(200).optional(),
    confirmReplacement: z.boolean().default(false),
  }).refine((value) => Boolean(value.smeIdentityId) !== Boolean(value.newDisplayName), {
    message: "Select an existing identity or provide a new name, not both.",
  }).safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) {
    return NextResponse.json({ error: "Select a valid SME and field-derived identity." }, { status: 400 });
  }
  const admin = createAdminClient();
  let smeIdentityId = parsed.data.smeIdentityId;
  if (!smeIdentityId) {
    const { data, error } = await admin.rpc("ensure_sme_dashboard_identity", {
      target_organization_id: profile.organization_id,
      target_display_name: parsed.data.newDisplayName,
    });
    if (error) return NextResponse.json({ error: error.message || "The SME name could not be reserved." }, { status: error.code === "42501" ? 403 : 400 });
    smeIdentityId = data as string;
  }
  const { error } = await admin.rpc("link_application_user_sme_identity", {
    target_organization_id: profile.organization_id,
    target_application_user_id: id,
    target_sme_identity_id: smeIdentityId,
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
  return NextResponse.json({ ok: true, smeIdentityId });
}
