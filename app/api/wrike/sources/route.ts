import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";

export async function GET() {
  await requireAdmin();
  return NextResponse.json({ error: "Wrike source discovery is disabled during focused folder-task validation." }, { status: 410 });
}
