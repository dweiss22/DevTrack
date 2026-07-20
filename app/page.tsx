import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { DashboardOverviewCharts, DashboardTimeChart } from "@/components/dashboard-charts";
import { DashboardYearFilter } from "@/components/dashboard-year-filter";
import { requireContext } from "@/lib/auth";
import { dashboardDrilldownHref } from "@/lib/reporting/dashboard-navigation";
import { loadDashboardOverview, loadDashboardTimeAnalytics, loadDashboardYearOptions, type DashboardAnalyticsFailure, type DashboardOverview } from "@/lib/reporting/dashboard";
import { parseReportingFilters } from "@/lib/reporting/filters";

function Metric({ label, value, detail }: { label: string; value: number; detail: string }) {
  return <article className="dashboard-stat"><p>{label}</p><strong>{value.toLocaleString()}</strong><small>{detail}</small></article>;
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const requested = parseReportingFilters(query);
  const { supabase, profile } = await requireContext();
  const [yearsResult, lastRunResult] = await Promise.all([
    loadDashboardYearOptions(supabase),
    supabase.from("wrike_folder_task_import_runs").select("created_at").eq("organization_id", profile.organization_id).eq("status", "succeeded").order("created_at", { ascending: false }).limit(1).maybeSingle()
  ]);

  return <AppShell isAdmin={profile.role === "admin"} lastSynced={lastRunResult.data?.created_at}>
    <header className="page-header dashboard-header"><div><p className="eyebrow">ONLINE LEARNING</p><h1>Dashboard</h1><p>A high-level view of synchronized Online Learning courses by Reporting Year.</p></div></header>
    {yearsResult.error ? <DashboardQueryError error={yearsResult.error} /> : yearsResult.data.length ? <DashboardWithYear requestedYear={requested.reportingYear} years={yearsResult.data} supabase={supabase} /> : <section className="card empty"><h2>No valid Reporting Years</h2><p>No accessible Online Learning projects have a Reporting value in the required “YYYY Courses” format.</p></section>}
  </AppShell>;
}

function DashboardWithYear({ requestedYear, years, supabase }: { requestedYear?: number; years: NonNullable<Awaited<ReturnType<typeof loadDashboardYearOptions>>["data"]>; supabase: Awaited<ReturnType<typeof requireContext>>["supabase"] }) {
  const selectedYear = years.some((option) => option.year === requestedYear) ? requestedYear! : years[0].year;
  const filters = parseReportingFilters({ reportingYear: String(selectedYear) });
  const overviewPromise = loadDashboardOverview(supabase, selectedYear);
  const timePromise = loadDashboardTimeAnalytics(supabase, selectedYear);
  return <>
    <DashboardYearFilter options={years} selectedYear={selectedYear} />
    <Suspense fallback={<DashboardSkeleton label="Loading Dashboard overview" />}><OverviewSection promise={overviewPromise} filters={filters} /></Suspense>
    <Suspense fallback={<DashboardSkeleton label="Loading recorded-time analytics" />}><TimeSection promise={timePromise} filters={filters} /></Suspense>
  </>;
}

async function OverviewSection({ promise, filters }: { promise: ReturnType<typeof loadDashboardOverview>; filters: ReturnType<typeof parseReportingFilters> }) {
  const result = await promise;
  if (result.error) return <DashboardQueryError error={result.error} />;
  const metrics = result.data.metrics;
  return <>
    <section className="dashboard-stat-bar" aria-label="Current project statistics">
      <Metric label="Total Projects" value={metrics.totalProjects} detail="Selected Reporting Year" />
      <Metric label="Active Projects" value={metrics.activeProjects} detail="Active or in progress" />
      <Metric label="Completed" value={metrics.completedProjects} detail="Explicit completed classification" />
    </section>
    {metrics.unresolvedStatusProjects > 0 && <p className="notice error">{metrics.unresolvedStatusProjects} project{metrics.unresolvedStatusProjects === 1 ? " has" : "s have"} an unclassified or unresolved Wrike status.</p>}
    {metrics.customFieldConflictProjects > 0 && <p className="notice error">{metrics.customFieldConflictProjects} project{metrics.customFieldConflictProjects === 1 ? " has" : "s have"} conflicting Dashboard custom-field sources.</p>}
    {metrics.unresolvedVerticalProjects > 0 && <p className="notice error">{metrics.unresolvedVerticalProjects} project{metrics.unresolvedVerticalProjects === 1 ? " has" : "s have"} a missing or unrecognized Vertical. <a href={dashboardDrilldownHref(filters, { kind: "unresolvedVertical" })}>Review affected projects</a>.</p>}
    <DashboardOverviewCharts analytics={result.data as DashboardOverview} filters={filters} />
  </>;
}

async function TimeSection({ promise, filters }: { promise: ReturnType<typeof loadDashboardTimeAnalytics>; filters: ReturnType<typeof parseReportingFilters> }) {
  const result = await promise;
  return result.error ? <DashboardQueryError error={result.error} /> : <DashboardTimeChart analytics={result.data} filters={filters} />;
}

function DashboardQueryError({ error }: { error: DashboardAnalyticsFailure }) {
  return <section className="card dashboard-query-error" role="alert"><p className="eyebrow">REPORTING QUERY</p><h2>{error.title}</h2><p>{error.message}</p>{error.diagnosticCode && <p><strong>Diagnostic code:</strong> <code>{error.diagnosticCode}</code></p>}<a className="button secondary" href="/">Retry Dashboard</a></section>;
}

function DashboardSkeleton({ label }: { label: string }) {
  return <section className="card loading-chart loading-pulse" aria-label={label} aria-busy="true"><span className="sr-only">{label}</span></section>;
}
