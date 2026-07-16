import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST() {
  const { profile } = await requireAdmin();
  const { error } = await createAdminClient().from("wrike_connections").update({ status: "disconnected", encrypted_access_token: "revoked", encrypted_refresh_token: "revoked", token_expires_at: null, updated_at: new Date().toISOString() }).eq("organization_id", profile.organization_id);
  if (error) return NextResponse.json({ error: "Unable to disconnect Wrike." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
