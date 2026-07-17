import React from "react";
import type { ReportingFilters } from "@/lib/reporting/filters";
import type { CustomFieldFilterOption, StatusFilterOption } from "@/lib/reporting/options";

type Option = { id: string; name: string };
export function ReportFilters({ filters, users = [], scopes = [], folders = [], projects = [], statuses = [], categories = [], customFields = [], includeTime = true, taskOnly = false }: { filters: ReportingFilters; users?: Option[]; scopes?: Option[]; folders?: Option[]; projects?: Option[]; statuses?: (string | StatusFilterOption)[]; categories?: Option[]; customFields?: CustomFieldFilterOption[]; includeTime?: boolean; taskOnly?: boolean }) {
  const statusOptions = statuses.map((status) => typeof status === "string" ? { id: status, name: status } : status);
  return <form className="card report-filters" method="get"><div className="filter-fields">
    <label>Search<input name="q" defaultValue={filters.q ?? ""} placeholder="Task or comment" /></label>
    <label>Status<select name="statuses" defaultValue={filters.statuses?.[0] ?? ""}><option value="">All statuses</option>{statusOptions.map((status) => <option value={status.id} key={status.id}>{status.name}</option>)}</select></label>
    <label>State<select name="state" defaultValue={filters.state ?? ""}><option value="">Any state</option><option value="open">Open</option><option value="overdue">Overdue</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></label>
    {!taskOnly && <label>Person<select name="assigneeIds" defaultValue={filters.assigneeIds?.[0] ?? ""}><option value="">All people</option>{users.map((user) => <option value={user.id} key={user.id}>{user.name}</option>)}</select></label>}
    {!taskOnly && <label>Source<select name="scopeIds" defaultValue={filters.scopeIds?.[0] ?? ""}><option value="">All visible sources</option>{scopes.map((scope) => <option value={scope.id} key={scope.id}>{scope.name}</option>)}</select></label>}
    {!taskOnly && projects.length > 0 && <label>Project<select name="projectIds" defaultValue={filters.projectIds?.[0] ?? ""}><option value="">All projects</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>}
    {!taskOnly && folders.length > 0 && <label>Folder<select name="folderIds" defaultValue={filters.folderIds?.[0] ?? ""}><option value="">All folders</option>{folders.map((folder) => <option value={folder.id} key={folder.id}>{folder.name}</option>)}</select></label>}
    <label>Date field<select name="dateField" defaultValue={filters.dateField ?? ""}><option value="">Report default</option>{!taskOnly && <option value="tracked">Tracked date</option>}<option value="due">Due date</option><option value="start">Start date</option><option value="created">Created date</option><option value="completed">Completed date</option></select></label>
    <label>From<input type="date" name="from" defaultValue={filters.from ?? ""} /></label><label>To<input type="date" name="to" defaultValue={filters.to ?? ""} /></label>
    {!taskOnly && includeTime && <label>Recorded time<select name="timeState" defaultValue={filters.timeState ?? ""}><option value="">Any amount</option><option value="with-time">With time</option><option value="no-time">No time</option></select></label>}
    {!taskOnly && <label>Min tracked hours<input type="number" min="0" step="0.25" name="minHours" defaultValue={filters.minMinutes == null ? "" : filters.minMinutes / 60} /></label>}
    {!taskOnly && <label>Max tracked hours<input type="number" min="0" step="0.25" name="maxHours" defaultValue={filters.maxMinutes == null ? "" : filters.maxMinutes / 60} /></label>}
    <label>Min planned hours<input type="number" min="0" step="0.25" name="minPlannedHours" defaultValue={filters.minPlannedMinutes == null ? "" : filters.minPlannedMinutes / 60} /></label>
    <label>Max planned hours<input type="number" min="0" step="0.25" name="maxPlannedHours" defaultValue={filters.maxPlannedMinutes == null ? "" : filters.maxPlannedMinutes / 60} /></label>
    {!taskOnly && categories.length > 0 && <label>Category<select name="categoryIds" defaultValue={filters.categoryIds?.[0] ?? ""}><option value="">All categories</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>}
    {customFields.map((field) => <label key={field.id}>{field.name}<select name={`cf_${field.id}`} defaultValue={filters.customFields?.[field.id] ?? ""}><option value="">All values</option>{field.values.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>)}
    <label>Sort<select name="sort" defaultValue={filters.sort}><option value="updated">Recently updated</option><option value="title">Task title</option><option value="due">Due date</option>{!taskOnly && <option value="actual">Most time</option>}</select></label>
    <label>Rows<select name="pageSize" defaultValue={String(filters.pageSize)}><option>25</option><option>50</option><option>100</option><option>200</option></select></label>
  </div><div className="filter-bar"><button type="submit">Apply filters</button><a className="button secondary" href="?">Clear</a></div></form>;
}
