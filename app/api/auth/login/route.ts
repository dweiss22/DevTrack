import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { safeInternalPath } from "@/lib/auth/redirects";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const parsed = z.object({
    email: z.string().trim().email(),
    password: z.string().min(8).max(128),
    next: z.string().max(2000).optional()
  }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });

  let supabase: Awaited<ReturnType<typeof createClient>>;
  try { supabase = await createClient(); }
  catch { return NextResponse.json({ error: "Sign-in is not configured. Contact a DevTrack administrator." }, { status: 503 }); }
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) {
    return NextResponse.json({ error: "The email or password is incorrect." }, { status: 401 });
  }

  const { data: applicationUser } = await supabase
    .from("application_users")
    .select("id,profile_completed")
    .eq("id", data.user.id)
    .maybeSingle();

  const redirectTo = !applicationUser ? "/access-pending" : applicationUser.profile_completed ? safeInternalPath(parsed.data.next) : "/account-setup";
  return NextResponse.json({ ok: true, redirectTo });
}
