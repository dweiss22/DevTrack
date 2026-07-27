import type { NextRequest } from "next/server";
import { requireCapability } from "@/lib/auth";
import { POST as upload, DELETE as remove } from "@/app/api/surveys/[id]/attachments/route";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  await requireCapability("manage_surveys");
  return upload(request, context);
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  await requireCapability("manage_surveys");
  return remove(request, context);
}
