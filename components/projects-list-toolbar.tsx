import React from "react";
import { AutoSubmitSelect } from "@/components/auto-submit-select";
import { filtersToQuery, type ReportingFilters } from "@/lib/reporting/filters";

export function ProjectsListToolbar({ filters, total, returnTo }: { filters: ReportingFilters; total: number; returnTo?: string }) {
  const preserved = [...new URLSearchParams(filtersToQuery({ ...filters, page: 1 })).entries()].filter(([name]) => !["sort", "pageSize", "page"].includes(name));
  return <div className="projects-list-toolbar">
    <div><h2>Projects</h2><p>{total.toLocaleString()} matching project{total === 1 ? "" : "s"}</p></div>
    <form method="get" aria-label="Project list display options">
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
      {preserved.map(([name, value], index) => <input type="hidden" name={name} value={value} key={`${name}-${value}-${index}`} />)}
      <label>Sort<AutoSubmitSelect name="sort" value={filters.sort}><option value="updated">Recently updated</option><option value="title">Project title</option><option value="due">Due date</option><option value="actual">Most time</option></AutoSubmitSelect></label>
      <label>Rows<AutoSubmitSelect name="pageSize" value={String(filters.pageSize)}><option>25</option><option>50</option><option>100</option><option>200</option></AutoSubmitSelect></label>
    </form>
  </div>;
}
