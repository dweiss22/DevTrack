import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { findAuthenticationUserByEmail, normalizeInvitationEmail, passwordRecoveryRedirectUrl } from "@/lib/users/invitations";

export async function POST(request: NextRequest) {
  const { profile, user } = await requireCapability("manage_smes");
  const parsed = z.object({ email: z.string().trim().email().max(320) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid SME email address." }, { status: 400 });
  const admin = createAdminClient(); const email = normalizeInvitationEmail(parsed.data.email);
  let existing;
  try { existing = await findAuthenticationUserByEmail(admin, email); } catch {
    return NextResponse.json({ error: "DevTrack could not verify this email." }, { status: 500 });
  }
  if (existing) {
    const { data: membership } = await admin.from("application_users").select("id").eq("id", existing.id).maybeSingle();
    if (membership) return NextResponse.json({ error: "This email already has DevTrack access." }, { status: 409 });
  }
  const created = existing ? { user: existing } : (await admin.auth.admin.createUser({ email, email_confirm: true })).data;
  if (!created.user) return NextResponse.json({ error: "The authentication account could not be created." }, { status: 502 });
  const { error: membershipError } = await admin.from("application_users").insert({
    id: created.user.id, organization_id: profile.organization_id, display_name: null,
    role: "sme", profile_completed: true, updated_at: new Date().toISOString(),
  });
  if (membershipError) {
    if (!existing) await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: "The SME account could not be added." }, { status: 500 });
  }
  const { error: accessError } = await admin.from("application_user_operational_personas").insert({
    organization_id: profile.organization_id, application_user_id: created.user.id,
    operational_role: "sme", wrike_user_id: null, created_by: user.id, updated_by: user.id,
  });
  if (accessError) return NextResponse.json({ error: "The account was created, but SME access could not be initialized." }, { status: 500 });
  const { error: emailError } = await admin.auth.resetPasswordForEmail(email, { redirectTo: passwordRecoveryRedirectUrl() });
  return NextResponse.json({ ok: true, emailSent: !emailError,
    message: emailError ? `${email} was added, but the password email could not be delivered.` : `${email} was added and sent a password setup link.` });
}
