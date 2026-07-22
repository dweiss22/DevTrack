import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { DevelopmentAnalyticsView } from "@/components/development-analytics";
import { DevelopmentFiltersForm } from "@/components/development-filters";
import { DevelopmentProjectTable } from "@/components/development-project-table";
import { requireContext } from "@/lib/auth";
import { loadProjectLengthPercentilesResult } from "@/lib/reporting/data";
import { loadDevelopmentAnalytics, loadDevelopmentOptions, loadDevelopmentProjects, loadDevelopmentYearOptions, parseDevelopmentFilters, type DevelopmentOptions } from "@/lib/reporting/development";

type SearchValues = Record<string, string | string[] | undefined>;
export default async function DevelopmentPage({ searchParams }: { searchParams: Promise<SearchValues> }) {
  const query = await searchParams;
  const { supabase, profile } = await requireContext();
  const [yearsResult, optionsResult, lastRunResult] = await Promise.all([
    loadDevelopmentYearOptions(supabase), loadDevelopmentOptions(supabase, profile.organization_id),
    supabase.from("wrike_folder_task_import_runs").select("created_at").eq("organization_id", profile.organization_id).eq("status", "succeeded").order("created_at", { ascending: false }).limit(1).maybeSingle()
  ]);
  if (yearsResult.error) return <AppShell isAdmin={profile.role === "admin"} lastSynced={lastRunResult.data?.created_at}><DevelopmentHeader /><QueryError title={yearsResult.error.title} message={yearsResult.error.message} code={yearsResult.error.code} /></AppShell>;
  const years = yearsResult.data;
  const normalizedQuery = !query.reportingSelection && years.defaultYear == null && years.missingProjects > 0 ? { ...query, reportingSelection: "missing" } : query;
  const filters = parseDevelopmentFilters(normalizedQuery, years.defaultYear);
  const options = optionsResult.data ?? EMPTY_OPTIONS;
  const analyticsPromise = loadDevelopmentAnalytics(supabase, filters);
  const projectsPromise = loadDevelopmentProjectSection(supabase, filters);
  return <AppShell isAdmin={profile.role === "admin"} lastSynced={lastRunResult.data?.created_at}>
    <DevelopmentHeader />
    {optionsResult.error && <p className="notice error" role="status">Analytics remain available, but some filter and reference options could not be loaded. Unresolved values will remain identified.</p>}
    <DevelopmentFiltersForm filters={filters} years={years} options={options} />
    <Suspense fallback={<DevelopmentSectionSkeleton label="Loading completion and status analytics" cards={3} />}><AnalyticsSection promise={analyticsPromise} filters={filters} /></Suspense>
    <Suspense fallback={<DevelopmentSectionSkeleton label="Loading reporting-year projects" cards={1} />}><ProjectsSection promise={projectsPromise} filters={filters} options={options} /></Suspense>
  </AppShell>;
}

function DevelopmentHeader() { return <header className="page-header dashboard-header"><div><p className="eyebrow">DEVELOPMENT</p><h1>Course-development dashboard</h1><p>Completion, current workflow status, recorded effort, and project details by normalized Reporting year.</p></div></header>; }
async function AnalyticsSection({ promise, filters }: { promise: ReturnType<typeof loadDevelopmentAnalytics>; filters: ReturnType<typeof parseDevelopmentFilters> }) { const result=await promise; return result.error ? <QueryError title={result.error.title} message={result.error.message} code={result.error.code} /> : <DevelopmentAnalyticsView analytics={result.data} filters={filters} />; }
async function ProjectsSection({ promise, filters, options }: { promise: ReturnType<typeof loadDevelopmentProjectSection>; filters: ReturnType<typeof parseDevelopmentFilters>; options: DevelopmentOptions }) { const result=await promise; if (result.projects.error) return <QueryError title={result.projects.error.title} message={result.projects.error.message} code={result.projects.error.code} />; const people=options.users.map((person)=>({wrikeId:person.wrikeId,name:person.name,resolved:person.resolved,displayable:person.name!==person.wrikeId,verified:person.resolved,verificationSource:person.resolved?"wrike_contact" as const:"unresolved" as const})); return <section className="card development-project-list">{result.percentileError&&<p className="notice warning" role="status">Project rows remain available, but Development percentiles could not be loaded.</p>}<DevelopmentProjectTable rows={result.projects.data.rows} total={result.projects.data.total} filters={filters} people={people} percentileByTask={result.percentileByTask} /></section>; }
async function loadDevelopmentProjectSection(supabase: Parameters<typeof loadDevelopmentProjects>[0], filters: ReturnType<typeof parseDevelopmentFilters>) { const projects=await loadDevelopmentProjects(supabase,filters); if(projects.error)return {projects,percentileByTask:{},percentileError:false}; const percentile=await loadProjectLengthPercentilesResult(supabase,projects.data.rows.map((row)=>row.taskId)); return {projects,percentileByTask:Object.fromEntries(percentile.data),percentileError:Boolean(percentile.error)}; }
function QueryError({ title, message, code }: { title: string; message: string; code: string | null }) { return <section className="card dashboard-query-error" role="alert"><p className="eyebrow">REPORTING QUERY</p><h2>{title}</h2><p>{message}</p>{code&&<p><strong>Diagnostic code:</strong> <code>{code}</code></p>}</section>; }
function DevelopmentSectionSkeleton({ label, cards }: { label: string; cards: number }) { return <section className="development-loading" aria-label={label} aria-busy="true">{Array.from({length:cards},(_,index)=><article className="card loading-chart loading-pulse" key={index}><span className="sr-only">{label}</span></article>)}</section>; }
const EMPTY_OPTIONS: DevelopmentOptions = { statuses: [],users: [],folders: [],projects: [],customFields: [] };
