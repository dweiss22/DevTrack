import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";

export async function POST() {
  await requireAdmin();
  return NextResponse.json({ error: "Account-wide Wrike import is disabled. Use the folder task import in Administration." }, { status: 410 });
}
