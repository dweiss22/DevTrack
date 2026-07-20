import React from "react";
import Link from "next/link";
import { developmentFiltersToQuery, type DevelopmentFilters, type DevelopmentOptions, type DevelopmentYearOptions } from "@/lib/reporting/development";
import { APPROVED_VERTICALS, VERTICAL_REPORTING_FILTER_OPTIONS } from "@/lib/wrike/vertical-normalization";

const DEVELOPMENT_FIELD_PATTERN = /(instructional designer|course owner|subject.?matter|\bsme\b|authoring tool|course type|product type)/i;
export function developmentCustomFields(options: DevelopmentOptions) { return options.customFields.filter((field) => DEVELOPMENT_FIELD_PATTERN.test(field.name)); }
export function developmentContactKeys(options: DevelopmentOptions) { return new Set(developmentCustomFields(options).filter((field) => /(designer|owner|subject.?matter|\bsme\b)/i.test(field.name)).map((field) => field.name.toLocaleLowerCase())); }

export function DevelopmentFiltersForm({ filters, years, options }: { filters: DevelopmentFilters; years: DevelopmentYearOptions; options: DevelopmentOptions }) {
  const customFields = developmentCustomFields(options);
  const chips = activeChips(filters, options, customFields);
  return <section aria-label="Development filters">
    <form className="card report-filters development-filters" method="get">
      <div className="filter-fields">
        <label>Reporting year<select name="reportingSelection" defaultValue={filters.reportingYearMode === "missing" ? "missing" : `year:${filters.reportingYear}`}><option value="" disabled>Select year</option>{years.years.map((year) => <option key={year.year} value={`year:${year.year}`}>{year.year} ({year.projects})</option>)}<option value="missing">Missing/Unresolved ({years.missingProjects})</option></select></label>
        <label>Search<input name="q" defaultValue={filters.q ?? ""} placeholder="Project or course title" /></label>
        <label>Completion<select name="completionClassification" defaultValue={filters.completionClassification ?? ""}><option value="">All classifications</option><option value="completed">Completed</option><option value="incomplete">Incomplete</option></select></label>
        <label>Custom status<select name="developmentStatus" defaultValue={filters.developmentStatus ?? ""}><option value="">All statuses</option><option value="__unknown__">Unknown Status</option>{options.statuses.map((status) => <option key={status.id} value={status.id}>{status.name}</option>)}</select></label>
        <label>Assigned user<select name="assigneeIds" defaultValue={filters.assigneeIds?.[0] ?? ""}><option value="">All assigned users</option>{options.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
        {customFields.map((field) => <label key={field.id}>{field.name}<select name={`cf_${field.id}`} defaultValue={filters.customFields?.[field.id] ?? ""}><option value="">All values</option>{field.values.map((value) => <option key={value} value={value}>{resolveOptionLabel(value, options)}</option>)}</select></label>)}
        <label>Vertical Reporting Category<select name="verticalReportingCategory" defaultValue={filters.verticalReportingCategory ?? ""}><option value="">All reporting categories</option>{VERTICAL_REPORTING_FILTER_OPTIONS.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>Associated Vertical<select name="associatedVertical" defaultValue={filters.associatedVertical ?? ""}><option value="">All associated Verticals</option>{APPROVED_VERTICALS.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>Priority<select name="priority" defaultValue={filters.priority ?? ""}><option value="">All priorities</option><option>High</option><option>Normal</option><option>Low</option></select></label>
        <label>Folder<select name="folderIds" defaultValue={filters.folderIds?.[0] ?? ""}><option value="">All folders</option>{options.folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>
        <label>Project location<select name="projectIds" defaultValue={filters.projectIds?.[0] ?? ""}><option value="">All projects</option>{options.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
        <label>Due from<input type="date" name="dueFrom" defaultValue={filters.dueFrom ?? ""} /></label><label>Due to<input type="date" name="dueTo" defaultValue={filters.dueTo ?? ""} /></label>
        <label>Completed from<input type="date" name="completedFrom" defaultValue={filters.completedFrom ?? ""} /></label><label>Completed to<input type="date" name="completedTo" defaultValue={filters.completedTo ?? ""} /></label>
        <label>Recorded time<select name="timeState" defaultValue={filters.timeState ?? ""}><option value="">Any amount</option><option value="with-time">With time</option><option value="no-time">Without time</option></select></label>
        <label className="check development-check"><input type="checkbox" name="unresolvedOnly" value="true" defaultChecked={filters.unresolvedOnly} />Only unresolved records</label>
        <label className="check development-check"><input type="checkbox" name="unresolvedVerticalOnly" value="true" defaultChecked={filters.unresolvedVerticalOnly} />Missing or unrecognized Vertical</label>
        <label>Sort<select name="sort" defaultValue={filters.sort}><option value="updated">Recently updated</option><option value="title">Title</option><option value="status">Status</option><option value="priority">Priority</option><option value="start">Start date</option><option value="due">Due date</option><option value="completed">Completion date</option><option value="actual">Recorded hours</option></select></label>
        <label>Rows<select name="pageSize" defaultValue={String(filters.pageSize)}><option>25</option><option>50</option><option>100</option><option>200</option></select></label>
      </div><div className="filter-bar"><button type="submit">Apply filters</button><Link className="button secondary" href="/development">Clear all filters</Link></div>
    </form>
    {chips.length > 0 && <div className="active-filter-chips" aria-label="Active filters">{chips.map((chip) => <Link key={chip.key} href={removeFilterHref(filters, chip.key)} aria-label={`Remove ${chip.label} filter`}>{chip.label}<span aria-hidden="true">×</span></Link>)}</div>}
  </section>;
}

function resolveOptionLabel(value: string, options: DevelopmentOptions) { return options.users.find((user) => user.wrikeId === value)?.name ?? (/^[A-Z0-9]{8,}$/.test(value) ? "Unresolved field value" : value); }
function activeChips(filters: DevelopmentFilters, options: DevelopmentOptions, fields: DevelopmentOptions["customFields"]) {
  const chips: { key: string; label: string }[] = [];
  if (filters.completionClassification) chips.push({ key: "completionClassification", label: filters.completionClassification === "completed" ? "Completed" : "Incomplete" });
  if (filters.developmentStatus) chips.push({ key: "developmentStatus", label: filters.developmentStatus === "__unknown__" ? "Unknown Status" : options.statuses.find((status) => status.id === filters.developmentStatus)?.name ?? "Selected status" });
  if (filters.q) chips.push({ key: "q", label: `Search: ${filters.q}` });
  if (filters.assigneeIds?.[0]) chips.push({ key: "assigneeIds", label: options.users.find((user) => user.id === filters.assigneeIds?.[0])?.name ?? "Assigned user" });
  if (filters.priority) chips.push({ key: "priority", label: `Priority: ${filters.priority}` });
  if (filters.timeState) chips.push({ key: "timeState", label: filters.timeState === "with-time" ? "With recorded time" : "Without recorded time" });
  if (filters.unresolvedOnly) chips.push({ key: "unresolvedOnly", label: "Unresolved records" });
  if (filters.verticalReportingCategory) chips.push({ key: "verticalReportingCategory", label: `Vertical Reporting Category: ${filters.verticalReportingCategory}` });
  if (filters.associatedVertical) chips.push({ key: "associatedVertical", label: `Associated Vertical: ${filters.associatedVertical}` });
  if (filters.unresolvedVerticalOnly) chips.push({ key: "unresolvedVerticalOnly", label: "Missing or unrecognized Vertical" });
  for (const key of ["dueFrom","dueTo","completedFrom","completedTo"] as const) if (filters[key]) chips.push({ key, label: `${labelFor(key)}: ${filters[key]}` });
  for (const [id, value] of Object.entries(filters.customFields ?? {})) chips.push({ key: `cf_${id}`, label: `${fields.find((field) => field.id === id)?.name ?? "Field"}: ${resolveOptionLabel(value, options)}` });
  return chips;
}
function removeFilterHref(filters: DevelopmentFilters, key: string) {
  const next = { ...filters, page: 1, customFields: { ...(filters.customFields ?? {}) } } as DevelopmentFilters;
  if (key.startsWith("cf_")) delete next.customFields?.[key.slice(3)];
  else delete (next as unknown as Record<string, unknown>)[key];
  return `/development?${developmentFiltersToQuery(next)}`;
}
function labelFor(key: string) { return ({ dueFrom: "Due from", dueTo: "Due to", completedFrom: "Completed from", completedTo: "Completed to" } as Record<string,string>)[key]; }
