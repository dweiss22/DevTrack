import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { AdminSurveyTemplates, type AdminSurveyTemplateRow } from "@/components/admin-survey-templates";
import { requirePageCapability } from "@/lib/auth";
import { surveyTitle, type SurveyType } from "@/lib/surveys/domain";

type BrowseRow = {
  total_count: number; id: string; survey_type: SurveyType; status: "draft" | "submitted";
  is_locked: boolean; revision_number: number; updated_at: string; task_id: string;
  project_title: string; sme_name: string; creator_id: string; creator_name: string;
  vertical: string | null; reporting_year: number | null; publication_year: number | null;
  is_historical_import?: boolean;
};

export default async function AdminSurveysPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase } = await requirePageCapability("manage_surveys");
  const query = await searchParams;
  const value = (key: string) => Array.isArray(query[key]) ? query[key]?.[0] : query[key];
  const view = value("view") === "submissions" ? "submissions" : "templates";
  const page = Math.max(1, Number(value("page")) || 1);
  const filters = Object.fromEntries(
    ["surveyType", "status", "lockState", "project", "sme", "creator", "vertical", "reportingYear", "publicationYear"]
      .map((key) => [key, value(key)]).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
  if (!["course_development_debrief", "id_sme_review"].includes(filters.surveyType)) delete filters.surveyType;
  if (!["draft", "submitted"].includes(filters.status)) delete filters.status;
  if (!["true", "false"].includes(filters.lockState)) delete filters.lockState;
  const templateResult = view === "templates" ? await supabase.rpc("survey_admin_templates") : { data: [], error: null };
  const browseResult = view === "submissions"
    ? await supabase.rpc("survey_browse", { filters, page_number: page, page_size: 50 })
    : { data: [], error: null };
  const rows = (browseResult.data ?? []) as BrowseRow[];
  const submissionIds = rows.map((row) => row.id);
  const importedResult = submissionIds.length
    ? await supabase.from("survey_historical_import_integrations").select("submission_id")
      .in("submission_id", submissionIds).is("rolled_back_at", null)
    : { data: [], error: null };
  const importedSubmissionIds = new Set((importedResult.data ?? []).map((row) => row.submission_id));
  for (const row of rows) row.is_historical_import = importedSubmissionIds.has(row.id);
  const total = Number(rows[0]?.total_count ?? 0);
  const pages = Math.max(1, Math.ceil(total / 50));
  const pageHref = (target: number) => {
    const next = new URLSearchParams({ ...filters, view: "submissions", page: String(target) });
    return `/admin/surveys?${next}`;
  };
  const exportHref = `/api/admin/surveys/export?${new URLSearchParams(filters)}`;

  return <AppShell isAdmin>
    <header className="page-header"><div><p className="eyebrow">ADMINISTRATIVE FUNCTIONS</p>
      <h1>Surveys</h1><p>Design versioned surveys and administer submitted responses.</p></div></header>
    <nav className="survey-tabs" aria-label="Survey administration views">
      <Link href="/admin/surveys" aria-current={view === "templates" ? "page" : undefined}>
        Templates
      </Link>
      <Link href="/admin/surveys?view=submissions" aria-current={view === "submissions" ? "page" : undefined}>
        Submissions
      </Link>
    </nav>
    {view === "templates" ? templateResult.error
      ? <p className="card notice error" role="alert">Survey templates could not be loaded. Apply the latest database migration.</p>
      : <AdminSurveyTemplates templates={(templateResult.data ?? []) as AdminSurveyTemplateRow[]} />
      : <>
        <form className="card survey-filter-form" method="get" aria-label="Survey filters">
          <input type="hidden" name="view" value="submissions" />
          <label>Survey type<select name="surveyType" defaultValue={filters.surveyType ?? ""}><option value="">All types</option>
            <option value="course_development_debrief">Course Development Debrief</option><option value="id_sme_review">Review of Subject Matter Expert</option></select></label>
          <label>Status<select name="status" defaultValue={filters.status ?? ""}><option value="">All statuses</option><option value="draft">Draft</option><option value="submitted">Submitted</option></select></label>
          <label>Lock state<select name="lockState" defaultValue={filters.lockState ?? ""}><option value="">Any state</option><option value="true">Locked</option><option value="false">Editable / unlocked</option></select></label>
          <label>Course ID<input name="project" defaultValue={filters.project ?? ""} /></label>
          <label>SME identity ID<input name="sme" defaultValue={filters.sme ?? ""} /></label>
          <label>Creator ID<input name="creator" defaultValue={filters.creator ?? ""} /></label>
          <label>Vertical<input name="vertical" defaultValue={filters.vertical ?? ""} /></label>
          <label>Reporting year<input name="reportingYear" type="number" min="1000" max="9999" defaultValue={filters.reportingYear ?? ""} /></label>
          <div className="filter-actions"><button>Apply filters</button><Link className="button secondary" href="/admin/surveys?view=submissions">Clear</Link><a className="button secondary" href={exportHref}>Export CSV</a></div>
        </form>
        {browseResult.error ? <p className="card notice error" role="alert">Survey submissions could not be loaded.</p>
          : rows.length ? <div className="dashboard-table-wrap"><table className="survey-list dashboard-project-table"><thead><tr>
            <th>Survey</th><th>Course / SME</th><th>Creator</th><th>Context</th><th>Status</th><th>Updated</th>
          </tr></thead><tbody>{rows.map((row) => <tr key={row.id}>
            <td data-label="Survey"><Link href={`/admin/surveys/submissions/${row.id}`}>{surveyTitle(row.survey_type)}</Link>{row.is_historical_import ? <><br /><span className="survey-status historical">Historical import</span></> : null}</td>
            <td data-label="Course / SME"><strong>{row.project_title}</strong><br />{row.sme_name}</td>
            <td data-label="Creator">{row.creator_name}</td>
            <td data-label="Context">{row.vertical ?? "—"}<br />{row.publication_year ? `Publication ${row.publication_year}` : row.reporting_year ? `Reporting ${row.reporting_year}` : "Year unavailable"}</td>
            <td data-label="Status"><span className={`survey-status ${row.status}`}>{row.status}</span>{" "}
              <span className={`survey-status ${row.is_locked ? "locked" : "unlocked"}`}>{row.is_locked ? "Locked" : "Editable"}</span><br />Revision {row.revision_number}</td>
            <td data-label="Updated">{new Date(row.updated_at).toLocaleString()}</td>
          </tr>)}</tbody></table></div> : <p className="card empty">No submissions match these filters.</p>}
        {pages > 1 && <nav className="pagination" aria-label="Submission pages">
          {page > 1 && <Link className="button secondary" href={pageHref(page - 1)}>Previous</Link>}
          <span>Page {page} of {pages} · {total.toLocaleString()} submissions</span>
          {page < pages && <Link className="button secondary" href={pageHref(page + 1)}>Next</Link>}
        </nav>}
      </>}
  </AppShell>;
}
