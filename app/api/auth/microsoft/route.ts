import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

function safeNext(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export async function GET(request: NextRequest) {
  const next = safeNext(request.nextUrl.searchParams.get("next"));
  const callback = new URL("/auth/callback", env.NEXT_PUBLIC_APP_URL);
  if (next !== "/") callback.searchParams.set("next", next);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "azure",
    options: { scopes: "email", redirectTo: callback.toString() }
  });

  if (error || !data.url) {
    const login = new URL("/login", env.NEXT_PUBLIC_APP_URL);
    login.searchParams.set("error", "Microsoft sign-in is temporarily unavailable. Please try again or contact a DevTrack administrator.");
    return NextResponse.redirect(login);
  }

  return NextResponse.redirect(data.url);
}
