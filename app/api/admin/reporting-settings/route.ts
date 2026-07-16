import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  const { profile } = await requireAdmin(); const parsed = z.object({ timezone: z.string().min(3).max(100), reportingAccessEnforced: z.boolean(), askEnabled: z.boolean() }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid reporting settings." }, { status: 400 });
  try { new Intl.DateTimeFormat("en", { timeZone: parsed.data.timezone }); } catch { return NextResponse.json({ error: "Unknown IANA timezone." }, { status: 400 }); }
  const { error } = await createAdminClient().from("organizations").update({ timezone: parsed.data.timezone, reporting_access_enforced: parsed.data.reportingAccessEnforced, ask_enabled: parsed.data.askEnabled, updated_at: new Date().toISOString() }).eq("id", profile.organization_id);
  if (error) return NextResponse.json({ error: "Unable to save reporting settings." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
