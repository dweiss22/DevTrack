import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Pagination } from "@/components/pagination";
import { ProjectsFilters } from "@/components/projects-filters";
import { ProjectsListToolbar } from "@/components/projects-list-toolbar";
import { StatusBadge, UnresolvedReferenceLabel } from "@/components/wrike-reference";
import { requireContext } from "@/lib/auth";
import { hours } from "@/lib/metrics";
import { loadTaskRows } from "@/lib/reporting/data";
import { safeDashboardReturnTo } from "@/lib/reporting/dashboard-navigation";
import { filtersToQuery, parseReportingFilters } from "@/lib/reporting/filters";
import { loadAccessibleProjectFacets, loadCustomFieldOptionsResult, loadStatusOptions } from "@/lib/reporting/options";
import { verticalStateLabel } from "@/lib/wrike/vertical-normalization";

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const filters = parseReportingFilters(query);
  const returnTo = safeDashboardReturnTo(query.returnTo);
  const projectListQuery = new URLSearchParams(filtersToQuery(filters));
  if (returnTo) projectListQuery.set("returnTo", returnTo);
  const projectListHref = `/projects?${projectListQuery.toString()}`;
  const { supabase, profile } = await requireContext();
  const [projects, statusDefinitions, customFieldsResult, facets, peopleResult] = await Promise.all([
    loadTaskRows(supabase, filters),
    loadStatusOptions(supabase, profile.organization_id),
    loadCustomFieldOptionsResult(supabase),
    loadAccessibleProjectFacets(supabase),
    supabase.from("wrike_users").select("wrike_id,display_name,is_unresolved").eq("organization_id", profile.organization_id).order("display_name")
  ]);
  if (peopleResult.error) throw peopleResult.error;
  const customFields = customFieldsResult.data;
  const statuses = [
    ...statusDefinitions.filter((status) => facets.customStatusIds.has(status.id)),
    ...[...facets.customStatusIds].filter((id) => !statusDefinitions.some((status) => status.id === id)).map((id) => ({ id, name: `Unresolved Wrike status ${id}`, color: null, resolved: false })),
    ...[...facets.baseStatuses].filter((name) => !statusDefinitions.some((status) => status.id === name)).map((name) => ({ id: name, name, color: null, resolved: true }))
  ].sort((left, right) => left.name.localeCompare(right.name));
  const people = (peopleResult.data ?? []).map((person) => ({ wrikeId: person.wrike_id, name: person.display_name, resolved: !person.is_unresolved && person.display_name !== person.wrike_id }));
  const total = projects[0]?.total_count ?? 0;

  return <AppShell isAdmin={profile.role === "admin"}>
    <header className="page-header"><div><p className="eyebrow">PROJECTS</p><h1>Projects</h1><p>Find synchronized work by project, owner, SME, status, or reporting detail.</p></div>{returnTo && <Link className="button secondary" href={returnTo}>Back to Dashboard</Link>}</header>
    {customFieldsResult.error && <p className="notice error" role="status">Projects remain available, but custom-field filter options could not be loaded. Retry the page to restore those filter choices.</p>}
    <ProjectsFilters filters={filters} statuses={statuses} customFields={customFields} people={people} facets={facets} returnTo={returnTo} />
    <ProjectsListToolbar filters={filters} total={total} returnTo={returnTo} />
    {projects.length ? <>
      <div className="projects-table-wrap"><table className="projects-table"><thead><tr><th>Project</th><th>Status</th><th>Associated Vertical</th><th>Vertical Reporting Category</th><th>Assignees</th><th>Folders</th><th>Due</th><th>Planned</th><th>Last updated</th></tr></thead><tbody>{projects.map((project) => {
        const vertical = Object.values(project.custom_values).find((field) => field.title.trim().toLocaleLowerCase() === "vertical");
        return <tr key={project.task_id}>
          <td data-label="Project"><Link href={`/projects/${project.task_id}?returnTo=${encodeURIComponent(projectListHref)}`}>{project.title}</Link></td>
          <td data-label="Status"><StatusBadge name={project.status_name} id={project.custom_status_id} color={project.status_reference.color} resolved={project.status_reference.resolved} /></td>
          <td data-label="Associated Vertical">{vertical?.normalizedVerticals?.join(", ") || vertical?.values.join(", ") || "—"}{vertical?.hasUnresolvedVertical ? <span title={profile.role === "admin" ? `Unrecognized: ${vertical.unresolvedVerticalTokens?.join(", ") || "missing value"}` : "Vertical value needs review"}> ⚠</span> : null}</td>
          <td data-label="Vertical category">{project.vertical_state ? verticalStateLabel(project.vertical_state) : vertical?.verticalReportingCategory ?? "Vertical data not fully synchronized"}</td>
          <td data-label="Assignees">{project.responsible_users.length ? project.responsible_users.map((user, index) => <span key={user.wrikeUserId}>{index > 0 && ", "}{user.resolved ? user.fullName : <UnresolvedReferenceLabel id={user.wrikeUserId} type="user" />}</span>) : "—"}</td>
          <td data-label="Folders">{project.locations.length ? project.locations.map((location, index) => <span key={location.wrikeId}>{index > 0 && ", "}{location.resolved ? location.title : <UnresolvedReferenceLabel id={location.wrikeId} type="folder" />}</span>) : "—"}</td>
          <td data-label="Due">{project.due_date ?? "—"}</td>
          <td data-label="Planned">{project.planned_minutes == null ? "—" : `${hours(project.planned_minutes)} h`}</td>
          <td data-label="Last updated">{project.updated_at_wrike ? new Date(project.updated_at_wrike).toLocaleDateString() : "—"}</td>
        </tr>;
      })}</tbody></table></div>
      <Pagination filters={filters} total={total} returnTo={returnTo} />
    </> : <p className="card empty">No imported projects match these filters. Clear one or more filters, or go to Data if no import has run.</p>}
  </AppShell>;
}
