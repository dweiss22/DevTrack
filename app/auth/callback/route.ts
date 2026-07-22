import { NextRequest, NextResponse } from "next/server";
import { safeInternalPath } from "@/lib/auth/redirects";
import { createClient } from "@/lib/supabase/server";

function loginError(origin: string) {
  const login = new URL("/login", origin);
  login.searchParams.set("reason", "callback_failed");
  return NextResponse.redirect(login);
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeInternalPath(url.searchParams.get("next"));
  if (!code) return loginError(url.origin);

  let supabase: Awaited<ReturnType<typeof createClient>>;
  try { supabase = await createClient(); }
  catch { return loginError(url.origin); }
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return loginError(url.origin);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return loginError(url.origin);

  // A valid recovery session must reach password setup before application
  // approval is evaluated. The update-password API performs the session check
  // again and routes unapproved learners to access pending after the update.
  if (next === "/update-password") return NextResponse.redirect(new URL(next, url.origin));

  const { data: applicationUser } = await supabase
    .from("application_users")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  return NextResponse.redirect(new URL(applicationUser ? next : "/access-pending", url.origin));
}
