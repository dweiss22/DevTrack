import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requirePageCapability } from "@/lib/auth";
import { hasCapability, isAdministratorRole } from "@/lib/auth/roles";
import { surveyTitle, type SurveyType } from "@/lib/surveys/domain";

type SurveyBrowseRow = {
  total_count: number; id: string; survey_type: SurveyType; status: "draft" | "submitted";
  is_locked: boolean; revision_number: number; updated_at: string; task_id: string;
  project_title: string; sme_name: string; creator_id: string; creator_name: string;
  vertical: string | null; reporting_year: number | null; publication_year: number | null;
};

export default async function SurveysPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { profile, supabase } = await requirePageCapability("view_surveys");
  const query = await searchParams;
  const value = (key: string) => Array.isArray(query[key]) ? query[key]?.[0] : query[key];
  const page = Math.max(1, Number(value("page")) || 1);
  const candidateFilters = Object.fromEntries(["surveyType", "status", "lockState", "project", "sme", "creator", "vertical", "reportingYear", "publicationYear"]
    .map((key) => [key, value(key)]).filter((entry): entry is [string, string] => Boolean(entry[1])));
  const filters: Record<string, string> = { ...candidateFilters };
  if (!["course_development_debrief", "id_sme_review"].includes(filters.surveyType)) delete filters.surveyType;
  if (!["draft", "submitted"].includes(filters.status)) delete filters.status;
  if (!["true", "false"].includes(filters.lockState)) delete filters.lockState;
  if (!/^\d{4}$/.test(filters.reportingYear ?? "")) delete filters.reportingYear;
  if (!/^\d{4}$/.test(filters.publicationYear ?? "")) delete filters.publicationYear;
  const { data, error } = await supabase.rpc("survey_browse", { filters, page_number: page, page_size: 50 });
  if (error) throw new Error("Survey responses could not be loaded.");
  const rows = (data ?? []) as SurveyBrowseRow[];
  const total = Number(rows[0]?.total_count ?? 0);
  const pages = Math.max(1, Math.ceil(total / 50));
  const canManage = hasCapability(profile.role, "manage_surveys");
  const pageHref = (target: number) => {
    const next = new URLSearchParams(filters); next.set("page", String(target)); return `/surveys?${next}`;
  };
  return <AppShell isAdmin={isAdministratorRole(profile.role)}>
    <header className="page-header"><div><p className="eyebrow">COURSE DEVELOPMENT</p><h1>Surveys</h1>
      <p>{canManage ? "Browse and administer both course-development survey types." : "Draft and submitted surveys within your authorized scope."}</p></div></header>
    <form className="card survey-filter-form" method="get" aria-label="Survey filters">
      <label>Survey type<select name="surveyType" defaultValue={filters.surveyType ?? ""}><option value="">All available types</option>
        <option value="course_development_debrief">Course Development Debrief</option><option value="id_sme_review">Review of Subject Matter Expert</option></select></label>
      <label>Status<select name="status" defaultValue={filters.status ?? ""}><option value="">All statuses</option><option value="draft">Draft</option><option value="submitted">Submitted</option></select></label>
      <label>Lock state<select name="lockState" defaultValue={filters.lockState ?? ""}><option value="">Any lock state</option><option value="true">Locked</option><option value="false">Editable / unlocked</option></select></label>
      <label>Project ID<input name="project" defaultValue={filters.project ?? ""} placeholder="Project UUID" /></label>
      <label>SME identity ID<input name="sme" defaultValue={filters.sme ?? ""} placeholder="Wrike identity UUID" /></label>
      <label>Creator ID<input name="creator" defaultValue={filters.creator ?? ""} placeholder="Application user UUID" /></label>
      <label>Vertical<input name="vertical" defaultValue={filters.vertical ?? ""} placeholder="Vertical" /></label>
      <label>Reporting year<input name="reportingYear" type="number" min="1000" max="9999" defaultValue={filters.reportingYear ?? ""} /></label>
      <label>Publication year<input name="publicationYear" type="number" min="1000" max="9999" defaultValue={filters.publicationYear ?? ""} /></label>
      <div className="filter-actions"><button>Apply filters</button><Link className="button secondary" href="/surveys">Clear</Link></div>
    </form>
    {rows.length ? <div className="dashboard-table-wrap"><table className="survey-list dashboard-project-table"><thead><tr>
      <th>Survey</th><th>Course / SME</th><th>Creator</th><th>Context</th><th>Status</th><th>Updated</th>
    </tr></thead><tbody>{rows.map((row) => <tr key={row.id}>
      <td data-label="Survey"><Link href={`/surveys/${row.id}?returnTo=${encodeURIComponent(`/surveys?${new URLSearchParams(filters)}`)}`}>{surveyTitle(row.survey_type)}</Link></td>
      <td data-label="Course / SME"><strong>{row.project_title}</strong><br />{row.sme_name}</td>
      <td data-label="Creator">{row.creator_name}</td>
      <td data-label="Context">{row.vertical ?? "—"}<br />{row.publication_year ? `Publication ${row.publication_year}` : row.reporting_year ? `Reporting ${row.reporting_year}` : "Year unavailable"}</td>
      <td data-label="Status"><span className={`survey-status ${row.status}`}>{row.status}</span>{" "}
        <span className={`survey-status ${row.is_locked ? "locked" : "unlocked"}`}>{row.is_locked ? "Locked" : "Editable"}</span><br />Revision {row.revision_number}</td>
      <td data-label="Updated">{new Date(row.updated_at).toLocaleString()}</td>
    </tr>)}</tbody></table></div> : <p className="card empty">No surveys match the available scope and filters.</p>}
    {pages > 1 && <nav className="pagination" aria-label="Survey pages">
      {page > 1 && <Link className="button secondary" href={pageHref(page - 1)}>Previous</Link>}
      <span>Page {page} of {pages} · {total.toLocaleString()} surveys</span>
      {page < pages && <Link className="button secondary" href={pageHref(page + 1)}>Next</Link>}
    </nav>}
  </AppShell>;
}
