import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { applicationRoleSchema } from "@/lib/users/invitations";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("change_role"), role: applicationRoleSchema }),
]);

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile } = await requireCapability("manage_users");
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid invitation." }, { status: 400 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid invitation action." }, { status: 400 });

  const admin = createAdminClient();
  const { data: invitation, error: lookupError } = await admin
    .from("application_user_invitations")
    .select("id,email,role,status,auth_user_id")
    .eq("id", id)
    .eq("organization_id", profile.organization_id)
    .in("status", ["pending", "failed"])
    .maybeSingle();
  if (lookupError) return NextResponse.json({ error: "DevTrack could not verify the invitation." }, { status: 500 });
  if (!invitation) return NextResponse.json({ error: "That pending invitation was not found." }, { status: 404 });

  if (parsed.data.action === "change_role") {
    const { error } = await admin.from("application_user_invitations").update({
      role: parsed.data.role,
      updated_at: new Date().toISOString(),
    }).eq("id", id).eq("organization_id", profile.organization_id).in("status", ["pending", "failed"]);
    return error
      ? NextResponse.json({ error: "The invitation role could not be updated." }, { status: 500 })
      : NextResponse.json({ ok: true });
  }

  if (parsed.data.action === "cancel") {
    const { error } = await admin.from("application_user_invitations").update({
      status: "canceled",
      canceled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", id).eq("organization_id", profile.organization_id).in("status", ["pending", "failed"]);
    if (error) return NextResponse.json({ error: "The invitation could not be canceled." }, { status: 500 });

    if (invitation.auth_user_id) {
      const { data } = await admin.auth.admin.getUserById(invitation.auth_user_id);
      if (data.user && !data.user.email_confirmed_at && !data.user.last_sign_in_at) {
        await admin.auth.admin.deleteUser(invitation.auth_user_id);
      }
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "That invitation action is no longer supported. Add the user with the standard account workflow." }, { status: 400 });
}
