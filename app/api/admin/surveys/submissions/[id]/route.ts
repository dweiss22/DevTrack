import type { NextRequest } from "next/server";
import { requireCapability } from "@/lib/auth";
import { GET as getPersonalSurvey, PATCH as patchPersonalSurvey } from "@/app/api/surveys/[id]/route";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  await requireCapability("manage_surveys");
  return getPersonalSurvey(request, context);
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  await requireCapability("manage_surveys");
  return patchPersonalSurvey(request, context);
}
