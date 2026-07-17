import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { seal, verifyState } from "@/lib/security";
import { exchangeCode, WRIKE_OAUTH_SCOPES } from "@/lib/wrike/oauth";
import { WrikeClient, wrikeBaseUrlForHost } from "@/lib/wrike/client";

export async function GET(request: NextRequest) {
  const url = new URL(request.url); const code = url.searchParams.get("code"); const stateValue = url.searchParams.get("state");
  try {
    if (!code || !stateValue) throw new Error("Wrike did not return an authorization code.");
    const state = verifyState(stateValue);
    const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.id !== state.userId) throw new Error("Your sign-in session changed during Wrike authorization. Please try again.");
    const token = await exchangeCode(code);
    if (!token.host) throw new Error("Wrike did not return an API host.");
    const apiBaseUrl = wrikeBaseUrlForHost(token.host);
    const api = new WrikeClient(token.access_token, apiBaseUrl);
    const account = await api.request<{ data: { id?: string; name?: string }[] }>("/account");
    const db = createAdminClient();
    const { error } = await db.from("wrike_connections").upsert({ organization_id: state.organizationId, connected_by: user.id, wrike_account_id: account.data[0]?.id ?? null, account_name: account.data[0]?.name ?? null, api_host: new URL(apiBaseUrl).host, api_base_url: apiBaseUrl, oauth_scopes: [...WRIKE_OAUTH_SCOPES], encrypted_access_token: seal(token.access_token), encrypted_refresh_token: seal(token.refresh_token), token_expires_at: new Date(Date.now() + Number(token.expires_in) * 1000).toISOString(), status: "connected", last_error: null, updated_at: new Date().toISOString() }, { onConflict: "organization_id" });
    if (error) throw error;
    return NextResponse.redirect(new URL("/admin?connected=1", request.url));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to connect Wrike.";
    return NextResponse.redirect(new URL(`/admin?error=${encodeURIComponent(message)}`, request.url));
  }
}
