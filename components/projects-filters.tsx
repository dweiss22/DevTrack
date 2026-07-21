import React from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";
import { AutoSubmitSelect } from "@/components/auto-submit-select";
import { FilterDisclosure } from "@/components/filter-disclosure";
import { filtersToQuery, type ReportingFilters } from "@/lib/reporting/filters";
import type { AccessibleProjectFacets, CustomFieldFilterOption, StatusFilterOption } from "@/lib/reporting/options";
import {
  clearProjectFiltersHref,
  projectFilterFields,
  projectFilterHref,
  projectPersonLabel,
  projectPersonOptions,
  reportingYearOptions,
  type ProjectPersonOption
} from "@/lib/reporting/projects";
import { APPROVED_VERTICALS, verticalStateLabel } from "@/lib/wrike/vertical-normalization";

type Props = {
  filters: ReportingFilters;
  statuses: StatusFilterOption[];
  customFields: CustomFieldFilterOption[];
  people: ProjectPersonOption[];
  facets: AccessibleProjectFacets;
  returnTo?: string;
};

export function ProjectsFilters({ filters, statuses, customFields, people, facets, returnTo }: Props) {
  const fields = projectFilterFields(customFields);
  const years = reportingYearOptions(fields.reporting);
  const ownerOptions = projectPersonOptions(fields.owner, people);
  const smeOptions = projectPersonOptions(fields.sme, people);
  const verticalOptions = APPROVED_VERTICALS.filter((value) => fields.vertical?.values.includes(value));
  const selectedVertical = filters.associatedVertical ? `associated:${filters.associatedVertical}`
      : filters.verticalReportingCategory ? `category:${filters.verticalReportingCategory}`
      : filters.verticalState ? `state:${filters.verticalState}`
        : filters.unresolvedVerticalOnly ? "legacy:unresolved" : "";
  const advancedCount = [fields.courseType && filters.customFields?.[fields.courseType.id], selectedVertical, fields.sme && filters.customFields?.[fields.sme.id], fields.courseLength && filters.customFields?.[fields.courseLength.id]].filter(Boolean).length;
  const visibleNames = new Set(["q", "statuses", "reportingYear", "associatedVertical", "verticalReportingCategory", "verticalState", "unresolvedVerticalOnly", "verticalSelection"]);
  for (const field of [fields.owner, fields.tool, fields.courseType, fields.sme, fields.courseLength]) if (field) visibleNames.add(`cf_${field.id}`);
  const preserved = [...new URLSearchParams(filtersToQuery({ ...filters, page: 1 })).entries()].filter(([name]) => !visibleNames.has(name) && name !== "page");
  const statusValue = filters.statuses?.[0] ?? "";
  const currentStatus = statuses.find((status) => status.id === statusValue);
  const active = activeProjectFilters(filters, fields, people, statuses, selectedVertical, returnTo);

  return <section className="card projects-filter-card" aria-labelledby="project-search-heading">
    <h2 id="project-search-heading" className="sr-only">Search and filter projects</h2>
    <form method="get" className="projects-filter-form">
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
      {preserved.map(([name, value], index) => <input type="hidden" name={name} value={value} key={`${name}-${value}-${index}`} />)}
      <div className="projects-search-row">
        <label className="projects-search"><span>Search projects</span><span className="projects-search-input"><Search aria-hidden="true" size={19} /><input name="q" defaultValue={filters.q ?? ""} placeholder="Search project titles and associated people" /></span></label>
        <button type="submit">Search</button>
        {filters.q && <Link className="button secondary projects-clear-search" href={projectFilterHref(filters, { q: null }, returnTo)} aria-label="Clear project search"><X aria-hidden="true" size={17} /> Clear</Link>}
      </div>
      <div className="projects-primary-filters">
        <SelectFilter label="Year" name="reportingYear" value={filters.reportingYear == null ? "" : String(filters.reportingYear)} disabled={!years.length && filters.reportingYear == null}>
          <option value="">All years</option>
          {filters.reportingYear != null && !years.includes(filters.reportingYear) && <option value={filters.reportingYear}>{filters.reportingYear}</option>}
          {years.map((year) => <option value={year} key={year}>{year}</option>)}
        </SelectFilter>
        <SelectFilter label="Status" name="statuses" value={statusValue} disabled={!statuses.length && !statusValue}>
          <option value="">All statuses</option>
          {statusValue && !currentStatus && <option value={statusValue}>Unresolved status {statusValue}</option>}
          {statuses.map((status) => <option value={status.id} key={status.id}>{status.name}</option>)}
        </SelectFilter>
        <SelectFilter label="Owner" name={fields.owner ? `cf_${fields.owner.id}` : "ownerUnavailable"} value={fields.owner ? filters.customFields?.[fields.owner.id] ?? "" : ""} disabled={!fields.owner}>
          <option value="">{fields.owner ? "All owners" : "No synchronized Owner field"}</option>
          {ownerOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
        </SelectFilter>
        <SelectFilter label="Tool" name={fields.tool ? `cf_${fields.tool.id}` : "toolUnavailable"} value={fields.tool ? filters.customFields?.[fields.tool.id] ?? "" : ""} disabled={!fields.tool}>
          <option value="">{fields.tool ? "All tools" : "No synchronized Tool field"}</option>
          {fields.tool?.values.map((value) => <option value={value} key={value}>{value}</option>)}
        </SelectFilter>
      </div>
      <FilterDisclosure count={advancedCount} initiallyOpen={advancedCount > 0}>
        <div className="projects-advanced-grid">
          <SelectFilter label="Course Type" name={fields.courseType ? `cf_${fields.courseType.id}` : "courseTypeUnavailable"} value={fields.courseType ? filters.customFields?.[fields.courseType.id] ?? "" : ""} disabled={!fields.courseType}>
            <option value="">{fields.courseType ? "All course types" : "No synchronized Course Type field"}</option>
            {fields.courseType?.values.map((value) => <option value={value} key={value}>{value}</option>)}
          </SelectFilter>
          <SelectFilter label="Vertical" name="verticalSelection" value={selectedVertical} disabled={!fields.vertical && !selectedVertical && !facets.verticalStates.size}>
            <option value="">All Verticals</option>
            {filters.associatedVertical && !verticalOptions.includes(filters.associatedVertical) && <option value={`associated:${filters.associatedVertical}`}>{filters.associatedVertical}</option>}
            {filters.verticalReportingCategory && <option value={`category:${filters.verticalReportingCategory}`}>{filters.verticalReportingCategory === "Cross Vertical" ? "Cross-Vertical" : filters.verticalReportingCategory}</option>}
            {filters.verticalState && !facets.verticalStates.has(filters.verticalState) && <option value={`state:${filters.verticalState}`}>{verticalStateLabel(filters.verticalState)}</option>}
            {filters.unresolvedVerticalOnly && <option value="legacy:unresolved">Any Vertical issue</option>}
            {verticalOptions.map((value) => <option value={`associated:${value}`} key={value}>{value}</option>)}
            {facets.verticalStates.has("cross_vertical") && <option value="state:cross_vertical">Cross-Vertical</option>}
            {facets.verticalStates.has("missing") && <option value="state:missing">Vertical not assigned</option>}
            {facets.verticalStates.has("unrecognized") && <option value="state:unrecognized">Vertical value needs review</option>}
            {facets.verticalStates.has("synchronization_incomplete") && <option value="state:synchronization_incomplete">Vertical data not fully synchronized</option>}
          </SelectFilter>
          <SelectFilter label="SME" name={fields.sme ? `cf_${fields.sme.id}` : "smeUnavailable"} value={fields.sme ? filters.customFields?.[fields.sme.id] ?? "" : ""} disabled={!fields.sme}>
            <option value="">{fields.sme ? "All SMEs" : "No synchronized SME field"}</option>
            {smeOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
          </SelectFilter>
          <SelectFilter label="Course Length" name={fields.courseLength ? `cf_${fields.courseLength.id}` : "courseLengthUnavailable"} value={fields.courseLength ? filters.customFields?.[fields.courseLength.id] ?? "" : ""} disabled={!fields.courseLength}>
            <option value="">{fields.courseLength ? "All course lengths" : "No synchronized Course Length field"}</option>
            {fields.courseLength?.values.map((value) => <option value={value} key={value}>{value}</option>)}
          </SelectFilter>
        </div>
      </FilterDisclosure>
    </form>
    {active.length > 0 && <div className="projects-active-filters" aria-label="Active project filters">
      <span>Active:</span>{active.map((item) => <Link href={item.href} key={item.key}>{item.label}<X aria-hidden="true" size={13} /><span className="sr-only">Clear {item.label}</span></Link>)}
      <Link className="projects-clear-all" href={clearProjectFiltersHref(filters, returnTo)}>Clear All</Link>
    </div>}
  </section>;
}

function SelectFilter({ label, name, value, disabled, children }: { label: string; name: string; value: string; disabled?: boolean; children: React.ReactNode }) {
  return <label>{label}<AutoSubmitSelect name={name} value={value} disabled={disabled}>{children}</AutoSubmitSelect></label>;
}

function activeProjectFilters(filters: ReportingFilters, fields: ReturnType<typeof projectFilterFields>, people: ProjectPersonOption[], statuses: StatusFilterOption[], selectedVertical: string, returnTo?: string) {
  const items: { key: string; label: string; href: string }[] = [];
  const add = (key: string, label: string, changes: Record<string, string | null>) => items.push({ key, label, href: projectFilterHref(filters, changes, returnTo) });
  if (filters.q) add("q", `Search: ${filters.q}`, { q: null });
  if (filters.reportingYear != null) add("year", `Year: ${filters.reportingYear}`, { reportingYear: null });
  const statusId = filters.statuses?.[0];
  if (statusId) add("status", `Status: ${statuses.find((status) => status.id === statusId)?.name ?? statusId}`, { statuses: null });
  for (const [key, field, prefix, contact] of [
    ["owner", fields.owner, "Owner", true], ["tool", fields.tool, "Tool", false], ["course-type", fields.courseType, "Course Type", false], ["sme", fields.sme, "SME", true], ["course-length", fields.courseLength, "Course Length", false]
  ] as const) {
    const value = field ? filters.customFields?.[field.id] : undefined;
    if (field && value) add(key, `${prefix}: ${contact ? projectPersonLabel(value, people) : value}`, { [`cf_${field.id}`]: null });
  }
  if (selectedVertical) {
    const label = filters.associatedVertical ?? filters.verticalReportingCategory ?? (filters.verticalState ? verticalStateLabel(filters.verticalState) : "Unresolved Vertical");
    items.push({ key: "vertical", label: `Vertical: ${label}`, href: projectFilterHref(filters, { associatedVertical: null, verticalReportingCategory: null, verticalState: null, unresolvedVerticalOnly: null }, returnTo) });
  }
  if (filters.dashboardClassification) add("classification", `Dashboard: ${filters.dashboardClassification.replaceAll("_", " ")}`, { dashboardClassification: null });
  if (filters.dashboardField && filters.dashboardValue) add("dashboard-category", `${filters.dashboardField}: ${filters.dashboardValue}`, { dashboardField: null, dashboardValue: null });
  return items;
}
