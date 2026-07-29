import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { stageFinalizedHistoricalSurveyFile } from "@/lib/surveys/finalized-historical-import-server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const { profile, user } = await requireCapability("manage_data");
  try {
    const form = await request.formData();
    const timezone = String(form.get("timezone") ?? "");
    const confirmed = String(form.get("confirmTimezone") ?? "") === "true";
    const supportedTimezone = timezone === "UTC" || Intl.supportedValuesOf("timeZone").includes(timezone);
    if (!confirmed || !timezone || !supportedTimezone) {
      return NextResponse.json({ error: "Confirm the timezone used by the historical timestamps." }, { status: 400 });
    }
    const fileValue = form.get("file") ?? form.get("files");
    if (!(fileValue instanceof File)) {
      return NextResponse.json({ error: "Select one finalized historical survey CSV file." }, { status: 400 });
    }
    const result = await stageFinalizedHistoricalSurveyFile({
      organizationId: profile.organization_id,
      actorId: user.id,
      filename: fileValue.name,
      bytes: new Uint8Array(await fileValue.arrayBuffer()),
      timezone,
    });
    revalidatePath("/admin");
    revalidatePath("/admin/survey-imports");
    revalidatePath("/admin/surveys");
    return NextResponse.json({ ok: true, batch: result, batches: [result] });
  } catch (error) {
    console.error("historical_survey_import_stage_failed", {
      organizationId: profile.organization_id,
      actorId: user.id,
      message: error instanceof Error ? error.message : "Unknown historical import error",
    });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Historical survey import failed." }, { status: 400 });
  }
}
