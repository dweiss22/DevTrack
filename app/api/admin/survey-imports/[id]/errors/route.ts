import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { escapeCsvFormula } from "@/lib/surveys/finalized-historical-import";

const columns = [
  "rowNumber", "surveyType", "sourceResponseId", "courseName", "status",
  "errorCode", "errorMessage", "originalValue", "normalizedValue",
] as const;

function csvCell(value: unknown) {
  const serialized = typeof value === "object" && value != null ? JSON.stringify(value) : String(value ?? "");
  const safe = escapeCsvFormula(serialized);
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll("\"", "\"\"")}"` : safe;
}

function valueAt(source: Record<string, unknown> | undefined, path: string | null) {
  if (!source || !path) return "";
  if (path in source) return source[path] ?? "";
  return path.split(".").reduce<unknown>((value, segment) =>
    value && typeof value === "object" ? (value as Record<string, unknown>)[segment] : undefined, source) ?? "";
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile, supabase } = await requireCapability("manage_data");
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Import batch not found." }, { status: 404 });
  }
  const { data: batch } = await supabase.from("survey_historical_import_batches")
    .select("id,source_filename").eq("id", id).eq("organization_id", profile.organization_id).maybeSingle();
  if (!batch) return NextResponse.json({ error: "Import batch not found." }, { status: 404 });
  const [{ data: rows, error: rowError }, { data: issues, error: issueError }] = await Promise.all([
    supabase.from("survey_historical_import_rows")
      .select("id,row_number,external_survey_type,source_response_id,raw_row,normalized_answers,row_status,finalized_status")
      .eq("batch_id", id).order("row_number"),
    supabase.from("survey_historical_import_issues")
      .select("row_id,issue_code,message,source_field,raw_value,resolution_status")
      .eq("batch_id", id).order("created_at"),
  ]);
  if (rowError || issueError) return NextResponse.json({ error: "The error report could not be generated." }, { status: 500 });
  const rowById = new Map((rows ?? []).map((row) => [row.id, row]));
  const reportRows = (issues ?? []).filter((issue) => issue.resolution_status === "open").map((issue) => {
    const row = issue.row_id ? rowById.get(issue.row_id) : null;
    const normalized = row?.normalized_answers as Record<string, unknown> | undefined;
    const raw = row?.raw_row as Record<string, unknown> | undefined;
    return {
      rowNumber: row?.row_number ?? "",
      surveyType: row?.external_survey_type ?? "",
      sourceResponseId: row?.source_response_id ?? "",
      courseName: normalized?.courseName ?? raw?.courseName ?? "",
      status: row?.finalized_status ?? row?.row_status ?? "file_error",
      errorCode: issue.issue_code,
      errorMessage: issue.message,
      originalValue: issue.raw_value ?? valueAt(raw, issue.source_field),
      normalizedValue: valueAt(normalized, issue.source_field),
    };
  });
  const csv = [
    columns.join(","),
    ...reportRows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ].join("\r\n");
  const safeBase = batch.source_filename.replace(/\.csv$/i, "").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 100);
  return new NextResponse(`${csv}\r\n`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${safeBase}-import-errors.csv"`,
      "cache-control": "private, no-store",
    },
  });
}
