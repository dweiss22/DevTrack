import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { DevelopmentCompletionPanel, DevelopmentHoursByCategoryPanel, DevelopmentStatusPanel } from "@/components/development-analytics-panels";
import { DevelopmentFiltersForm } from "@/components/development-filters";
import { DevelopmentProjectTable } from "@/components/development-project-table";
import { InsightsCumulativePanel, InsightsComparisonPanel } from "@/components/insights-panels";
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
  type DevelopmentFilters,
  type DevelopmentOptions,
  type DevelopmentYearOptions
} from "@/lib/reporting/development";
import { loadHoursTimeseries, parsePrefixedReportingFilters, type HoursTimeseries } from "@/lib/reporting/insights";
import { loadAccessibleProjectFacets, type AccessibleProjectFacets, type CustomFieldFilterOption, type StatusFilterOption } from "@/lib/reporting/options";
import type { ProjectPersonOption } from "@/lib/reporting/projects";
import type { ReportingFilters } from "@/lib/reporting/filters";

type SearchValues = Record<string, string | string[] | undefined>;
type InsightsOptions = { statuses: StatusFilterOption[]; customFields: CustomFieldFilterOption[]; people: ProjectPersonOption[]; facets: AccessibleProjectFacets };

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
  const normalizedQuery = withDefaultDevelopmentSelection(query, DEVELOPMENT_PROJECT_FILTER_PREFIX, years);
  const projectFilters = parseDevelopmentProjectFilters(normalizedQuery, years.defaultYear);
  const projectForeign = developmentForeignParams(normalizedQuery, DEVELOPMENT_PROJECT_FILTER_PREFIX);
  const options = optionsResult.data ?? EMPTY_OPTIONS;
  const people: ProjectPersonOption[] = options.users.map((person) => ({ wrikeId: person.wrikeId, name: person.name, resolved: person.resolved, displayable: person.name !== person.wrikeId, verified: person.resolved, verificationSource: person.resolved ? "wrike_contact" as const : "unresolved" as const }));
  // The completion overview, status chart, and hours-by-category chart each keep their own
  // Reporting Year filter (client-side, via /api/development/analytics) with no shared page-level
  // state. This one server-side fetch just seeds all three panels' initial view.
  const initialAnalyticsFilters = parseDevelopmentFilters(withDefaultDevelopmentSelection({}, "", years), years.defaultYear);
  const analyticsPromise = loadDevelopmentAnalytics(supabase, initialAnalyticsFilters);
  const projectsPromise = loadDevelopmentProjectSection(supabase, projectFilters);

  const primaryFilters = parsePrefixedReportingFilters(query, "");
  const metricAFilters = parsePrefixedReportingFilters(query, "a_");
  const metricBFilters = parsePrefixedReportingFilters(query, "b_");
  const cumulativePromise = loadHoursTimeseries(supabase, primaryFilters);
  const comparisonPromise = Promise.all([loadHoursTimeseries(supabase, metricAFilters), loadHoursTimeseries(supabase, metricBFilters)]);
  const insightsOptions = { statuses: options.statuses, customFields: options.customFields, people, facets };

  return <AppShell isAdmin={isAdministrator} lastSynced={lastRunResult.data?.created_at}>
    <DevelopmentHeader />
    {optionsResult.error && <p className="notice error" role="status">Analytics remain available, but some filter and reference options could not be loaded. Unresolved values will remain identified.</p>}

    <Suspense fallback={<DevelopmentSectionSkeleton label="Loading cumulative hours" cards={1} />}><CumulativeSection promise={cumulativePromise} filters={primaryFilters} options={insightsOptions} /></Suspense>
    <Suspense fallback={<DevelopmentSectionSkeleton label="Loading comparison" cards={1} />}><ComparisonSection promise={comparisonPromise} filtersA={metricAFilters} filtersB={metricBFilters} options={insightsOptions} /></Suspense>

    <Suspense fallback={<DevelopmentSectionSkeleton label="Loading completion and status analytics" cards={3} />}><AnalyticsSection promise={analyticsPromise} initialFilters={initialAnalyticsFilters} years={years} projectFilters={projectFilters} projectForeign={projectForeign} /></Suspense>

    <DevelopmentFiltersForm filters={projectFilters} years={years} options={options} prefix={DEVELOPMENT_PROJECT_FILTER_PREFIX} foreignParams={projectForeign} label="Reporting-year project list Reporting Year filter" />
    <Suspense fallback={<DevelopmentSectionSkeleton label="Loading reporting-year projects" cards={1} />}><ProjectsSection promise={projectsPromise} filters={projectFilters} foreignParams={projectForeign} people={people} /></Suspense>
  </AppShell>;
}

