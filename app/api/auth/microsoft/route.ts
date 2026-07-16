import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "azure",
    options: {
      scopes: "email",
      redirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/callback`
    }
  });

  if (error || !data.url) {
    return NextResponse.redirect(
      `${env.NEXT_PUBLIC_APP_URL}/login?error=${encodeURIComponent("Microsoft sign-in is not configured yet.")}`
    );
  }

  return NextResponse.redirect(data.url);
}
