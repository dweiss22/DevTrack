import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  const { id, attachmentId } = await params;
  const { profile, supabase } = await requireCapability("view_surveys");
  if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(attachmentId).success) return unavailable();
  const { data: canView } = await supabase.rpc("can_view_survey", { target_submission_id: id });
  if (!canView) return unavailable();
  const admin = createAdminClient();
  const { data: attachment } = await admin.from("survey_attachments").select("object_key")
    .eq("id", attachmentId).eq("submission_id", id).eq("organization_id", profile.organization_id).maybeSingle();
  if (!attachment) return unavailable();
  const { data, error } = await admin.storage.from("survey-invoices").createSignedUrl(attachment.object_key, 60, { download: true });
  return error || !data?.signedUrl
    ? NextResponse.json({ error: "The file download could not be prepared." }, { status: 500 })
    : NextResponse.json({ url: data.signedUrl });
}

function unavailable() {
  return NextResponse.json({ error: "Survey is unavailable." }, { status: 404 });
}
