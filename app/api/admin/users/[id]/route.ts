import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { applicationRoleSchema } from "@/lib/users/invitations";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, profile } = await requireCapability("manage_users");
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid organization member." }, { status: 400 });
  const parsed = z.object({ role: applicationRoleSchema }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Select a valid application role." }, { status: 400 });

  const { error } = await createAdminClient().rpc("change_application_user_role", {
    target_organization_id: profile.organization_id,
    target_user_id: id,
    target_role: parsed.data.role,
    acting_user_id: user.id,
  });
  if (error) {
    const protectedSuperAdmin = error.code === "23514" || error.code === "42501";
    return NextResponse.json(
      { error: protectedSuperAdmin ? "The required SuperAdmin account and role cannot be modified." : "The member role could not be updated." },
      { status: protectedSuperAdmin ? 409 : 404 },
    );
  }
  return NextResponse.json({ ok: true });
}
