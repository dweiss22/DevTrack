import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import {
  IMPERSONATION_COOKIE, impersonationCookieOptions, newImpersonationToken,
} from "@/lib/auth/impersonation";

export async function POST(request: NextRequest) {
  const { supabase } = await requireCapability("impersonate_users");
  const parsed = z.object({
    targetUserId: z.string().uuid(),
    reason: z.string().trim().min(3).max(1000),
  }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Select a user and enter a reason." }, { status: 400 });
  const token = await newImpersonationToken();
  const { data, error } = await supabase.rpc("begin_administrator_impersonation", {
    target_user_id: parsed.data.targetUserId,
    impersonation_reason: parsed.data.reason,
    target_token_hash: token.hash,
  });
  const result = data as { ok?: boolean; effectiveName?: string } | null;
  if (error || !result?.ok) {
    return NextResponse.json({ error: "That user is unavailable for impersonation." }, { status: 404 });
  }
  const response = NextResponse.json({ ok: true, effectiveName: result.effectiveName });
  response.cookies.set(IMPERSONATION_COOKIE, token.token, impersonationCookieOptions());
  return response;
}
