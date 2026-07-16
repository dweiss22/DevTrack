import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  const { user, profile } = await requireAdmin(); const parsed = z.object({ customFieldIds: z.array(z.string().uuid()).max(100) }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid custom-field selection." }, { status: 400 });
  const db = createAdminClient(); const ids = parsed.data.customFieldIds;
  const { data: valid } = ids.length ? await db.from("wrike_custom_fields").select("id").eq("organization_id", profile.organization_id).in("id", ids) : { data: [] };
  if ((valid ?? []).length !== ids.length) return NextResponse.json({ error: "A selected custom field is outside this organization." }, { status: 400 });
  await db.from("wrike_enabled_custom_fields").delete().eq("organization_id", profile.organization_id);
  if (ids.length) { const { error } = await db.from("wrike_enabled_custom_fields").insert(ids.map((custom_field_id) => ({ organization_id: profile.organization_id, custom_field_id, enabled_by: user.id }))); if (error) return NextResponse.json({ error: "Unable to save custom fields." }, { status: 500 }); }
  return NextResponse.json({ ok: true });
}
