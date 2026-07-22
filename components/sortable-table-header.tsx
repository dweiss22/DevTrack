import React from "react";
import Link from "next/link";

export type TableSortDirection = "asc" | "desc";

export function effectiveSortDirection(sort: string, direction?: string): TableSortDirection {
  if (direction === "asc" || direction === "desc") return direction;
  return ["updated", "actual", "completed", "percentile"].includes(sort) ? "desc" : "asc";
}

export function nextSortDirection(active: boolean, direction: TableSortDirection, initial: TableSortDirection = "asc"): TableSortDirection {
  return active ? direction === "asc" ? "desc" : "asc" : initial;
}

export function SortableTableHeader({ label, href, active, direction }: { label: string; href: string; active: boolean; direction: TableSortDirection }) {
  return <th aria-sort={active ? direction === "asc" ? "ascending" : "descending" : "none"}>
    <Link className="sortable-table-header" href={href}>{label}<span aria-hidden="true">{active ? direction === "asc" ? " ↑" : " ↓" : " ↕"}</span><span className="sr-only">{active ? `, sorted ${direction === "asc" ? "ascending" : "descending"}. Activate to reverse sorting.` : ". Activate to sort this column."}</span></Link>
  </th>;
}
