import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { applicationRoleSchema } from "@/lib/users/invitations";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile } = await requireAdmin();
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid organization member." }, { status: 400 });
  const parsed = z.object({ role: applicationRoleSchema }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Select a valid application role." }, { status: 400 });

  const { error } = await createAdminClient().rpc("change_application_user_role", {
    target_organization_id: profile.organization_id,
    target_user_id: id,
    target_role: parsed.data.role,
  });
  if (error) {
    const lastAdmin = error.code === "23514" || error.message?.includes("last organization administrator");
    return NextResponse.json(
      { error: lastAdmin ? "The last administrator for an organization cannot be demoted." : "The member role could not be updated." },
      { status: lastAdmin ? 409 : 404 },
    );
  }
  return NextResponse.json({ ok: true });
}
