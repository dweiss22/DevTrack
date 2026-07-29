import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";

export async function POST() {
  await requireCapability("manage_data");
  return NextResponse.json({
    error: "Legacy single-row integration has been retired. Finalize the approved-schema batch instead.",
  }, { status: 410 });
}
