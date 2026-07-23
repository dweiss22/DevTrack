import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { accountSetupRedirectUrl, applicationRoleSchema, findAuthenticationUserByEmail } from "@/lib/users/invitations";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("resend") }),
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

  let authUserId = invitation.auth_user_id as string | null;
  if (!authUserId) {
    try { authUserId = (await findAuthenticationUserByEmail(admin, invitation.email))?.id ?? null; }
    catch { return NextResponse.json({ error: "DevTrack could not safely search for the unused invitation account." }, { status: 500 }); }
  }
  if (authUserId) {
    const { data } = await admin.auth.admin.getUserById(authUserId);
    if (data.user && !data.user.email_confirmed_at && !data.user.last_sign_in_at) {
      const { error: deleteError } = await admin.auth.admin.deleteUser(authUserId);
      if (deleteError) return NextResponse.json({ error: "The unused invitation could not be reset for resending." }, { status: 500 });
      authUserId = null;
    }
  }

  const now = new Date().toISOString();
  if (authUserId) {
    const { error } = await admin.auth.resetPasswordForEmail(invitation.email, { redirectTo: accountSetupRedirectUrl() });
    if (error) return NextResponse.json({ error: "The setup email could not be resent." }, { status: 502 });
  } else {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(invitation.email, {
      redirectTo: accountSetupRedirectUrl(),
      data: { devtrack_invitation_id: invitation.id },
    });
    if (error || !data.user) return NextResponse.json({ error: "The invitation email could not be resent." }, { status: 502 });
    authUserId = data.user.id;
  }

  const { error: updateError } = await admin.from("application_user_invitations").update({
    status: "pending",
    auth_user_id: authUserId,
    last_sent_at: now,
    last_error: null,
    updated_at: now,
  }).eq("id", id).eq("organization_id", profile.organization_id).in("status", ["pending", "failed"]);
  return updateError
    ? NextResponse.json({ error: "The email was sent, but the invitation status could not be updated." }, { status: 500 })
    : NextResponse.json({ ok: true });
}
