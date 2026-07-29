import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import {
  blankCanonicalCsv,
  canonicalCsvContract,
  canonicalDataDictionaryCsv,
  exampleCanonicalCsv,
} from "@/lib/surveys/csv-contract";
import { surveyDefinitionSchema } from "@/lib/surveys/definition";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { profile } = await requireCapability("manage_data");
  const { id } = await context.params;
  const kind = request.nextUrl.searchParams.get("kind") ?? "blank";
  if (!["blank", "example", "dictionary"].includes(kind)) {
    return NextResponse.json({ error: "Unknown template download type." }, { status: 400 });
  }
  const { data, error } = await createAdminClient().from("survey_template_versions")
    .select("id,survey_type,version_number,definition,published_at,version_origin")
    .eq("id", id)
    .eq("organization_id", profile.organization_id)
    .eq("version_origin", "published")
    .maybeSingle();
  if (error || !data) return NextResponse.json({ error: "Published survey version not found." }, { status: 404 });
  const definition = surveyDefinitionSchema.safeParse(data.definition);
  if (!definition.success) return NextResponse.json({ error: "Published survey definition is invalid." }, { status: 409 });
  const contract = canonicalCsvContract(definition.data, data.version_number, data.published_at);
  const csv = kind === "example"
    ? exampleCanonicalCsv(contract)
    : kind === "dictionary"
      ? canonicalDataDictionaryCsv(contract)
      : blankCanonicalCsv(contract);
  const filename = `${data.survey_type}-v${data.version_number}-${kind}.csv`;
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
}
