import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireCapability("delete_users");
  const parsed = z.object({
    reason: z.string().trim().min(3).max(2000),
    confirmationEmail: z.string().trim().email(),
  }).safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) {
    return NextResponse.json({ error: "Enter the user email and a deletion reason." }, { status: 400 });
  }
  const { data, error } = await supabase.rpc("begin_user_deletion", {
    target_user_id: id,
    deletion_reason: parsed.data.reason,
    confirmation_email: parsed.data.confirmationEmail,
  });
  const result = data as { ok?: boolean; id?: string } | null;
  return error || !result?.ok || !result.id
    ? NextResponse.json({ error: "User unavailable." }, { status: 404 })
    : NextResponse.json({ deletion: result });
}
