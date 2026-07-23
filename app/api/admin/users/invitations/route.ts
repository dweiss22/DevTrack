import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { accountSetupRedirectUrl, findAuthenticationUserByEmail, invitationInputSchema, normalizeInvitationEmail } from "@/lib/users/invitations";

export async function POST(request: NextRequest) {
  const { user, profile } = await requireCapability("manage_users");
  const parsed = invitationInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email address and application role." }, { status: 400 });

  const admin = createAdminClient();
  const email = normalizeInvitationEmail(parsed.data.email);
  let existingAuthUser;
  try { existingAuthUser = await findAuthenticationUserByEmail(admin, email); }
  catch { return NextResponse.json({ error: "DevTrack could not verify whether this email already has access." }, { status: 500 }); }
  if (existingAuthUser) {
    const { data: existingMembership, error: membershipError } = await admin.from("application_users").select("id").eq("id", existingAuthUser.id).maybeSingle();
    if (membershipError) return NextResponse.json({ error: "DevTrack could not verify whether this email already has access." }, { status: 500 });
    if (existingMembership) return NextResponse.json({ error: "This email already has an active membership or open invitation." }, { status: 409 });
  }

  const { data: invitation, error: insertError } = await admin
    .from("application_user_invitations")
    .insert({
      organization_id: profile.organization_id,
      email,
      normalized_email: email,
      role: parsed.data.role,
      status: "pending",
      invited_by: user.id,
      auth_user_id: existingAuthUser?.id ?? null,
    })
    .select("id")
    .single();

  if (insertError || !invitation) {
    const duplicate = insertError?.code === "23505";
    return NextResponse.json(
      { error: duplicate ? "This email already has an active membership or open invitation." : "DevTrack could not create the invitation." },
      { status: duplicate ? 409 : 500 },
    );
  }

  let invitedUserId = existingAuthUser?.id ?? null;
  const sendError = existingAuthUser
    ? (await admin.auth.resetPasswordForEmail(email, { redirectTo: accountSetupRedirectUrl() })).error
    : await (async () => {
        const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
          redirectTo: accountSetupRedirectUrl(),
          data: { devtrack_invitation_id: invitation.id },
        });
        invitedUserId = data.user?.id ?? null;
        return error;
      })();

  if (sendError || !invitedUserId) {
    await admin.from("application_user_invitations").update({
      status: "failed",
      last_error: "Supabase could not send the invitation email.",
      updated_at: new Date().toISOString(),
    }).eq("id", invitation.id).eq("organization_id", profile.organization_id);
    return NextResponse.json({ error: "The invitation was saved, but its email could not be sent. Retry it from User Management." }, { status: 502 });
  }

  const { error: updateError } = await admin.from("application_user_invitations").update({
    auth_user_id: invitedUserId,
    last_sent_at: new Date().toISOString(),
    last_error: null,
    updated_at: new Date().toISOString(),
  }).eq("id", invitation.id).eq("organization_id", profile.organization_id);

  if (updateError) {
    return NextResponse.json({ error: "The email was sent, but DevTrack could not finish recording the invitation." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, invitationId: invitation.id });
}
