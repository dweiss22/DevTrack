import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { applicationUserDisplayName } from "@/lib/users/application-user-display";

const approvalSchema = z.object({ userId: z.string().uuid() });

export async function POST(request: NextRequest) {
  const { profile } = await requireAdmin();
  const parsed = approvalSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Select a valid account to approve." }, { status: 400 });

  const admin = createAdminClient();
  const { data: authentication, error: authenticationError } = await admin.auth.admin.getUserById(parsed.data.userId);
  if (authenticationError || !authentication.user) {
    return NextResponse.json({ error: "That authentication account no longer exists." }, { status: 404 });
  }

  const { data: existingUser, error: lookupError } = await admin
    .from("application_users")
    .select("id")
    .eq("id", parsed.data.userId)
    .maybeSingle();
  if (lookupError) return NextResponse.json({ error: "DevTrack could not verify the account's current access." }, { status: 500 });
  if (existingUser) return NextResponse.json({ error: "That account already has DevTrack access." }, { status: 409 });

  const { error: insertError } = await admin.from("application_users").insert({
    id: authentication.user.id,
    organization_id: profile.organization_id,
    display_name: applicationUserDisplayName(null, authentication.user),
    role: "member",
  });
  if (insertError) {
    const alreadyApproved = insertError.code === "23505";
    return NextResponse.json(
      { error: alreadyApproved ? "That account already has DevTrack access." : "DevTrack could not approve the account." },
      { status: alreadyApproved ? 409 : 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
