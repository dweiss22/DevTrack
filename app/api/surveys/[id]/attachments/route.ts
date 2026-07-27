import { NextRequest } from "next/server";
import {
  handleAttachmentDelete,
  handleAttachmentPost,
  type SurveyAttachmentRouteContext,
} from "@/lib/surveys/attachment-http";

export async function POST(request: NextRequest, context: SurveyAttachmentRouteContext) {
  return handleAttachmentPost(request, context);
}

export async function DELETE(request: NextRequest, context: SurveyAttachmentRouteContext) {
  return handleAttachmentDelete(request, context);
}
