import { requireCapability } from "@/lib/auth";
import { GET as download } from "@/app/api/surveys/[id]/attachments/[attachmentId]/download/route";

export async function GET(request: Request, context: { params: Promise<{ id: string; attachmentId: string }> }) {
  await requireCapability("manage_surveys");
  return download(request, context);
}
