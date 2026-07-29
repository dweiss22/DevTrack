import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";

export async function PATCH() {
  await requireCapability("manage_data");
  return NextResponse.json({
    error: "Legacy historical column mapping has been retired. Use an approved finalized CSV schema.",
  }, { status: 410 });
}
