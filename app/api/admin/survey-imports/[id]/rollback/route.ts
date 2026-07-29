import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";

export async function POST() {
  await requireCapability("manage_data");
  return NextResponse.json({
    error: "Legacy batch rollback has been retired. Historical audit records remain read-only.",
  }, { status: 410 });
}
