import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  if (!env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) return new NextResponse("Unauthorized", { status: 401 });
  const { data, error } = await createAdminClient().rpc("cleanup_reporting_messages", { retention_days: 90 });
  if (error) return NextResponse.json({ error: "Reporting cleanup failed." }, { status: 500 });
  return NextResponse.json({ deletedMessages: data ?? 0 });
}
