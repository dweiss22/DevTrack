import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";

export async function POST() {
  await requireAdmin();
  return NextResponse.json({ error: "Scope preview is disabled. Use the configured folder task import in Administration." }, { status: 410 });
}
