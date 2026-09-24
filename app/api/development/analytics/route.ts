import { NextRequest, NextResponse } from "next/server";
import { requirePageCapability } from "@/lib/auth";
import { loadDevelopmentAnalytics, parseDevelopmentFilters } from "@/lib/reporting/development";

export async function GET(request: NextRequest) {
  const { supabase } = await requirePageCapability("view_core_pages");
  const query: Record<string, string[]> = {};
  for (const key of request.nextUrl.searchParams.keys()) {
    if (key in query) continue;
    query[key] = request.nextUrl.searchParams.getAll(key);
  }
  const filters = parseDevelopmentFilters(query);
  const result = await loadDevelopmentAnalytics(supabase, filters);
  if (result.error) {
    console.error("development_analytics_query_failed", { message: result.error.message });
    return NextResponse.json({ error: result.error.message }, { status: 502 });
  }
  return NextResponse.json(result.data);
}
