import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncScope } from "@/lib/wrike/sync";

export async function GET(request: NextRequest) {
  if (!env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) return new NextResponse("Unauthorized", { status: 401 });
  const db = createAdminClient(); const { data: scopes, error } = await db.from("wrike_sync_scopes").select("id,organization_id").eq("is_active", true);
  if (error) return NextResponse.json({ error: "Unable to load sync scopes." }, { status: 500 });
  const results = await Promise.allSettled((scopes ?? []).map((scope) => syncScope(scope.organization_id, scope.id, "scheduled")));
  return NextResponse.json({ processed: results.length, failed: results.filter((result) => result.status === "rejected").length });
}
