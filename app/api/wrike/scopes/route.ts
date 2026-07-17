import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";

export async function POST() {
  await requireAdmin();
  return NextResponse.json({ error: "Configurable sync scopes are disabled while the combined 13-folder importer is active." }, { status: 410 });
}
