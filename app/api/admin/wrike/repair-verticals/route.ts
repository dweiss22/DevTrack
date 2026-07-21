import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { repairVerticalData } from "@/lib/wrike/vertical-repair";

export async function POST() {
  const { profile } = await requireAdmin();
  try {
    return NextResponse.json({ ok: true, ...(await repairVerticalData(profile.organization_id)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Vertical repair failed.";
    return NextResponse.json({ error: message }, { status: message.includes("already running") ? 409 : 500 });
  }
}
