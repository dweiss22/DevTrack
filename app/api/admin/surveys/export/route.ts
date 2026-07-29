import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { escapeCsvFormula } from "@/lib/surveys/finalized-historical-import";

type BrowseRow = {
  id: string; survey_type: string; status: string; is_locked: boolean; revision_number: number;
  updated_at: string; task_id: string; project_title: string; sme_name: string;
  creator_id: string; creator_name: string; vertical: string | null;
  reporting_year: number | null; publication_year: number | null;
};

const csvCell = (value: unknown) => {
  const text = escapeCsvFormula(value == null ? "" : String(value));
  return /[",\r\n]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
};

export async function GET(request: NextRequest) {
  const { supabase } = await requireCapability("manage_surveys");
  const requested = request.nextUrl.searchParams;
  const filters = Object.fromEntries(
    ["surveyType", "status", "lockState", "project", "sme", "creator", "vertical", "reportingYear", "publicationYear"]
      .map((key) => [key, requested.get(key)]).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
  const rows: BrowseRow[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await supabase.rpc("survey_browse", { filters, page_number: page, page_size: 100 });
    if (error) return NextResponse.json({ error: "Survey export could not be prepared." }, { status: 500 });
    const batch = (data ?? []) as BrowseRow[];
    rows.push(...batch);
    if (batch.length < 100) break;
  }
  const details = new Map<string, {
    original_submitted_at: string | null; latest_submitted_at: string | null;
    billable_hours: number | null; amount_billed: number | null; historical: boolean;
  }>();
  for (let offset = 0; offset < rows.length; offset += 100) {
    const ids = rows.slice(offset, offset + 100).map((row) => row.id);
    const [submissions, debriefs, integrations] = await Promise.all([
      supabase.from("survey_submissions").select("id,original_submitted_at,latest_submitted_at").in("id", ids),
      supabase.from("course_development_debrief_responses").select("submission_id,billable_hours,amount_billed").in("submission_id", ids),
      supabase.from("survey_historical_import_integrations").select("submission_id").in("submission_id", ids).is("rolled_back_at", null),
    ]);
    const debriefById = new Map((debriefs.data ?? []).map((row) => [row.submission_id, row]));
    const imported = new Set((integrations.data ?? []).map((row) => row.submission_id));
    for (const submission of submissions.data ?? []) {
      const debrief = debriefById.get(submission.id);
      details.set(submission.id, {
        original_submitted_at: submission.original_submitted_at,
        latest_submitted_at: submission.latest_submitted_at,
        billable_hours: debrief?.billable_hours ?? null,
        amount_billed: debrief?.amount_billed ?? null,
        historical: imported.has(submission.id),
      });
    }
  }
  if (!filters.status || filters.status === "submitted") {
    let historicalQuery = supabase.from("historical_survey_responses").select(
      "id,internal_survey_type,matched_task_id,historical_course_name,respondent_name,reviewed_sme_name,submitted_at,updated_at"
    );
    if (filters.surveyType) historicalQuery = historicalQuery.eq("internal_survey_type", filters.surveyType);
    if (filters.project) historicalQuery = historicalQuery.eq("matched_task_id", filters.project);
    const { data: historical, error: historicalError } = await historicalQuery.limit(10_000);
    if (historicalError) return NextResponse.json({ error: "Historical survey export could not be prepared." }, { status: 500 });
    const historicalIds = (historical ?? []).map((row) => row.id);
    const [debriefs, reviews] = historicalIds.length ? await Promise.all([
      supabase.from("historical_sme_debrief_responses")
        .select("response_id,billable_hours,amount_billed").in("response_id", historicalIds),
      supabase.from("historical_id_sme_review_responses")
        .select("response_id,vertical,publication_year").in("response_id", historicalIds),
    ]) : [{ data: [] }, { data: [] }];
    const debriefById = new Map((debriefs.data ?? []).map((row) => [row.response_id, row]));
    const reviewById = new Map((reviews.data ?? []).map((row) => [row.response_id, row]));
    for (const historicalRow of historical ?? []) {
      const review = reviewById.get(historicalRow.id);
      if (filters.vertical && review?.vertical !== filters.vertical) continue;
      if (filters.publicationYear && String(review?.publication_year ?? "") !== filters.publicationYear) continue;
      rows.push({
        id: historicalRow.id,
        survey_type: historicalRow.internal_survey_type,
        status: "submitted",
        is_locked: true,
        revision_number: 1,
        updated_at: historicalRow.updated_at,
        task_id: historicalRow.matched_task_id ?? "",
        project_title: historicalRow.historical_course_name,
        sme_name: historicalRow.reviewed_sme_name,
        creator_id: "",
        creator_name: historicalRow.respondent_name || "Historical respondent",
        vertical: review?.vertical ?? null,
        reporting_year: null,
        publication_year: review?.publication_year ?? null,
      });
      const debrief = debriefById.get(historicalRow.id);
      details.set(historicalRow.id, {
        original_submitted_at: historicalRow.submitted_at,
        latest_submitted_at: historicalRow.submitted_at,
        billable_hours: debrief?.billable_hours ?? null,
        amount_billed: debrief?.amount_billed ?? null,
        historical: true,
      });
    }
  }
  const headers = [
    "Survey Type", "Course", "Project ID", "SME", "Creator", "Status", "Locked",
    "Revision", "Vertical", "Reporting Year", "Publication Year", "Billable Hours",
    "Amount Billed", "Original Submitted At", "Latest Submitted At", "Historical Import",
  ];
  const body = [
    headers,
    ...rows.map((row) => {
      const detail = details.get(row.id);
      return [
        row.survey_type, row.project_title, row.task_id, row.sme_name, row.creator_name,
        row.status, row.is_locked, row.revision_number, row.vertical, row.reporting_year,
        row.publication_year, detail?.billable_hours, detail?.amount_billed,
        detail?.original_submitted_at, detail?.latest_submitted_at, detail?.historical ? "Yes" : "No",
      ];
    }),
  ].map((line) => line.map(csvCell).join(",")).join("\r\n");
  return new NextResponse(`\uFEFF${body}\r\n`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="devtrack-surveys-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "private, no-store",
    },
  });
}
