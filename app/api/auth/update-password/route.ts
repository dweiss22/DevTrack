import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const parsed = z.object({ password: z.string().min(12).max(128) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Use at least 12 characters for your new password." }, { status: 400 });

  let supabase: Awaited<ReturnType<typeof createClient>>;
  try { supabase = await createClient(); }
  catch { return NextResponse.json({ error: "Password setup is temporarily unavailable." }, { status: 503 }); }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "This password setup link is invalid or expired. Request a new link." }, { status: 401 });
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return NextResponse.json({ error: "Your password could not be updated. Request a new setup link and try again." }, { status: 400 });

  const { data: applicationUser } = await supabase.from("application_users").select("id").eq("id", user.id).maybeSingle();
  return NextResponse.json({ ok: true, redirectTo: applicationUser ? "/" : "/access-pending" });
}
