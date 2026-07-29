import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";

const idSchema = z.string().uuid();

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile, supabase } = await requireCapability("manage_data");
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: "Import batch not found." }, { status: 404 });
  const [batch, attempts, mappings, rows, issues, integrations, audit, historicalResponses] = await Promise.all([
    supabase.from("survey_historical_import_batches").select("*").eq("id", id).eq("organization_id", profile.organization_id).maybeSingle(),
    supabase.from("survey_historical_import_upload_attempts").select("*").eq("batch_id", id).order("uploaded_at"),
    supabase.from("survey_historical_import_column_mappings").select("*").eq("batch_id", id).order("column_ordinal"),
    supabase.from("survey_historical_import_rows").select("*").eq("batch_id", id).order("row_number"),
    supabase.from("survey_historical_import_issues").select("*").eq("batch_id", id).order("created_at"),
    supabase.from("survey_historical_import_integrations").select("*").eq("batch_id", id).order("integrated_at"),
    supabase.from("survey_historical_import_resolution_audit").select("*").eq("batch_id", id).order("created_at"),
    supabase.from("historical_survey_responses").select("*").eq("import_batch_id", id).order("submitted_at"),
  ]);
  if (batch.error || !batch.data) return NextResponse.json({ error: "Import batch not found." }, { status: 404 });
  const error = [attempts, mappings, rows, issues, integrations, audit, historicalResponses].find((result) => result.error)?.error;
  if (error) return NextResponse.json({ error: "Import batch details could not be loaded." }, { status: 500 });
  return NextResponse.json({
    batch: batch.data,
    uploadAttempts: attempts.data ?? [],
    mappings: mappings.data ?? [],
    rows: rows.data ?? [],
    issues: issues.data ?? [],
    integrations: integrations.data ?? [],
    audit: audit.data ?? [],
    historicalResponses: historicalResponses.data ?? [],
  });
}
