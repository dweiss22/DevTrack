import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Pagination } from "@/components/pagination";
import { ReportFilters } from "@/components/report-filters";
import { StatusBadge, UnresolvedReferenceLabel } from "@/components/wrike-reference";
import { requireContext } from "@/lib/auth";
import { hours } from "@/lib/metrics";
import { loadTaskRows } from "@/lib/reporting/data";
import { parseReportingFilters } from "@/lib/reporting/filters";
import { loadCustomFieldOptions, loadStatusOptions } from "@/lib/reporting/options";

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filters = parseReportingFilters(await searchParams);
  const { supabase, profile } = await requireContext();
  const [projects, statuses, customFields] = await Promise.all([
    loadTaskRows(supabase, filters),
    loadStatusOptions(supabase, profile.organization_id),
    loadCustomFieldOptions(supabase)
  ]);
  const total = projects[0]?.total_count ?? 0;

  return <AppShell isAdmin={profile.role === "admin"}>
    <header className="page-header"><div><p className="eyebrow">PROJECTS</p><h1>Imported Wrike projects</h1><p>Browse synchronized project work while retaining stable Wrike task IDs and reporting access controls.</p></div></header>
    <ReportFilters filters={filters} statuses={statuses} customFields={customFields} taskOnly />
    {projects.length ? <>
      <table><thead><tr><th>Project</th><th>Status</th><th>Assignees</th><th>Folders</th><th>Due</th><th>Planned</th><th>Last updated</th></tr></thead><tbody>{projects.map((project) => <tr key={project.task_id}>
        <td><Link href={`/projects/${project.task_id}`}>{project.title}</Link></td>
        <td><StatusBadge name={project.status_name} id={project.custom_status_id} color={project.status_reference.color} resolved={project.status_reference.resolved} /></td>
        <td>{project.responsible_users.length ? project.responsible_users.map((user, index) => <span key={user.wrikeUserId}>{index > 0 && ", "}{user.resolved ? user.fullName : <UnresolvedReferenceLabel id={user.wrikeUserId} type="user" />}</span>) : "—"}</td>
        <td>{project.locations.length ? project.locations.map((location, index) => <span key={location.wrikeId}>{index > 0 && ", "}{location.resolved ? location.title : <UnresolvedReferenceLabel id={location.wrikeId} type="folder" />}</span>) : "—"}</td>
        <td>{project.due_date ?? "—"}</td>
        <td>{project.planned_minutes == null ? "—" : `${hours(project.planned_minutes)} h`}</td>
        <td>{project.updated_at_wrike ? new Date(project.updated_at_wrike).toLocaleDateString() : "—"}</td>
      </tr>)}</tbody></table>
      <Pagination filters={filters} total={total} />
    </> : <p className="card empty">No imported projects match these filters. If no import has run, go to Data and select Import folder tasks and timelogs.</p>}
  </AppShell>;
}
