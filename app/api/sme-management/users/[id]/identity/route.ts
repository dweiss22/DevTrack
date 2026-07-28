import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const { profile, user } = await requireCapability("manage_smes");
  const parsed = z.object({ wrikeUserId: z.string().uuid() }).safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "Select a valid SME identity." }, { status: 400 });
  const admin = createAdminClient();
  const [{ data: target }, { data: identity }] = await Promise.all([
    admin.from("application_user_operational_personas").select("id,wrike_user_id").eq("organization_id", profile.organization_id)
      .eq("application_user_id", id).eq("operational_role", "sme").eq("is_active", true).maybeSingle(),
    admin.from("wrike_users").select("id").eq("organization_id", profile.organization_id).eq("id", parsed.data.wrikeUserId)
      .eq("is_active", true).eq("is_unresolved", false).eq("identity_verified", true).maybeSingle(),
  ]);
  if (!target || !identity) return NextResponse.json({ error: "The SME account or verified identity is unavailable." }, { status: 404 });
  const { data: occupied } = await admin.from("application_user_operational_personas").select("application_user_id")
    .eq("organization_id", profile.organization_id).eq("wrike_user_id", identity.id).eq("is_active", true).neq("application_user_id", id).limit(1);
  if (occupied?.length) return NextResponse.json({ error: "That identity is already assigned to another account." }, { status: 409 });
  const previous = target.wrike_user_id;
  const { error } = await admin.from("application_user_operational_personas").update({
    wrike_user_id: identity.id, updated_by: user.id, updated_at: new Date().toISOString(),
  }).eq("id", target.id);
  if (error) return NextResponse.json({ error: "The SME identity could not be updated." }, { status: 400 });
  await admin.from("application_users").update({ wrike_user_id: identity.id, updated_at: new Date().toISOString() })
    .eq("id", id).eq("organization_id", profile.organization_id).eq("role", "sme");
  await admin.from("application_user_operational_persona_audit").insert({
    persona_id: target.id, organization_id: profile.organization_id, actor_user_id: user.id,
    application_user_id: id, event_type: previous ? "reassigned" : "assigned", operational_role: "sme",
    previous_wrike_user_id: previous, new_wrike_user_id: identity.id,
  });
  return NextResponse.json({ ok: true });
}
