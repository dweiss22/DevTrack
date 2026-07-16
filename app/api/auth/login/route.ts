import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export async function POST(request: NextRequest) {
  const parsed = z.object({ email: z.string().email() }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  const supabase = await createClient(); const { error } = await supabase.auth.signInWithOtp({ email: parsed.data.email, options: { emailRedirectTo: env.NEXT_PUBLIC_APP_URL } });
  return error ? NextResponse.json({ error: "Could not send sign-in link." }, { status: 500 }) : NextResponse.json({ ok: true });
}
