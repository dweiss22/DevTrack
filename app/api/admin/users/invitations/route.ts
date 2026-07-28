import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  findAuthenticationUserByEmail,
  invitationInputSchema,
  normalizeInvitationEmail,
  passwordRecoveryRedirectUrl,
} from "@/lib/users/invitations";

export async function POST(request: NextRequest) {
  const { profile, user } = await requireCapability("manage_users");
  const parsed = invitationInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({
    error: "Enter a valid email and select an SME type when inviting an SME.",
  }, { status: 400 });

  const admin = createAdminClient();
  const email = normalizeInvitationEmail(parsed.data.email);
  let existingAuthUser;
  let authUser;
  try { existingAuthUser = await findAuthenticationUserByEmail(admin, email); }
  catch { return NextResponse.json({ error: "DevTrack could not verify whether this email already has access." }, { status: 500 }); }
  if (existingAuthUser) {
    const { data: existingMembership, error: membershipError } = await admin.from("application_users").select("id").eq("id", existingAuthUser.id).maybeSingle();
    if (membershipError) return NextResponse.json({ error: "DevTrack could not verify whether this email already has access." }, { status: 500 });
    if (existingMembership) return NextResponse.json({ error: "This email already has an active DevTrack account." }, { status: 409 });
    authUser = existingAuthUser;
    if (!existingAuthUser.email_confirmed_at) {
      const { data, error } = await admin.auth.admin.updateUserById(existingAuthUser.id, { email_confirm: true });
      if (error || !data.user) return NextResponse.json({ error: "DevTrack could not activate this authentication account." }, { status: 500 });
      authUser = data.user;
    }
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (error || !data.user) {
      return NextResponse.json({ error: "DevTrack could not create the authentication account." }, { status: 502 });
    }
    authUser = data.user;
  }

  const { error: membershipError } = await admin
    .from("application_users")
    .insert({
      id: authUser.id,
      organization_id: profile.organization_id,
      display_name: null,
      role: parsed.data.role,
      profile_completed: true,
      updated_at: new Date().toISOString(),
    });

  if (membershipError) {
    if (!existingAuthUser) await admin.auth.admin.deleteUser(authUser.id);
    const duplicate = membershipError.code === "23505";
    return NextResponse.json(
      { error: duplicate ? "This email already has an active DevTrack account." : "DevTrack could not add the user to this organization." },
      { status: duplicate ? 409 : 500 },
    );
  }

  if (parsed.data.role === "sme") {
    const { error: profileError } = await admin.from("application_user_sme_profiles").upsert({
      application_user_id: authUser.id,
      organization_id: profile.organization_id,
      classification: parsed.data.smeClassification,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "application_user_id" });
    if (profileError) {
      await admin.from("application_users").delete().eq("id", authUser.id)
        .eq("organization_id", profile.organization_id);
      if (!existingAuthUser) await admin.auth.admin.deleteUser(authUser.id);
      return NextResponse.json({ error: "The SME account type could not be configured." }, { status: 500 });
    }
    const { error: auditError } = await admin.from("application_user_sme_profile_audit").insert({
      organization_id: profile.organization_id,
      application_user_id: authUser.id,
      actor_user_id: user.id,
      previous_classification: null,
      classification: parsed.data.smeClassification,
    });
    if (auditError) {
      return NextResponse.json({
        ok: true,
        userId: authUser.id,
        emailSent: false,
        message: "The SME was added, but the SME-type audit record could not be completed. Review User Management.",
      });
    }
  }

  const now = new Date().toISOString();
  await admin.from("application_user_invitations").update({
    status: "canceled",
    canceled_at: now,
    last_error: null,
    updated_at: now,
  }).eq("organization_id", profile.organization_id).eq("normalized_email", email).in("status", ["pending", "failed"]);

  const { error: emailError } = await admin.auth.resetPasswordForEmail(email, {
    redirectTo: passwordRecoveryRedirectUrl(),
  });
  if (emailError) {
    return NextResponse.json({
      ok: true,
      userId: authUser.id,
      emailSent: false,
      message: `${email} was added to DevTrack, but the password email could not be delivered. The user can select Set up or reset your password on the sign-in page.`,
    });
  }

  return NextResponse.json({
    ok: true,
    userId: authUser.id,
    emailSent: true,
    message: `${email} was added to DevTrack and sent the standard password setup link.`,
  });
}
