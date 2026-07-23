import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { IMPERSONATION_COOKIE, impersonationCookieOptions } from "@/lib/auth/impersonation";

export async function DELETE() {
  const supabase = await createClient();
  await supabase.rpc("end_administrator_impersonation");
  const response = NextResponse.json({ ok: true });
  response.cookies.set(IMPERSONATION_COOKIE, "", impersonationCookieOptions(0));
  return response;
}
