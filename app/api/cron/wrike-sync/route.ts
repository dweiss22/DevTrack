import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";

export async function GET(request: NextRequest) {
  if (!env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) return new NextResponse("Unauthorized", { status: 401 });
  return NextResponse.json({ skipped: true, reason: "Scheduled multi-API synchronization is disabled while the folder task import is being validated." });
}
