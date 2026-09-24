import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { DevelopmentAnalyticsView } from "@/components/development-analytics";
import { DevelopmentFiltersForm } from "@/components/development-filters";
import { DevelopmentProjectTable } from "@/components/development-project-table";
import { InsightsFilters } from "@/components/insights-filters";
import { InsightsCumulativeChart } from "@/components/insights-cumulative-chart";
import { InsightsComparisonChart } from "@/components/insights-comparison-chart";
import { ProjectsLoadFailure } from "@/components/projects-load-failure";
import { requirePageCapability } from "@/lib/auth";
import { isAdministratorRole } from "@/lib/auth/roles";
import { reportingFailure, type ReportingFailure } from "@/lib/reporting/failure";
import { loadProjectLengthPercentilesResult } from "@/lib/reporting/data";
import {
  DEVELOPMENT_PROJECT_FILTER_PREFIX,
  developmentForeignParams,
  loadDevelopmentAnalytics,
  loadDevelopmentOptions,
  loadDevelopmentProjects,
  loadDevelopmentYearOptions,
  parseDevelopmentFilters,
  parseDevelopmentProjectFilters,
  withDefaultDevelopmentSelection,
  type DevelopmentOptions
} from "@/lib/reporting/development";
import { foreignFilterParams, loadHoursTimeseries, parsePrefixedReportingFilters, swapPrefixedFiltersHref, type HoursTimeseries } from "@/lib/reporting/insights";
import { loadAccessibleProjectFacets } from "@/lib/reporting/options";
import type { ProjectPersonOption } from "@/lib/reporting/projects";

type SearchValues = Record<string, string | string[] | undefined>;
const PATHNAME = "/development";

export default async function DevelopmentPage({ searchParams }: { searchParams: Promise<SearchValues> }) {
  const query = await searchParams;
  const { supabase, profile } = await requirePageCapability("view_core_pages");
  const isAdministrator = isAdministratorRole(profile.role);
  const [yearsResult, optionsResult, facets, lastRunResult] = await Promise.all([
    loadDevelopmentYearOptions(supabase), loadDevelopmentOptions(supabase, profile.organization_id),
    loadAccessibleProjectFacets(supabase),
    supabase.from("wrike_folder_task_import_runs").select("created_at").eq("organization_id", profile.organization_id).eq("status", "succeeded").order("created_at", { ascending: false }).limit(1).maybeSingle()
  ]);
  if (yearsResult.error) return <AppShell isAdmin={isAdministrator} lastSynced={lastRunResult.data?.created_at}><DevelopmentHeader /><QueryError title={yearsResult.error.title} message={yearsResult.error.message} code={yearsResult.error.code} /></AppShell>;
  const years = yearsResult.data;
  const normalizedQuery = withDefaultDevelopmentSelection(withDefaultDevelopmentSelection(query, "", years), DEVELOPMENT_PROJECT_FILTER_PREFIX, years);
  const filters = parseDevelopmentFilters(normalizedQuery, years.defaultYear);
  const projectFilters = parseDevelopmentProjectFilters(normalizedQuery, years.defaultYear);
  const analyticsForeign = developmentForeignParams(normalizedQuery, "");
  const projectForeign = developmentForeignParams(normalizedQuery, DEVELOPMENT_PROJECT_FILTER_PREFIX);
  const options = optionsResult.data ?? EMPTY_OPTIONS;
  const people: ProjectPersonOption[] = options.users.map((person) => ({ wrikeId: person.wrikeId, name: person.name, resolved: person.resolved, displayable: person.name !== person.wrikeId, verified: person.resolved, verificationSource: person.resolved ? "wrike_contact" as const : "unresolved" as const }));
  const analyticsPromise = loadDevelopmentAnalytics(supabase, filters);
  const projectsPromise = loadDevelopmentProjectSection(supabase, projectFilters);

  const primaryFilters = parsePrefixedReportingFilters(query, "");
  const metricAFilters = parsePrefixedReportingFilters(query, "a_");
  const metricBFilters = parsePrefixedReportingFilters(query, "b_");
  const primaryForeign = foreignFilterParams(query, "");
  const metricAForeign = foreignFilterParams(query, "a_");
  const metricBForeign = foreignFilterParams(query, "b_");
  const swapHref = swapPrefixedFiltersHref(PATHNAME, query, "a_", "b_");
  const cumulativePromise = loadHoursTimeseries(supabase, primaryFilters);
  const comparisonPromise = Promise.all([loadHoursTimeseries(supabase, metricAFilters), loadHoursTimeseries(supabase, metricBFilters)]);

  return <AppShell isAdmin={isAdministrator} lastSynced={lastRunResult.data?.created_at}>
    <DevelopmentHeader />
    {optionsResult.error && <p className="notice error" role="status">Analytics remain available, but some filter and reference options could not be loaded. Unresolved values will remain identified.</p>}
    <DevelopmentFiltersForm filters={filters} years={years} options={options} foreignParams={analyticsForeign} />
    <Suspense fallback={<DevelopmentSectionSkeleton label="Loading completion and status analytics" cards={3} />}><AnalyticsSection promise={analyticsPromise} projectFilters={projectFilters} projectForeign={projectForeign} /></Suspense>

    <DevelopmentFiltersForm filters={projectFilters} years={years} options={options} prefix={DEVELOPMENT_PROJECT_FILTER_PREFIX} foreignParams={projectForeign} label="Reporting-year project list Reporting Year filter" />
    <Suspense fallback={<DevelopmentSectionSkeleton label="Loading reporting-year projects" cards={1} />}><ProjectsSection promise={projectsPromise} filters={projectFilters} foreignParams={projectForeign} people={people} /></Suspense>

    <section className="insights-section" aria-labelledby="cumulative-section-title">
      <div className="development-section-heading"><div><p className="eyebrow">DEVELOPMENT ANALYTICS</p><h2 id="cumulative-section-title">Cumulative hours</h2></div></div>
      <InsightsFilters title="Filters" prefix="" pathname={PATHNAME} foreignParams={primaryForeign} filters={primaryFilters} statuses={options.statuses} customFields={options.customFields} people={people} facets={facets} />
      <Suspense fallback={<DevelopmentSectionSkeleton label="Loading cumulative hours" cards={1} />}><CumulativeSection promise={cumulativePromise} /></Suspense>
    </section>

    <section className="insights-section" aria-labelledby="comparison-section-title">
      <div className="development-section-heading"><div><p className="eyebrow">DEVELOPMENT ANALYTICS</p><h2 id="comparison-section-title">Compare two metrics</h2></div></div>
      <div className="insights-compare-grid">
        <InsightsFilters title="Metric A" prefix="a_" pathname={PATHNAME} foreignParams={metricAForeign} filters={metricAFilters} statuses={options.statuses} customFields={options.customFields} people={people} facets={facets} />
        <InsightsFilters title="Metric B" prefix="b_" pathname={PATHNAME} foreignParams={metricBForeign} filters={metricBFilters} statuses={options.statuses} customFields={options.customFields} people={people} facets={facets} />
      </div>
      <Suspense fallback={<DevelopmentSectionSkeleton label="Loading comparison" cards={1} />}><ComparisonSection promise={comparisonPromise} swapHref={swapHref} /></Suspense>
    </section>
  </AppShell>;
}

