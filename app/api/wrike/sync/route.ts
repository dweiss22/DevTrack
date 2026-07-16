import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { syncOrganization } from "@/lib/wrike/sync";

export async function POST(request: NextRequest) {
  const { profile } = await requireAdmin(); const body = z.object({ scopeIds: z.array(z.string().uuid()).max(100).optional(), scopeId: z.string().uuid().optional(), mode: z.enum(["incremental", "full"]).default("incremental") }).safeParse(await request.json());
  if (!body.success) return NextResponse.json({ error: "Invalid synchronization request." }, { status: 400 });
  const scopeIds = body.data.scopeIds ?? (body.data.scopeId ? [body.data.scopeId] : undefined);
  try { return NextResponse.json(await syncOrganization(profile.organization_id, { scopeIds, mode: body.data.mode, trigger: body.data.mode === "full" ? "backfill" : "manual" })); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Sync failed." }, { status: 500 }); }
}
