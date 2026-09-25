import { NextRequest, NextResponse } from "next/server";
import { requirePageCapability } from "@/lib/auth";
import { parseReportingFilters } from "@/lib/reporting/filters";
import { loadHoursTimeseries } from "@/lib/reporting/insights";

export async function GET(request: NextRequest) {
  const { supabase } = await requirePageCapability("view_core_pages");
  const query: Record<string, string | string[]> = {};
  for (const key of request.nextUrl.searchParams.keys()) {
    if (key in query) continue;
    const values = request.nextUrl.searchParams.getAll(key);
    query[key] = values.length > 1 ? values : values[0];
  }
  const filters = parseReportingFilters(query);
  try {
    const data = await loadHoursTimeseries(supabase, filters);
    return NextResponse.json(data);
  } catch (error) {
    console.error("development_insights_query_failed", { message: error instanceof Error ? error.message : "Supabase request failed" });
    return NextResponse.json({ error: "Unable to load hours time series." }, { status: 502 });
  }
}
