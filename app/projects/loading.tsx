import { AppShell } from "@/components/app-shell";

export default function ProjectsLoading() {
  return <AppShell isAdmin={false}>
    <div className="projects-loading" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading projects and synchronized reporting data</span>
      <header className="page-header"><div><p className="eyebrow">PROJECTS</p><h1>Loading projects</h1><p>Preparing synchronized project analysis…</p></div></header>
      <section className="card projects-filter-card projects-loading-filter" aria-hidden="true">
        <div className="loading-pulse projects-loading-search" />
        <div className="projects-loading-filter-grid">{Array.from({ length: 4 }, (_, index) => <div className="loading-pulse" key={index} />)}</div>
      </section>
      <div className="projects-list-toolbar projects-loading-toolbar" aria-hidden="true"><div><h2>Projects</h2><p>Loading matching projects</p></div><div className="loading-pulse" /></div>
      <div className="projects-table-wrap" aria-hidden="true"><table className="projects-table projects-loading-table"><thead><tr><th>Project name</th><th>Status</th><th>Vertical</th><th>ID Assigned</th><th>Folders</th><th>Development percentile</th></tr></thead><tbody>{Array.from({ length: 8 }, (_, row) => <tr key={row}>{Array.from({ length: 6 }, (_, cell) => <td key={cell}><span className="loading-pulse" /></td>)}</tr>)}</tbody></table></div>
    </div>
  </AppShell>;
}
