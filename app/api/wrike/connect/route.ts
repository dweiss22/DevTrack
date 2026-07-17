import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { requireAdmin } from "@/lib/auth";
import { signedState } from "@/lib/security";
import { callbackUrl, WRIKE_OAUTH_SCOPE } from "@/lib/wrike/oauth";

export async function GET() {
  const { user, profile } = await requireAdmin();
  if (!env.WRIKE_CLIENT_ID) return NextResponse.json({ error: "Wrike OAuth is not configured." }, { status: 503 });
  const query = new URLSearchParams({ client_id: env.WRIKE_CLIENT_ID, response_type: "code", redirect_uri: callbackUrl(), scope: WRIKE_OAUTH_SCOPE, state: signedState({ userId: user.id, organizationId: profile.organization_id }) });
  return NextResponse.redirect(`${env.WRIKE_OAUTH_BASE_URL}/oauth2/authorize/v4?${query}`);
}
