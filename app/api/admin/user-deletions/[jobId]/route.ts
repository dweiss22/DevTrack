import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const { supabase } = await requireCapability("delete_users");
  if (!z.string().uuid().safeParse(jobId).success) return NextResponse.json({ error: "Deletion unavailable." }, { status: 404 });
  const { data, error } = await supabase.rpc("user_deletion_status", { target_deletion_id: jobId });
  return error || !data
    ? NextResponse.json({ error: "Deletion unavailable." }, { status: 404 })
    : NextResponse.json({ deletion: data });
}
