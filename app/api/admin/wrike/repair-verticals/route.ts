import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { repairVerticalData } from "@/lib/wrike/vertical-repair";

export async function POST() {
  const { profile } = await requireAdmin();
  try {
    const result = await repairVerticalData(profile.organization_id);
    for (const path of ["/", "/development", "/projects", "/id-dashboard", "/sme-dashboard", "/admin"]) revalidatePath(path);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Vertical repair failed.";
    return NextResponse.json({ error: message }, { status: message.includes("already running") ? 409 : 500 });
  }
}
