import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { InsightsFilters } from "@/components/insights-filters";
import { InsightsCumulativeChart } from "@/components/insights-cumulative-chart";
import { InsightsComparisonChart } from "@/components/insights-comparison-chart";
import { ProjectsLoadFailure } from "@/components/projects-load-failure";
import { requirePageCapability } from "@/lib/auth";
import { isAdministratorRole } from "@/lib/auth/roles";
import { reportingFailure, type ReportingFailure } from "@/lib/reporting/failure";
import { loadAccessibleProjectFacets, loadCustomFieldOptionsResult, loadStatusOptions } from "@/lib/reporting/options";
import { foreignFilterParams, loadHoursTimeseries, parsePrefixedReportingFilters, swapPrefixedFiltersHref, type HoursTimeseries } from "@/lib/reporting/insights";

type SearchValues = Record<string, string | string[] | undefined>;
const PATHNAME = "/insights";

export default async function InsightsPage({ searchParams }: { searchParams: Promise<SearchValues> }) {
  const query = await searchParams;
  const { supabase, profile } = await requirePageCapability("view_core_pages");
  const isAdministrator = isAdministratorRole(profile.access);

  const [customFieldsResult, statuses, facets, peopleResult] = await Promise.all([
    loadCustomFieldOptionsResult(supabase),
    loadStatusOptions(supabase, profile.organization_id),
    loadAccessibleProjectFacets(supabase),
    supabase.from("wrike_users").select("wrike_id,display_name,is_unresolved,identity_verified,identity_verification_source").eq("organization_id", profile.organization_id).order("display_name")
  ]);
  if (peopleResult.error) return <AppShell isAdmin={isAdministrator}><ProjectsLoadFailure failure={reportingFailure(peopleResult.error, "Wrike user names")} isAdmin={isAdministrator} /></AppShell>;

  const customFields = customFieldsResult.data;
  const people = (peopleResult.data ?? []).map((person) => ({ wrikeId: person.wrike_id, name: person.display_name, resolved: !person.is_unresolved && person.display_name !== person.wrike_id, displayable: person.display_name !== person.wrike_id, verified: person.identity_verified, verificationSource: person.identity_verification_source ?? (person.is_unresolved ? "unresolved" as const : "configured_fallback" as const) }));
  const customFieldsFailure = customFieldsResult.error ? reportingFailure(customFieldsResult.error, "Custom-field filter options") : null;

  const primaryFilters = parsePrefixedReportingFilters(query, "");
  const metricAFilters = parsePrefixedReportingFilters(query, "a_");
  const metricBFilters = parsePrefixedReportingFilters(query, "b_");
  const primaryForeign = foreignFilterParams(query, "");
  const metricAForeign = foreignFilterParams(query, "a_");
  const metricBForeign = foreignFilterParams(query, "b_");
  const swapHref = swapPrefixedFiltersHref(PATHNAME, query, "a_", "b_");

  const cumulativePromise = loadHoursTimeseries(supabase, primaryFilters);
  const comparisonPromise = Promise.all([loadHoursTimeseries(supabase, metricAFilters), loadHoursTimeseries(supabase, metricBFilters)]);

  return <AppShell isAdmin={isAdministrator}>
    <header className="page-header"><div><p className="eyebrow">DEVELOPMENT ANALYTICS</p><h1>Development Analytics</h1><p>Explore recorded development hours across Year, Status, Designer, Tools, Course Type, Course Style, Vertical, and Course Length, and compare two filtered views side by side.</p></div></header>
    {customFieldsFailure && <ProjectsLoadFailure failure={customFieldsFailure} isAdmin={isAdministrator} nonfatal nonfatalImpact="Charts remain available, but some filter choices may be temporarily unavailable." />}

    <section className="insights-section" aria-labelledby="cumulative-section-title">
      <h2 id="cumulative-section-title" className="sr-only">Cumulative hours</h2>
      <InsightsFilters title="Filters" prefix="" pathname={PATHNAME} foreignParams={primaryForeign} filters={primaryFilters} statuses={statuses} customFields={customFields} people={people} facets={facets} />
      <Suspense fallback={<ChartSkeleton label="Loading cumulative hours" />}>
        <CumulativeSection promise={cumulativePromise} />
      </Suspense>
    </section>

    <section className="insights-section" aria-labelledby="comparison-section-title">
      <h2 id="comparison-section-title" className="sr-only">Compare two metrics</h2>
      <div className="insights-compare-grid">
        <InsightsFilters title="Metric A" prefix="a_" pathname={PATHNAME} foreignParams={metricAForeign} filters={metricAFilters} statuses={statuses} customFields={customFields} people={people} facets={facets} />
        <InsightsFilters title="Metric B" prefix="b_" pathname={PATHNAME} foreignParams={metricBForeign} filters={metricBFilters} statuses={statuses} customFields={customFields} people={people} facets={facets} />
      </div>
      <Suspense fallback={<ChartSkeleton label="Loading comparison" />}>
        <ComparisonSection promise={comparisonPromise} swapHref={swapHref} />
      </Suspense>
    </section>
  </AppShell>;
}

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

function ChartSkeleton({ label }: { label: string }) {
  return <article className="card loading-chart loading-pulse" aria-busy="true"><span className="sr-only">{label}</span></article>;
}

async function capture<T>(promise: Promise<T>, operation: string): Promise<{ data: T; failure: null } | { data: null; failure: ReportingFailure }> {
  try {
    return { data: await promise, failure: null };
  } catch (error) {
    return { data: null, failure: reportingFailure(error, operation, "202609250001_reporting_hours_timeseries.sql") };
  }
}
