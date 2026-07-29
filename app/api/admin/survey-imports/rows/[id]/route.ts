import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";

export async function PATCH() {
  await requireCapability("manage_data");
  return NextResponse.json({
    error: "Legacy historical row correction has been retired. Use the finalized preview workflow.",
  }, { status: 410 });
}
