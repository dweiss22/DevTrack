import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";

export async function GET() {
  await requireAdmin();
  return NextResponse.json({ error: "Wrike source discovery is disabled while the combined 13-folder importer is active." }, { status: 410 });
}
