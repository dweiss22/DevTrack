import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { seal, unseal } from "@/lib/security";
import { wrikeBaseUrlForHost } from "@/lib/wrike/client";

export type TokenResponse = { access_token: string; refresh_token: string; expires_in: number | string; host?: string };
export function callbackUrl() { return `${env.NEXT_PUBLIC_APP_URL}/api/wrike/callback`; }
async function tokenRequest(values: Record<string, string>, tokenBaseUrl = env.WRIKE_OAUTH_BASE_URL): Promise<TokenResponse> {
  if (!env.WRIKE_CLIENT_ID || !env.WRIKE_CLIENT_SECRET) throw new Error("Wrike OAuth is not configured.");
  const response = await fetch(`${tokenBaseUrl.replace(/\/$/, "")}/oauth2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: env.WRIKE_CLIENT_ID, client_secret: env.WRIKE_CLIENT_SECRET, ...values }), cache: "no-store" });
  if (!response.ok) throw new Error("Wrike could not issue an access token. Confirm the OAuth credentials and callback URL.");
  return response.json() as Promise<TokenResponse>;
}
export async function exchangeCode(code: string) { return tokenRequest({ grant_type: "authorization_code", code, redirect_uri: callbackUrl() }); }
export async function wrikeSessionFor(organizationId: string) {
  const db = createAdminClient();
  const { data: connection, error } = await db.from("wrike_connections").select("*").eq("organization_id", organizationId).single();
  if (error || !connection || connection.status !== "connected") throw new Error("No active Wrike connection.");
  if (!connection.api_host || !connection.api_base_url) throw new Error("Reconnect Wrike to capture the account data-center host.");
  const apiBaseUrl = wrikeBaseUrlForHost(connection.api_host);
  if (apiBaseUrl !== connection.api_base_url) throw new Error("Stored Wrike API host is invalid. Reconnect Wrike.");
  if (!connection.token_expires_at || new Date(connection.token_expires_at) > new Date(Date.now() + 60_000)) return { accessToken: unseal(connection.encrypted_access_token), apiBaseUrl, connection };
  try {
    const refreshed = await tokenRequest({ grant_type: "refresh_token", refresh_token: unseal(connection.encrypted_refresh_token), scope: "wsReadOnly" }, `https://${connection.api_host}`);
    const refreshedApiBaseUrl = refreshed.host ? wrikeBaseUrlForHost(refreshed.host) : apiBaseUrl;
    const refreshedHost = new URL(refreshedApiBaseUrl).host;
    const token_expires_at = new Date(Date.now() + Number(refreshed.expires_in) * 1000).toISOString();
    await db.from("wrike_connections").update({ api_host: refreshedHost, api_base_url: refreshedApiBaseUrl, encrypted_access_token: seal(refreshed.access_token), encrypted_refresh_token: seal(refreshed.refresh_token), token_expires_at, status: "connected", last_error: null, updated_at: new Date().toISOString() }).eq("id", connection.id);
    return { accessToken: refreshed.access_token, apiBaseUrl: refreshedApiBaseUrl, connection: { ...connection, api_host: refreshedHost, api_base_url: refreshedApiBaseUrl, token_expires_at } };
  } catch (error) {
    await db.from("wrike_connections").update({ status: "expired", last_error: error instanceof Error ? error.message : "Token refresh failed." }).eq("id", connection.id);
    throw error;
  }
}

export async function accessTokenFor(organizationId: string) { return (await wrikeSessionFor(organizationId)).accessToken; }
