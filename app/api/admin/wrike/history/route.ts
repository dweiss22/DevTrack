import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function DELETE() {
  const { profile } = await requireAdmin();
  const { data, error } = await createAdminClient().rpc("clear_wrike_run_history", {
    target_organization_id: profile.organization_id
  });

  if (error) {
    return NextResponse.json({ error: "Unable to clear history." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, ...(data ?? {}) });
}