function DevelopmentHeader() { return <header className="page-header dashboard-header"><div><p className="eyebrow">DEVELOPMENT</p><h1>Course-development dashboard</h1><p>Completion, current workflow status, recorded effort, and project details by normalized Reporting year.</p></div></header>; }
async function AnalyticsSection({ promise, projectFilters, projectForeign }: { promise: ReturnType<typeof loadDevelopmentAnalytics>; projectFilters: ReturnType<typeof parseDevelopmentProjectFilters>; projectForeign: URLSearchParams }) { const result=await promise; return result.error ? <QueryError title={result.error.title} message={result.error.message} code={result.error.code} /> : <DevelopmentAnalyticsView analytics={result.data} projectFilters={projectFilters} projectForeign={projectForeign} />; }
async function ProjectsSection({ promise, filters, foreignParams, people }: { promise: ReturnType<typeof loadDevelopmentProjectSection>; filters: ReturnType<typeof parseDevelopmentProjectFilters>; foreignParams: URLSearchParams; people: ProjectPersonOption[] }) { const result=await promise; if (result.projects.error) return <QueryError title={result.projects.error.title} message={result.projects.error.message} code={result.projects.error.code} />; return <section className="card development-project-list">{result.percentileError&&<p className="notice warning" role="status">Project rows remain available, but Development percentiles could not be loaded.</p>}<DevelopmentProjectTable rows={result.projects.data.rows} total={result.projects.data.total} filters={filters} foreignParams={foreignParams} people={people} percentileByTask={result.percentileByTask} /></section>; }
async function loadDevelopmentProjectSection(supabase: Parameters<typeof loadDevelopmentProjects>[0], filters: ReturnType<typeof parseDevelopmentFilters>) { const projects=await loadDevelopmentProjects(supabase,filters); if(projects.error)return {projects,percentileByTask:{},percentileError:false}; const percentile=await loadProjectLengthPercentilesResult(supabase,projects.data.rows.map((row)=>row.taskId)); return {projects,percentileByTask:Object.fromEntries(percentile.data),percentileError:Boolean(percentile.error)}; }
function QueryError({ title, message, code }: { title: string; message: string; code: string | null }) { return <section className="card dashboard-query-error" role="alert"><p className="eyebrow">REPORTING QUERY</p><h2>{title}</h2><p>{message}</p>{code&&<p><strong>Diagnostic code:</strong> <code>{code}</code></p>}</section>; }
function DevelopmentSectionSkeleton({ label, cards }: { label: string; cards: number }) { return <section className="development-loading" aria-label={label} aria-busy="true">{Array.from({length:cards},(_,index)=><article className="card loading-chart loading-pulse" key={index}><span className="sr-only">{label}</span></article>)}</section>; }
const EMPTY_OPTIONS: DevelopmentOptions = { statuses: [],users: [],folders: [],projects: [],customFields: [] };

async function CumulativeSection({ promise }: { promise: Promise<HoursTimeseries> }) {
  const result = await capture(promise, "Development hours time series");
  if (result.failure) return <ProjectsLoadFailure failure={result.failure} isAdmin={false} nonfatal nonfatalImpact="The cumulative hours chart is temporarily unavailable." />;
  return <InsightsCumulativeChart data={result.data} />;
}

async function ComparisonSection({ promise, swapHref }: { promise: Promise<[HoursTimeseries, HoursTimeseries]>; swapHref: string }) {
  const result = await capture(promise, "Development hours comparison");
  if (result.failure) return <ProjectsLoadFailure failure={result.failure} isAdmin={false} nonfatal nonfatalImpact="The comparison chart is temporarily unavailable." />;
  const [metricA, metricB] = result.data;
  return <InsightsComparisonChart metricA={metricA} metricB={metricB} swapHref={swapHref} />;
}

async function capture<T>(promise: Promise<T>, operation: string): Promise<{ data: T; failure: null } | { data: null; failure: ReportingFailure }> {
  try {
    return { data: await promise, failure: null };
  } catch (error) {
    return { data: null, failure: reportingFailure(error, operation, "202609250001_reporting_hours_timeseries.sql") };
  }
}
