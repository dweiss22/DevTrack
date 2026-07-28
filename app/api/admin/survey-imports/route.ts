import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { stageHistoricalSurveyFile } from "@/lib/surveys/historical-import-server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const { profile, user, supabase } = await requireCapability("manage_data");
  try {
    const form = await request.formData();
    const timezone = String(form.get("timezone") ?? "");
    const confirmed = String(form.get("confirmTimezone") ?? "") === "true";
    const supportedTimezone = timezone === "UTC" || Intl.supportedValuesOf("timeZone").includes(timezone);
    if (!confirmed || !timezone || !supportedTimezone) {
      return NextResponse.json({ error: "Confirm the timezone used by the historical timestamps." }, { status: 400 });
    }
    const files = form.getAll("files").filter((value): value is File => value instanceof File);
    if (!files.length || files.length > 10) {
      return NextResponse.json({ error: "Select between one and ten CSV files." }, { status: 400 });
    }
    const results = [];
    for (const file of files) {
      if (!file.name.toLocaleLowerCase().endsWith(".csv")) {
        return NextResponse.json({ error: `${file.name} is not a CSV file.` }, { status: 400 });
      }
      results.push(await stageHistoricalSurveyFile({
        organizationId: profile.organization_id,
        actorId: user.id,
        filename: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
        timezone,
        supabase,
      }));
    }
    revalidatePath("/admin");
    revalidatePath("/admin/surveys");
    return NextResponse.json({ ok: true, batches: results });
  } catch (error) {
    console.error("historical_survey_import_stage_failed", {
      organizationId: profile.organization_id,
      actorId: user.id,
      message: error instanceof Error ? error.message : "Unknown historical import error",
    });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Historical survey import failed." }, { status: 400 });
  }
}
