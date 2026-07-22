import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Pagination } from "@/components/pagination";
import { ProjectPercentileRing } from "@/components/project-percentile-ring";
import { ProjectsLoadFailure } from "@/components/projects-load-failure";
import { ProjectsFilters } from "@/components/projects-filters";
import { ProjectsListToolbar } from "@/components/projects-list-toolbar";
import { StatusBadge, UnresolvedReferenceLabel } from "@/components/wrike-reference";
import { requireContext } from "@/lib/auth";
import { loadProjectLengthPercentilesResult, loadTaskRows } from "@/lib/reporting/data";
import { safeDashboardReturnTo } from "@/lib/reporting/dashboard-navigation";
import { reportingFailure, type ReportingFailure } from "@/lib/reporting/failure";
import { filtersToQuery, parseProjectReportingFilters } from "@/lib/reporting/filters";
import { loadAccessibleProjectFacets, loadCustomFieldOptionsResult, loadStatusOptions } from "@/lib/reporting/options";
import { projectFieldRole, projectOverviewContactValues } from "@/lib/reporting/projects";
import { verticalStateLabel } from "@/lib/wrike/vertical-normalization";

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const filters = parseProjectReportingFilters(query);
  const returnTo = safeDashboardReturnTo(query.returnTo);
  const projectListQuery = new URLSearchParams(filtersToQuery(filters));
  if (returnTo) projectListQuery.set("returnTo", returnTo);
  const projectListHref = `/projects?${projectListQuery.toString()}`;
  const { supabase, profile } = await requireContext();
  const [projectsLoad, statusesLoad, customFieldsResult, facetsLoad, peopleLoad] = await Promise.all([
    captureProjectsRequest("Project list query", loadTaskRows(supabase, filters)),
    captureProjectsRequest("Project status options", loadStatusOptions(supabase, profile.organization_id)),
    loadCustomFieldOptionsResult(supabase),
    captureProjectsRequest("Project filter facets", loadAccessibleProjectFacets(supabase)),
    captureProjectsRequest("Wrike user names", supabase.from("wrike_users").select("wrike_id,display_name,is_unresolved").eq("organization_id", profile.organization_id).order("display_name"))
  ]);
  if (projectsLoad.failure || statusesLoad.failure || facetsLoad.failure || peopleLoad.failure) return <AppShell isAdmin={profile.role === "admin"}>
    <ProjectsLoadFailure failure={(projectsLoad.failure ?? statusesLoad.failure ?? facetsLoad.failure ?? peopleLoad.failure)!} isAdmin={profile.role === "admin"} />
  </AppShell>;
  const projects = projectsLoad.data;
  const statusDefinitions = statusesLoad.data;
  const facets = facetsLoad.data;
  const peopleResult = peopleLoad.data;
  if (peopleResult.error) return <AppShell isAdmin={profile.role === "admin"}>
    <ProjectsLoadFailure failure={reportingFailure(peopleResult.error, "Wrike user names")} isAdmin={profile.role === "admin"} />
  </AppShell>;
  const customFields = customFieldsResult.data;
  const statuses = [
    ...statusDefinitions.filter((status) => facets.customStatusIds.has(status.id)),
    ...[...facets.customStatusIds].filter((id) => !statusDefinitions.some((status) => status.id === id)).map((id) => ({ id, name: `Unresolved Wrike status ${id}`, color: null, resolved: false })),
    ...[...facets.baseStatuses].filter((name) => !statusDefinitions.some((status) => status.id === name)).map((name) => ({ id: name, name, color: null, resolved: true }))
  ].sort((left, right) => left.name.localeCompare(right.name));
  const people = (peopleResult.data ?? []).map((person) => ({ wrikeId: person.wrike_id, name: person.display_name, resolved: !person.is_unresolved && person.display_name !== person.wrike_id }));
  const total = projects[0]?.total_count ?? 0;
  const percentileResult = await loadProjectLengthPercentilesResult(supabase, projects.map((project) => project.task_id));
  const percentileByTask = percentileResult.data;
  const percentileFailure = percentileResult.error ? reportingFailure(percentileResult.error, "Development percentile query", "202607210005_projects_percentile_performance.sql") : null;
  const customFieldsFailure = customFieldsResult.error ? reportingFailure(customFieldsResult.error, "Custom-field filter options") : null;

  return <AppShell isAdmin={profile.role === "admin"}>
    <header className="page-header"><div><p className="eyebrow">PROJECTS</p><h1>Projects</h1><p>Find synchronized work by project, owner, SME, status, or reporting detail.</p></div>{returnTo && <Link className="button secondary" href={returnTo}>Back to Dashboard</Link>}</header>
    {percentileFailure && <ProjectsLoadFailure failure={percentileFailure} isAdmin={profile.role === "admin"} nonfatal />}
    {customFieldsFailure && <ProjectsLoadFailure failure={customFieldsFailure} isAdmin={profile.role === "admin"} nonfatal nonfatalImpact="Project rows remain available; custom-field filter choices are temporarily unavailable." />}
    <ProjectsFilters filters={filters} statuses={statuses} customFields={customFields} people={people} facets={facets} returnTo={returnTo} />
    <ProjectsListToolbar filters={filters} total={total} returnTo={returnTo} />
    {projects.length ? <>
      <div className="projects-table-wrap"><table className="projects-table"><thead><tr><th>Project name</th><th>Status</th><th>Vertical</th><th>ID Assigned</th><th>Folders</th><th>Development percentile</th></tr></thead><tbody>{projects.map((project) => {
        const vertical = Object.values(project.custom_values).find((field) => field.title.trim().toLocaleLowerCase() === "vertical");
        const idAssigned = Object.values(project.custom_values).find((field) => projectFieldRole(field.title) === "owner");
        const idAssignedValues = projectOverviewContactValues(idAssigned?.values ?? [], people);
        return <tr key={project.task_id}>
          <td data-label="Project name"><Link href={`/projects/${project.task_id}?returnTo=${encodeURIComponent(projectListHref)}`}>{project.title}</Link></td>
          <td data-label="Status"><StatusBadge name={project.status_name} id={project.custom_status_id} color={project.status_reference.color} resolved={project.status_reference.resolved} /></td>
          <td data-label="Vertical">{project.vertical_state === "cross_vertical" ? "Cross-Vertical" : vertical?.normalizedVerticals?.join(", ") || vertical?.values.join(", ") || (project.vertical_state ? verticalStateLabel(project.vertical_state) : "—")}{vertical?.hasUnresolvedVertical ? <span title={profile.role === "admin" ? `Unrecognized: ${vertical.unresolvedVerticalTokens?.join(", ") || "missing value"}` : "Vertical value needs review"}> ⚠</span> : null}</td>
          <td data-label="ID Assigned">{idAssignedValues.length ? idAssignedValues.map((person, index) => <span key={`${person.id}-${index}`}>{index > 0 && ", "}{person.resolved ? person.label : <UnresolvedReferenceLabel id={person.referenceId ?? person.id} type="user" label={person.label} showId={person.referenceId != null} />}</span>) : "—"}</td>
          <td data-label="Folders">{project.locations.length ? project.locations.map((location, index) => <span key={location.wrikeId}>{index > 0 && ", "}{location.resolved ? location.title : <UnresolvedReferenceLabel id={location.wrikeId} type="folder" />}</span>) : "—"}</td>
          <td data-label="Development percentile"><ProjectPercentileRing benchmark={percentileByTask.get(project.task_id) ?? null} /></td>
        </tr>;
      })}</tbody></table></div>
      <Pagination filters={filters} total={total} returnTo={returnTo} />
    </> : <p className="card empty">No imported projects match these filters. Clear one or more filters, or go to Data if no import has run.</p>}
  </AppShell>;
}

type ProjectsRequestResult<T> = { data: T; failure: null } | { data: null; failure: ReportingFailure };

async function captureProjectsRequest<T>(operation: string, request: PromiseLike<T>): Promise<ProjectsRequestResult<T>> {
  try {
    return { data: await request, failure: null };
  } catch (error) {
    console.error("projects_request_failed", { operation, code: error && typeof error === "object" && "code" in error ? String(error.code) : null, message: error instanceof Error ? error.message : "Supabase request failed" });
    return { data: null, failure: reportingFailure(error, operation) };
  }
}
