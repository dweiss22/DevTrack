import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Pagination } from "@/components/pagination";
import { ReportFilters } from "@/components/report-filters";
import { StatusBadge, UnresolvedReferenceLabel } from "@/components/wrike-reference";
import { requireContext } from "@/lib/auth";
import { hours } from "@/lib/metrics";
import { loadTaskRows } from "@/lib/reporting/data";
import { filtersToQuery, parseReportingFilters } from "@/lib/reporting/filters";
import { loadCustomFieldOptions, loadStatusOptions } from "@/lib/reporting/options";
import { safeDashboardReturnTo } from "@/lib/reporting/dashboard-navigation";

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const filters = parseReportingFilters(query);
  const returnTo = safeDashboardReturnTo(query.returnTo);
  const projectListQuery = new URLSearchParams(filtersToQuery(filters));
  if (returnTo) projectListQuery.set("returnTo", returnTo);
  const projectListHref = `/projects?${projectListQuery.toString()}`;
  const { supabase, profile } = await requireContext();
  const [projects, statuses, customFields] = await Promise.all([
    loadTaskRows(supabase, filters),
    loadStatusOptions(supabase, profile.organization_id),
    loadCustomFieldOptions(supabase)
  ]);
  const total = projects[0]?.total_count ?? 0;

  return <AppShell isAdmin={profile.role === "admin"}>
    <header className="page-header"><div><p className="eyebrow">PROJECTS</p><h1>Imported Wrike projects</h1><p>Browse synchronized project work while retaining stable Wrike task IDs and reporting access controls.</p></div>{returnTo && <Link className="button secondary" href={returnTo}>Back to Dashboard</Link>}</header>
    <ReportFilters filters={filters} statuses={statuses} customFields={customFields} taskOnly returnTo={returnTo} verticalMode="associated" />
    {projects.length ? <>
      <table><thead><tr><th>Project</th><th>Status</th><th>Associated Vertical</th><th>Vertical Reporting Category</th><th>Assignees</th><th>Folders</th><th>Due</th><th>Planned</th><th>Last updated</th></tr></thead><tbody>{projects.map((project) => { const vertical = Object.values(project.custom_values).find((field) => field.title.trim().toLocaleLowerCase() === "vertical"); return <tr key={project.task_id}>
        <td><Link href={`/projects/${project.task_id}?returnTo=${encodeURIComponent(projectListHref)}`}>{project.title}</Link></td>
        <td><StatusBadge name={project.status_name} id={project.custom_status_id} color={project.status_reference.color} resolved={project.status_reference.resolved} /></td>
        <td>{vertical?.normalizedVerticals?.join(", ") || vertical?.values.join(", ") || "—"}{vertical?.hasUnresolvedVertical ? <span title={`Unrecognized: ${vertical.unresolvedVerticalTokens?.join(", ") || "missing value"}`}> ⚠</span> : null}</td>
        <td>{vertical?.verticalReportingCategory ?? "Unresolved Vertical"}</td>
        <td>{project.responsible_users.length ? project.responsible_users.map((user, index) => <span key={user.wrikeUserId}>{index > 0 && ", "}{user.resolved ? user.fullName : <UnresolvedReferenceLabel id={user.wrikeUserId} type="user" />}</span>) : "—"}</td>
        <td>{project.locations.length ? project.locations.map((location, index) => <span key={location.wrikeId}>{index > 0 && ", "}{location.resolved ? location.title : <UnresolvedReferenceLabel id={location.wrikeId} type="folder" />}</span>) : "—"}</td>
        <td>{project.due_date ?? "—"}</td>
        <td>{project.planned_minutes == null ? "—" : `${hours(project.planned_minutes)} h`}</td>
        <td>{project.updated_at_wrike ? new Date(project.updated_at_wrike).toLocaleDateString() : "—"}</td>
      </tr>;})}</tbody></table>
      <Pagination filters={filters} total={total} returnTo={returnTo} />
    </> : <p className="card empty">No imported projects match these filters. If no import has run, go to Data and select Import folder tasks and timelogs.</p>}
  </AppShell>;
}
