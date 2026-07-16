import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";

export async function POST() {
  await requireAdmin();
  return NextResponse.json({ error: "Configurable sync scopes are disabled during focused folder-task validation." }, { status: 410 });
}