function DevelopmentHeader() { return <header className="page-header dashboard-header"><div><p className="eyebrow">DEVELOPMENT</p><h1>Course-development dashboard</h1><p>Completion, current workflow status, recorded effort, and project details by normalized Reporting year.</p></div></header>; }
async function AnalyticsSection({ promise, initialFilters, years, projectFilters, projectForeign }: { promise: ReturnType<typeof loadDevelopmentAnalytics>; initialFilters: DevelopmentFilters; years: DevelopmentYearOptions; projectFilters: ReturnType<typeof parseDevelopmentProjectFilters>; projectForeign: URLSearchParams }) {
  const result = await promise;
  if (result.error) return <QueryError title={result.error.title} message={result.error.message} code={result.error.code} />;
  return <>
    <DevelopmentCompletionPanel initialFilters={initialFilters} initialData={result.data} years={years} projectFilters={projectFilters} projectForeign={projectForeign} />
    <section className="development-analysis-grid" aria-label="Status and time analysis">
      <DevelopmentStatusPanel initialFilters={initialFilters} initialData={result.data} years={years} projectFilters={projectFilters} projectForeign={projectForeign} />
      <DevelopmentHoursByCategoryPanel initialFilters={initialFilters} initialData={result.data} years={years} projectFilters={projectFilters} projectForeign={projectForeign} />
    </section>
  </>;
}
async function ProjectsSection({ promise, filters, foreignParams, people }: { promise: ReturnType<typeof loadDevelopmentProjectSection>; filters: ReturnType<typeof parseDevelopmentProjectFilters>; foreignParams: URLSearchParams; people: ProjectPersonOption[] }) { const result=await promise; if (result.projects.error) return <QueryError title={result.projects.error.title} message={result.projects.error.message} code={result.projects.error.code} />; return <section className="card development-project-list">{result.percentileError&&<p className="notice warning" role="status">Project rows remain available, but Development percentiles could not be loaded.</p>}<DevelopmentProjectTable rows={result.projects.data.rows} total={result.projects.data.total} filters={filters} foreignParams={foreignParams} people={people} percentileByTask={result.percentileByTask} /></section>; }
async function loadDevelopmentProjectSection(supabase: Parameters<typeof loadDevelopmentProjects>[0], filters: ReturnType<typeof parseDevelopmentFilters>) { const projects=await loadDevelopmentProjects(supabase,filters); if(projects.error)return {projects,percentileByTask:{},percentileError:false}; const percentile=await loadProjectLengthPercentilesResult(supabase,projects.data.rows.map((row)=>row.taskId)); return {projects,percentileByTask:Object.fromEntries(percentile.data),percentileError:Boolean(percentile.error)}; }
function QueryError({ title, message, code }: { title: string; message: string; code: string | null }) { return <section className="card dashboard-query-error" role="alert"><p className="eyebrow">REPORTING QUERY</p><h2>{title}</h2><p>{message}</p>{code&&<p><strong>Diagnostic code:</strong> <code>{code}</code></p>}</section>; }
function DevelopmentSectionSkeleton({ label, cards }: { label: string; cards: number }) { return <section className="development-loading" aria-label={label} aria-busy="true">{Array.from({length:cards},(_,index)=><article className="card loading-chart loading-pulse" key={index}><span className="sr-only">{label}</span></article>)}</section>; }
const EMPTY_OPTIONS: DevelopmentOptions = { statuses: [],users: [],folders: [],projects: [],customFields: [] };

async function CumulativeSection({ promise, filters, options }: { promise: Promise<HoursTimeseries>; filters: ReportingFilters; options: InsightsOptions }) {
  const result = await capture(promise, "Development hours time series");
  if (result.failure) return <ProjectsLoadFailure failure={result.failure} isAdmin={false} nonfatal nonfatalImpact="The cumulative hours chart is temporarily unavailable." />;
  return <InsightsCumulativePanel initialFilters={filters} initialData={result.data} options={options} />;
}

async function ComparisonSection({ promise, filtersA, filtersB, options }: { promise: Promise<[HoursTimeseries, HoursTimeseries]>; filtersA: ReportingFilters; filtersB: ReportingFilters; options: InsightsOptions }) {
  const result = await capture(promise, "Development hours comparison");
  if (result.failure) return <ProjectsLoadFailure failure={result.failure} isAdmin={false} nonfatal nonfatalImpact="The comparison chart is temporarily unavailable." />;
  const [dataA, dataB] = result.data;
  return <InsightsComparisonPanel initialFiltersA={filtersA} initialFiltersB={filtersB} initialDataA={dataA} initialDataB={dataB} options={options} />;
}

async function capture<T>(promise: Promise<T>, operation: string): Promise<{ data: T; failure: null } | { data: null; failure: ReportingFailure }> {
  try {
    return { data: await promise, failure: null };
  } catch (error) {
    return { data: null, failure: reportingFailure(error, operation, "202609250001_reporting_hours_timeseries.sql") };
  }
}
