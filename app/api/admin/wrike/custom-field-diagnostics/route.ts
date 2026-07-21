import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { diagnoseWrikeTaskCustomFields } from "@/lib/wrike/custom-field-diagnostics";

export async function GET(request: NextRequest) {
  const { profile } = await requireAdmin();
  try {
    const taskIds = request.nextUrl.searchParams.getAll("taskId");
    return NextResponse.json(await diagnoseWrikeTaskCustomFields(profile.organization_id, taskIds));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Custom-field diagnostic failed.";
    return NextResponse.json({ error: message }, { status: /required|limited|invalid/i.test(message) ? 400 : 500 });
  }
}
