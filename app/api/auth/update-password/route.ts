import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { landingPageForRole, normalizeApplicationRole } from "@/lib/auth/roles";

export async function POST(request: NextRequest) {
  const parsed = z.object({ password: z.string().min(12).max(128) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Use at least 12 characters for your new password." }, { status: 400 });

  let supabase: Awaited<ReturnType<typeof createClient>>;
  try { supabase = await createClient(); }
  catch { return NextResponse.json({ error: "Password setup is temporarily unavailable." }, { status: 503 }); }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "This password setup link is invalid or expired. Request a new link." }, { status: 401 });

  let admin: ReturnType<typeof createAdminClient> | null = null;
  if (user.email) {
    try {
      admin = createAdminClient();
      await admin.rpc("accept_application_user_invitation", {
        target_user_id: user.id,
        target_email: user.email,
      });
    } catch {
      // New accounts already have membership. This compatibility call exists
      // only so an unexpired legacy invitation can enter the same password flow.
    }
  }

  const { data: applicationUser } = await supabase.from("application_users")
    .select("id,role,account_state,profile_completed")
    .eq("id", user.id)
    .eq("account_state", "active")
    .maybeSingle();
  if (!applicationUser) return NextResponse.json({ error: "This account does not have active DevTrack access." }, { status: 403 });

  if (!applicationUser.profile_completed) {
    try { admin ??= createAdminClient(); }
    catch { return NextResponse.json({ error: "DevTrack could not finish activating this account. Contact an administrator." }, { status: 503 }); }
    const { error: activationError } = await admin.from("application_users")
      .update({ profile_completed: true, updated_at: new Date().toISOString() })
      .eq("id", user.id)
      .eq("account_state", "active");
    if (activationError) return NextResponse.json({ error: "DevTrack could not finish activating this account. Contact an administrator." }, { status: 500 });
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return NextResponse.json({ error: "Your password could not be updated. Request a new setup link and try again." }, { status: 400 });

  await supabase.auth.signOut({ scope: "others" });
  return NextResponse.json({ ok: true, redirectTo: landingPageForRole(normalizeApplicationRole(applicationUser.role)) });
}
