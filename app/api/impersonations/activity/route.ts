import { NextResponse } from "next/server";
import { requireContext } from "@/lib/auth";

export async function POST() {
  const { identity, supabase } = await requireContext();
  if (!identity.impersonating) return NextResponse.json({ error: "Impersonation is not active." }, { status: 409 });
  const { data, error } = await supabase.rpc("touch_administrator_impersonation");
  const result = data as { ok?: boolean; lastActivityAt?: string } | null;
  return error || !result?.ok
    ? NextResponse.json({ error: "The impersonation session expired." }, { status: 401 })
    : NextResponse.json({ ok: true, lastActivityAt: result.lastActivityAt });
}
