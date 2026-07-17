import { AppShell } from "@/components/app-shell";

export default function Loading() {
  return <AppShell>
    <header className="page-header" aria-busy="true">
      <div><p className="eyebrow">LOADING</p><h1>Loading DevTrack</h1><p>Retrieving the latest reporting data…</p></div>
    </header>
    <section className="metric-grid" aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => <article className="card metric loading-card" key={index}><p>Loading</p><strong>—</strong></article>)}
    </section>
  </AppShell>;
}
