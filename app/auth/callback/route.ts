import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function safeNext(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=Authentication%20did%20not%20return%20a%20code.", url.origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL("/login?error=Authentication%20could%20not%20be%20completed.", url.origin));
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login?error=No%20authenticated%20user%20was%20returned.", url.origin));
  }

  const { data: applicationUser } = await supabase
    .from("application_users")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  return NextResponse.redirect(new URL(applicationUser ? next : "/access-pending", url.origin));
}
