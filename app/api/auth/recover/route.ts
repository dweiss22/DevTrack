import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const parsed = z.object({ email: z.string().trim().email() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) return NextResponse.json({ error: "Password setup is not configured. Contact a DevTrack administrator." }, { status: 503 });

  let supabase: Awaited<ReturnType<typeof createClient>>;
  try { supabase = await createClient(); }
  catch { return NextResponse.json({ error: "Password setup is temporarily unavailable. Please retry." }, { status: 503 }); }

  await supabase.auth.resetPasswordForEmail(parsed.data.email, { redirectTo: new URL("/auth/callback?next=/update-password", appUrl).toString() });
  return NextResponse.json({ ok: true, message: "If that account is eligible, a secure password setup link has been sent." });
}
