import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const parsed = z.object({
    email: z.string().trim().email(),
    password: z.string().min(8).max(128)
  }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) {
    return NextResponse.json({ error: "The email or password is incorrect." }, { status: 401 });
  }

  const { data: applicationUser } = await supabase
    .from("application_users")
    .select("id")
    .eq("id", data.user.id)
    .maybeSingle();

  return NextResponse.json({ ok: true, redirectTo: applicationUser ? "/" : "/access-pending" });
}
