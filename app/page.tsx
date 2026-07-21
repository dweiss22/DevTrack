import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { DashboardOverviewCharts, DashboardTimeChart } from "@/components/dashboard-charts";
import { DashboardNoticePin, DashboardNoticeProvider, DashboardNoticeRegistration } from "@/components/dashboard-notices";
import { requireContext } from "@/lib/auth";
import { dashboardDrilldownHref } from "@/lib/reporting/dashboard-navigation";
import { loadDashboardOverview, loadDashboardTimeAnalytics, type DashboardAnalyticsFailure, type DashboardOverview } from "@/lib/reporting/dashboard";
import { parseReportingFilters } from "@/lib/reporting/filters";
import { dashboardOverviewNotices, dashboardTimeNotices } from "@/lib/reporting/dashboard-notices";

function Metric({ label, value, detail }: { label: string; value: number; detail: string }) {
  return <article className="dashboard-stat"><p>{label}</p><strong>{value.toLocaleString()}</strong><small>{detail}</small></article>;
}

export default async function Dashboard() {
  const { supabase, profile } = await requireContext();
  const lastRunResult = await supabase.from("wrike_folder_task_import_runs").select("created_at").eq("organization_id", profile.organization_id).eq("status", "succeeded").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const filters = parseReportingFilters({});
  const overviewPromise = loadDashboardOverview(supabase);
  const timePromise = loadDashboardTimeAnalytics(supabase);

  return <AppShell isAdmin={profile.role === "admin"} lastSynced={lastRunResult.data?.created_at}>
    <DashboardNoticeProvider>
      <header className="page-header dashboard-header"><div><p className="eyebrow">ONLINE LEARNING</p><h1>Dashboard</h1><p>A high-level view of synchronized Online Learning courses across all valid Reporting Years.</p></div><DashboardNoticePin /></header>
      <Suspense fallback={<DashboardSkeleton label="Loading Dashboard overview" />}><OverviewSection promise={overviewPromise} filters={filters} /></Suspense>
      <Suspense fallback={<DashboardSkeleton label="Loading recorded-time analytics" />}><TimeSection promise={timePromise} filters={filters} /></Suspense>
    </DashboardNoticeProvider>
  </AppShell>;
}

async function OverviewSection({ promise, filters }: { promise: ReturnType<typeof loadDashboardOverview>; filters: ReturnType<typeof parseReportingFilters> }) {
  const result = await promise;
  if (result.error) return <DashboardQueryError error={result.error} />;
  const metrics = result.data.metrics;
  const notices = dashboardOverviewNotices(metrics, dashboardDrilldownHref(filters, { kind: "unresolvedVertical" }));
  return <>
    <DashboardNoticeRegistration source="overview" notices={notices} />
    <section className="dashboard-stat-bar" aria-label="Current project statistics">
      <Metric label="Total Projects" value={metrics.totalProjects} detail="All valid Reporting Years" />
      <Metric label="Active Projects" value={metrics.activeProjects} detail="Active or in progress" />
      <Metric label="Completed" value={metrics.completedProjects} detail="Explicit completed classification" />
    </section>
    <DashboardOverviewCharts analytics={result.data as DashboardOverview} filters={filters} />
  </>;
}

async function TimeSection({ promise, filters }: { promise: ReturnType<typeof loadDashboardTimeAnalytics>; filters: ReturnType<typeof parseReportingFilters> }) {
  const result = await promise;
  if (result.error) return <DashboardQueryError error={result.error} />;
  return <><DashboardNoticeRegistration source="time" notices={dashboardTimeNotices(result.data.timeDataSynchronized)} /><DashboardTimeChart analytics={result.data} filters={filters} /></>;
}

function DashboardQueryError({ error }: { error: DashboardAnalyticsFailure }) {
  return <section className="card dashboard-query-error" role="alert"><p className="eyebrow">REPORTING QUERY</p><h2>{error.title}</h2><p>{error.message}</p>{error.diagnosticCode && <p><strong>Diagnostic code:</strong> <code>{error.diagnosticCode}</code></p>}<a className="button secondary" href="/">Retry Dashboard</a></section>;
}

function DashboardSkeleton({ label }: { label: string }) {
  return <section className="card loading-chart loading-pulse" aria-label={label} aria-busy="true"><span className="sr-only">{label}</span></section>;
}
