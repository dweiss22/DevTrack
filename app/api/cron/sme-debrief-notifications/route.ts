import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import {
  cleanupQueuedPrivateObjects,
  dispatchPendingSmeDebriefNotifications,
} from "@/lib/notifications/sme-debrief";

export async function GET(request: NextRequest) {
  if (!env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const [notifications, cleanup] = await Promise.all([
    dispatchPendingSmeDebriefNotifications(25),
    cleanupQueuedPrivateObjects(50),
  ]);
  return NextResponse.json({ notifications, cleanup });
}

