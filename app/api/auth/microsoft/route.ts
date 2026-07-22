import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { safeInternalPath } from "@/lib/auth/redirects";

export async function GET(request: NextRequest) {
  const next = safeInternalPath(request.nextUrl.searchParams.get("next"));
  let callback: URL;
  try { callback = new URL("/auth/callback", env.NEXT_PUBLIC_APP_URL); }
  catch {
    const login = new URL("/login", request.url);
    login.searchParams.set("reason", "configuration_missing");
    return NextResponse.redirect(login);
  }
  if (next !== "/") callback.searchParams.set("next", next);

  let supabase: Awaited<ReturnType<typeof createClient>>;
  try { supabase = await createClient(); }
  catch {
    const login = new URL("/login", request.url);
    login.searchParams.set("reason", "configuration_missing");
    return NextResponse.redirect(login);
  }
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "azure",
    options: { scopes: "email", redirectTo: callback.toString() }
  });

  if (error || !data.url) {
    const login = new URL("/login", request.url);
    login.searchParams.set("reason", "microsoft_unavailable");
    return NextResponse.redirect(login);
  }

  return NextResponse.redirect(data.url);
}
