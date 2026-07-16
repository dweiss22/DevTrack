import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";

export async function POST() {
  await requireAdmin();
  return NextResponse.json({ error: "Space import is disabled while the folder task API is validated. Use the folder task import in Administration." }, { status: 410 });
}
