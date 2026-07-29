import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";

export async function POST() {
  await requireCapability("manage_data");
  return NextResponse.json({
    error: "Legacy revalidation has been retired. Upload the finalized CSV again for a new inspection.",
  }, { status: 410 });
}
