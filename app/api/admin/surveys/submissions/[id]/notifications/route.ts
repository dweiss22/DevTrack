import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { dispatchPendingSmeDebriefNotifications } from "@/lib/notifications/sme-debrief";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireCapability("manage_surveys");
  const parsed = z.object({ deliveryId: z.string().uuid() })
    .safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) {
    return NextResponse.json({ error: "Select a notification delivery to retry." }, { status: 400 });
  }
  const { data: event } = await supabase.from("sme_debrief_notification_events")
    .select("id").eq("submission_id", id).maybeSingle();
  const { data: delivery } = event ? await supabase.from("sme_debrief_notification_deliveries")
    .select("id").eq("id", parsed.data.deliveryId).eq("event_id", event.id).maybeSingle()
    : { data: null };
  if (!delivery) return NextResponse.json({ error: "Notification delivery is unavailable." }, { status: 404 });
  const { error } = await supabase.rpc("retry_sme_debrief_notification_delivery", {
    target_delivery_id: delivery.id,
  });
  if (error) return NextResponse.json({ error: error.message || "Notification retry failed." }, { status: 400 });
  const result = await dispatchPendingSmeDebriefNotifications(10).catch((reason) => ({
    claimed: 0, delivered: 0, failed: 1,
    error: reason instanceof Error ? reason.message : "Notification dispatch failed.",
  }));
  return NextResponse.json({ ok: true, result });
}

