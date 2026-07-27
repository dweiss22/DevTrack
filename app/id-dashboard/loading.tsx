import { AppShell } from "@/components/app-shell";

export default function IdDashboardLoading() {
  return <AppShell isAdmin={false}>
    <div className="development-route-loading" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the ID Dashboard and analytics</span>
      <header className="page-header">
        <div><p className="eyebrow">INSTRUCTIONAL DESIGN ASSIGNMENTS</p>
          <h1>ID Dashboard</h1><p>Preparing assigned projects and time analytics...</p></div>
      </header>
      <section className="card development-route-loading-filter" aria-hidden="true">
        <span className="loading-pulse development-route-loading-copy" />
      </section>
      <section className="id-dashboard-analytics" aria-hidden="true">
        {Array.from({ length: 2 }, (_, index) => <article className="card development-route-loading-chart" key={index}>
          <span className="loading-pulse development-route-loading-title" />
          <span className="loading-pulse development-route-loading-copy" />
          <span className="loading-pulse development-route-loading-visual" />
        </article>)}
      </section>
      <section className="card development-route-loading-projects" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => <span className="loading-pulse" key={index} />)}
      </section>
    </div>
  </AppShell>;
}
