import { AppShell } from "@/components/app-shell";

export default function Loading() {
  return <AppShell>
    <header className="page-header" aria-busy="true"><div><p className="eyebrow">LOADING</p><h1>Loading dashboard</h1><p>Retrieving synchronized project analytics…</p></div></header>
    <section className="dashboard-stat-bar" aria-label="Loading current project statistics">{Array.from({ length: 3 }, (_, index) => <article className="dashboard-stat" key={index}><p>Loading metric</p><strong aria-hidden="true">—</strong></article>)}</section>
    <div className="dashboard-charts" aria-label="Loading dashboard charts" aria-busy="true">{Array.from({ length: 6 }, (_, index) => <section className="card loading-chart loading-pulse" key={index}><span className="sr-only">Loading chart {index + 1}</span></section>)}</div>
  </AppShell>;
}
