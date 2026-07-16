import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { WrikeClient } from "@/lib/wrike/client";
import { wrikeSessionFor } from "@/lib/wrike/oauth";

export async function GET() {
  const { profile } = await requireAdmin();
  const started = Date.now();
  try {
    const session = await wrikeSessionFor(profile.organization_id);
    const account = await new WrikeClient(session.accessToken, session.apiBaseUrl).request<{ data: { id: string; name: string }[] }>("/account");
    const { data: lastRun } = await createAdminClient().from("wrike_sync_runs").select("status,completed_at,record_counts,error_summary").eq("organization_id", profile.organization_id).in("status", ["succeeded", "partial"]).order("completed_at", { ascending: false }).limit(1).maybeSingle();
    return NextResponse.json({ ok: true, account: account.data[0] ?? null, apiHost: session.connection.api_host, tokenExpiresAt: session.connection.token_expires_at, latencyMs: Date.now() - started, lastRun });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Wrike health check failed.", latencyMs: Date.now() - started }, { status: 502 });
  }
}
