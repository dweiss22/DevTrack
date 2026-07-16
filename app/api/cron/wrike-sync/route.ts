import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncOrganization } from "@/lib/wrike/sync";

export async function GET(request: NextRequest) {
  if (!env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) return new NextResponse("Unauthorized", { status: 401 });
  const db = createAdminClient(); const { data: scopes, error } = await db.from("wrike_sync_scopes").select("organization_id").eq("is_active", true);
  if (error) return NextResponse.json({ error: "Unable to load sync scopes." }, { status: 500 });
  const organizationIds = [...new Set((scopes ?? []).map((scope) => scope.organization_id))];
  const mode = new Date().getUTCDay() === 0 ? "full" as const : "incremental" as const;
  const results = [];
  for (const organizationId of organizationIds) results.push(await Promise.resolve(syncOrganization(organizationId, { mode, trigger: "scheduled" })).then((value) => ({ status: "fulfilled" as const, value })).catch((reason) => ({ status: "rejected" as const, reason })));
  return NextResponse.json({ processed: results.length, failed: results.filter((result) => result.status === "rejected").length });
}
