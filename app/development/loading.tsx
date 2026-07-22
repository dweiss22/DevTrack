import { AppShell } from "@/components/app-shell";

const PROJECT_COLUMNS = ["Project name", "Status", "Vertical", "ID Assigned", "Folders", "Development percentile"];

export default function DevelopmentLoading() {
  return <AppShell isAdmin={false}>
    <div className="development-route-loading" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the Development dashboard and reporting data</span>

      <header className="page-header dashboard-header">
        <div>
          <p className="eyebrow">DEVELOPMENT</p>
          <h1>Course-development dashboard</h1>
          <p>Preparing completion, workflow, effort, and project reporting...</p>
        </div>
      </header>

      <section className="card development-route-loading-filter" aria-hidden="true">
        <span className="development-route-loading-label">Reporting year</span>
        <span className="loading-pulse development-route-loading-select" />
      </section>

      <section className="development-loading" aria-hidden="true">
        {Array.from({ length: 3 }, (_, index) => <article className="card development-route-loading-chart" key={index}>
          <span className="loading-pulse development-route-loading-title" />
          <span className="loading-pulse development-route-loading-copy" />
          <span className="loading-pulse development-route-loading-visual" />
        </article>)}
      </section>

      <section className="card development-project-list development-route-loading-projects" aria-hidden="true">
        <div className="project-list-toolbar">
          <div><p className="eyebrow">PROJECT LIST</p><h2>Reporting-year projects</h2></div>
          <span className="loading-pulse development-route-loading-control" />
        </div>
        <div className="projects-table-wrap">
          <table className="projects-table development-project-table projects-loading-table">
            <thead><tr>{PROJECT_COLUMNS.map((column) => <th key={column}>{column}</th>)}</tr></thead>
            <tbody>{Array.from({ length: 6 }, (_, row) => <tr key={row}>{PROJECT_COLUMNS.map((column) => <td data-label={column} key={column}><span className="loading-pulse" /></td>)}</tr>)}</tbody>
          </table>
        </div>
      </section>
    </div>
  </AppShell>;
}
