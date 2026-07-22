import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function safeNext(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/";
}

function loginError(origin: string, message: string) {
  const login = new URL("/login", origin);
  login.searchParams.set("error", message);
  return NextResponse.redirect(login);
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));
  if (!code) return loginError(url.origin, "Microsoft authentication did not return a sign-in code. Please try again.");

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return loginError(url.origin, "Microsoft authentication could not be completed. Please try again.");

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return loginError(url.origin, "Microsoft authentication completed without a user account. Please try again.");

  const { data: applicationUser } = await supabase
    .from("application_users")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  return NextResponse.redirect(new URL(applicationUser ? next : "/access-pending", url.origin));
}
