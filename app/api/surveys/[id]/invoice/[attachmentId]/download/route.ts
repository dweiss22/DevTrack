import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  const { id, attachmentId } = await params;
  const { supabase } = await requireCapability("view_surveys");
  if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(attachmentId).success) {
    return NextResponse.json({ error: "Invoice is unavailable." }, { status: 404 });
  }
  const { data: allowed } = await supabase.rpc("can_view_survey", { target_submission_id: id });
  if (!allowed) return NextResponse.json({ error: "Invoice is unavailable." }, { status: 404 });
  const admin = createAdminClient();
  const { data: attachment } = await admin.from("survey_attachments").select("object_key")
    .eq("id", attachmentId).eq("submission_id", id).eq("is_active", true).maybeSingle();
  if (!attachment) return NextResponse.json({ error: "Invoice is unavailable." }, { status: 404 });
  const { data, error } = await admin.storage.from("survey-invoices").createSignedUrl(attachment.object_key, 60);
  return error || !data
    ? NextResponse.json({ error: "The invoice download could not be prepared." }, { status: 500 })
    : NextResponse.json({ url: data.signedUrl, expiresIn: 60 });
}
