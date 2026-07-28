import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { smeClassificationSchema } from "@/lib/smes/domain";
import { cleanupQueuedPrivateObjects } from "@/lib/notifications/sme-debrief";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireCapability("manage_users");
  const parsed = z.object({ classification: smeClassificationSchema })
    .safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) {
    return NextResponse.json({ error: "Select Internal SME or External SME." }, { status: 400 });
  }
  const { data, error } = await supabase.rpc("set_application_user_sme_classification", {
    target_application_user_id: id,
    target_classification: parsed.data.classification,
  });
  if (error) {
    return NextResponse.json(
      { error: error.message || "SME type could not be updated." },
      { status: error.code === "42501" ? 403 : 400 },
    );
  }
  void cleanupQueuedPrivateObjects(25).catch((reason) => {
    console.error("sme_classification_cleanup_failed", {
      message: reason instanceof Error ? reason.message : "Unknown cleanup failure",
    });
  });
  return NextResponse.json({ ok: true, profile: data });
}

