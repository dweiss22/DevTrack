import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireCapability("delete_users");
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "User unavailable." }, { status: 404 });
  const { data, error } = await supabase.rpc("user_deletion_preview", { target_user_id: id });
  return error || !data
    ? NextResponse.json({ error: "User unavailable." }, { status: 404 })
    : NextResponse.json({ preview: data });
}
