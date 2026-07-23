import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { landingPageForRole, normalizeApplicationRole } from "@/lib/auth/roles";

const schema = z.object({
  displayName: z.string().trim().min(2).max(100),
  password: z.string().min(12).max(128),
});

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a display name and a password of at least 12 characters." }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "This setup session is invalid or expired. Request a new invitation." }, { status: 401 });

  const admin = createAdminClient();
  const { data: membership } = await admin.from("application_users").select("id,profile_completed,role").eq("id", user.id).maybeSingle();
  if (!membership) return NextResponse.json({ error: "This account does not have a valid DevTrack invitation." }, { status: 403 });

  const { error: passwordError } = await supabase.auth.updateUser({
    password: parsed.data.password,
    data: { display_name: parsed.data.displayName },
  });
  if (passwordError) return NextResponse.json({ error: "Your password could not be saved. Request a new setup link and try again." }, { status: 400 });

  const { error: profileError } = await admin.from("application_users").update({
    display_name: parsed.data.displayName,
    profile_completed: true,
    updated_at: new Date().toISOString(),
  }).eq("id", user.id);
  if (profileError) return NextResponse.json({ error: "Your password was saved, but your profile could not be completed. Please retry." }, { status: 500 });
  return NextResponse.json({ ok: true, redirectTo: landingPageForRole(normalizeApplicationRole(membership.role)) });
}
