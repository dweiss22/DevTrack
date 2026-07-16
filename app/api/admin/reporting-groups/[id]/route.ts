import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const { profile } = await requireAdmin();
  const { error } = await createAdminClient().from("reporting_groups").delete().eq("id", id).eq("organization_id", profile.organization_id);
  if (error) return NextResponse.json({ error: "Unable to delete the reporting group." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
