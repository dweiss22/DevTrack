import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { findAuthenticationUserByEmail, normalizeInvitationEmail, passwordRecoveryRedirectUrl } from "@/lib/users/invitations";

export async function POST(request: NextRequest) {
  const parsed = z.object({ email: z.string().trim().email() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });

  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); }
  catch { return NextResponse.json({ error: "Password setup is temporarily unavailable. Please retry." }, { status: 503 }); }

  const email = normalizeInvitationEmail(parsed.data.email);
  try {
    const authUser = await findAuthenticationUserByEmail(admin, email);
    if (authUser) {
      const { data: membership } = await admin.from("application_users")
        .select("id,account_state")
        .eq("id", authUser.id)
        .eq("account_state", "active")
        .maybeSingle();
      if (membership) {
        await admin.auth.resetPasswordForEmail(email, { redirectTo: passwordRecoveryRedirectUrl() });
      }
    }
  } catch {
    // The response remains intentionally generic so account existence and
    // delivery-provider details are never disclosed to an anonymous caller.
  }
  return NextResponse.json({ ok: true, message: "If this email belongs to an active DevTrack user, a secure password link has been sent." });
}
