import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { safeInternalPath } from "@/lib/auth/redirects";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const acceptedTypes = new Set<EmailOtpType>(["invite", "signup", "magiclink", "recovery", "email", "email_change"]);

function loginError(origin: string) {
  const login = new URL("/login", origin);
  login.searchParams.set("reason", "callback_failed");
  return NextResponse.redirect(login);
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const rawType = url.searchParams.get("type") as EmailOtpType | null;
  const next = safeInternalPath(url.searchParams.get("next"));
  if (!tokenHash || !rawType || !acceptedTypes.has(rawType)) return loginError(url.origin);

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: rawType });
  if (error) return loginError(url.origin);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return loginError(url.origin);

  if (rawType === "recovery" && next !== "/account-setup") return NextResponse.redirect(new URL("/update-password", url.origin));
  if (user.email) {
    await createAdminClient().rpc("accept_application_user_invitation", {
      target_user_id: user.id,
      target_email: user.email,
    });
  }

  const { data: applicationUser } = await supabase.from("application_users")
    .select("id,profile_completed")
    .eq("id", user.id)
    .maybeSingle();
  if (!applicationUser) return NextResponse.redirect(new URL("/access-pending", url.origin));
  if (!applicationUser.profile_completed) return NextResponse.redirect(new URL("/account-setup", url.origin));
  return NextResponse.redirect(new URL(next, url.origin));
}
