import { NextRequest } from "next/server";
import {
  handleAttachmentDelete,
  handleAttachmentPost,
} from "@/lib/surveys/attachment-http";

type RouteContext = { params: Promise<{ id: string }> };

// Compatibility endpoint for clients deployed before generalized file questions.
// It uses the same caller-aware attachment functions and private storage flow.
export async function POST(request: NextRequest, context: RouteContext) {
  return handleAttachmentPost(request, context, {
    fileField: "invoice",
    forcedQuestionId: "invoice",
  });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return handleAttachmentDelete(request, context);
}
