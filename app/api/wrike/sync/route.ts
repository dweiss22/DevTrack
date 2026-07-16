import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { syncScope } from "@/lib/wrike/sync";

export async function POST(request: NextRequest) {
  const { profile } = await requireAdmin(); const body = z.object({ scopeId: z.string().uuid() }).safeParse(await request.json());
  if (!body.success) return NextResponse.json({ error: "A valid scope is required." }, { status: 400 });
  try { return NextResponse.json(await syncScope(profile.organization_id, body.data.scopeId)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Sync failed." }, { status: 500 }); }
}
