import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, profile, supabase } = await requireCapability("manage_operational_personas");
  const parsed = z.object({ wrikeUserId: z.string().uuid() }).safeParse(await request.json().catch(() => null));
  if (profile.role !== "super_admin" || actor.id !== id || !parsed.success) {
    return NextResponse.json({ error: "Operational persona unavailable." }, { status: 404 });
  }
  const { data, error } = await supabase.rpc("set_superadmin_id_persona", { target_wrike_user_id: parsed.data.wrikeUserId });
  return error || !(data as { ok?: boolean } | null)?.ok
    ? NextResponse.json({ error: "That Wrike identity is unavailable for the ID persona." }, { status: 409 })
    : NextResponse.json({ ok: true });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, profile, supabase } = await requireCapability("manage_operational_personas");
  if (profile.role !== "super_admin" || actor.id !== id) {
    return NextResponse.json({ error: "Operational persona unavailable." }, { status: 404 });
  }
  const { data, error } = await supabase.rpc("remove_superadmin_id_persona");
  return error || !(data as { ok?: boolean } | null)?.ok
    ? NextResponse.json({ error: "The ID persona could not be removed." }, { status: 409 })
    : NextResponse.json({ ok: true });
}
