"use client";
import React from "react";
import Link from "next/link";
import { ProjectPercentileRing } from "@/components/project-percentile-ring";
import { effectiveSortDirection, nextSortDirection, SortableTableHeader, type TableSortDirection } from "@/components/sortable-table-header";
import { StatusBadge, UnresolvedReferenceLabel } from "@/components/wrike-reference";
import { developmentFiltersToQuery, type DevelopmentFilters, type DevelopmentProjectRow } from "@/lib/reporting/development";
import type { ProjectLengthBenchmark } from "@/lib/reporting/project-overview";
import { projectFieldRole, projectOverviewContactValues, projectTableVerticalLabel, type ProjectPersonOption } from "@/lib/reporting/projects";

export function DevelopmentProjectTable({ rows, total, filters, people, percentileByTask }: {
  rows: DevelopmentProjectRow[];
  total: number;
  filters: DevelopmentFilters;
  people: ProjectPersonOption[];
  percentileByTask: Record<string, ProjectLengthBenchmark | null>;
}) {
  const currentHref = `/development?${developmentFiltersToQuery(filters)}`;
  return <>
    <div className="project-list-toolbar"><div><h2>Reporting-year project list</h2><p>{total.toLocaleString()} matching course{total === 1 ? "" : "s"}</p></div></div>
    {rows.length ? <div className="projects-table-wrap"><table className="projects-table development-project-table">
      <thead><tr>{DEVELOPMENT_SORT_COLUMNS.map((column) => {
        const active = filters.sort === column.key;
        const direction = effectiveSortDirection(filters.sort, filters.sortDirection);
        const href = `/development?${developmentFiltersToQuery({ ...filters, sort: column.key, sortDirection: nextSortDirection(active, direction, column.initial), page: 1 })}`;
        return <SortableTableHeader key={column.key} label={column.label} href={href} active={active} direction={direction} />;
      })}</tr></thead>
      <tbody>{rows.map((row) => {
        const vertical = Object.values(row.customValues).find((field) => field.title.trim().toLocaleLowerCase() === "vertical");
        const idAssigned = Object.values(row.customValues).find((field) => projectFieldRole(field.title) === "owner");
        const designers = projectOverviewContactValues(idAssigned?.values ?? [], people);
        return <tr key={row.taskId}>
          <td data-label="Project name"><Link href={`/projects/${row.taskId}?returnTo=${encodeURIComponent(currentHref)}&returnLabel=Development`}>{row.title}</Link></td>
          <td data-label="Status">{row.status.resolved ? <StatusBadge name={row.status.name} id={row.status.id} color={row.status.color} /> : <span className="status-badge unresolved"><UnresolvedReferenceLabel id={row.status.id} type="custom_status" label="Unknown Status" /></span>}</td>
          <td data-label="Vertical">{projectTableVerticalLabel(vertical, row.verticalState)}{vertical?.hasUnresolvedVertical ? <span title="Vertical value needs review"> ⚠</span> : null}</td>
          <td data-label="ID Assigned">{designers.length ? designers.map((person, index) => <span key={`${person.id}-${index}`}>{index ? ", " : ""}{person.resolved ? person.label : <UnresolvedReferenceLabel id={person.referenceId ?? person.id} type="user" />}</span>) : "—"}</td>
          <td data-label="Folders">{row.locations.length ? row.locations.map((location, index) => <span key={location.id}>{index ? ", " : ""}{location.resolved ? location.name : <UnresolvedReferenceLabel id={location.id} type="folder" />}</span>) : "—"}</td>
          <td data-label="Development percentile"><ProjectPercentileRing benchmark={percentileByTask[row.taskId] ?? null} /></td>
        </tr>;
      })}</tbody>
    </table></div> : <p className="empty">No projects match the selected reporting year and filters.</p>}
    <DevelopmentPagination filters={filters} total={total} />
  </>;
}

const DEVELOPMENT_SORT_COLUMNS = [
  { key: "title", label: "Project name", initial: "asc" },
  { key: "status", label: "Status", initial: "asc" },
  { key: "vertical", label: "Vertical", initial: "asc" },
  { key: "designer", label: "ID Assigned", initial: "asc" },
  { key: "folders", label: "Folders", initial: "asc" },
  { key: "percentile", label: "Development percentile", initial: "desc" }
] as const satisfies readonly { key: DevelopmentFilters["sort"]; label: string; initial: TableSortDirection }[];

function DevelopmentPagination({ filters, total }: { filters: DevelopmentFilters; total: number }) {
  const pages = Math.max(1, Math.ceil(total / filters.pageSize));
  if (pages <= 1) return null;
  const href = (page: number) => `/development?${developmentFiltersToQuery({ ...filters, page })}`;
  return <nav className="pagination" aria-label="Development project pages"><span>Page {filters.page} of {pages} · {total} records</span><div>{filters.page > 1 && <Link className="button secondary" href={href(filters.page - 1)}>Previous</Link>}{filters.page < pages && <Link className="button secondary" href={href(filters.page + 1)}>Next</Link>}</div></nav>;
}
