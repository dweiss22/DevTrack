import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import {
  finalizedHistoricalTemplate,
  HISTORICAL_SURVEY_TYPES,
  type HistoricalSurveyType,
} from "@/lib/surveys/finalized-historical-import";

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  await requireCapability("manage_data");
  const { id } = await context.params;
  if (!HISTORICAL_SURVEY_TYPES.includes(id as HistoricalSurveyType)) {
    return NextResponse.json({ error: "Historical survey template not found." }, { status: 404 });
  }
  const type = id as HistoricalSurveyType;
  const filename = type === "SME_DEBRIEF"
    ? "sme-debrief-historical-template.csv"
    : "id-review-of-sme-historical-template.csv";
  return new NextResponse(finalizedHistoricalTemplate(type), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
}
