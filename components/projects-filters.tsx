import React from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";
import { FilterDisclosure } from "@/components/filter-disclosure";
import { ProjectsMultiSelect } from "@/components/projects-multi-select";
import { VerticalMultiSelect, type VerticalMultiSelectOption } from "@/components/vertical-multi-select";
import { filtersToQuery, type ReportingFilters } from "@/lib/reporting/filters";
import type { AccessibleProjectFacets, CustomFieldFilterOption, StatusFilterOption } from "@/lib/reporting/options";
import {
  clearProjectFiltersHref,
  projectFilterFields,
  projectFilterHref,
  projectFilterValues,
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
  const selectedYears = filters.reportingYears?.map(String) ?? (filters.reportingYear == null ? [] : [String(filters.reportingYear)]);
  const selectedStatuses = filters.statuses ?? [];
  const ownerOptions = projectPersonOptions(fields.owner, people);
  const smeOptions = projectPersonOptions(fields.sme, people);
  const verticalOptions = [...APPROVED_VERTICALS];
  const legacySelectedVertical = filters.associatedVertical ? `associated:${filters.associatedVertical}`
      : filters.verticalReportingCategory ? `category:${filters.verticalReportingCategory}`
      : filters.verticalState ? `state:${filters.verticalState}`
        : filters.unresolvedVerticalOnly ? "legacy:unresolved" : "";
  const selectedVerticals = filters.verticalSelections?.length ? filters.verticalSelections : legacySelectedVertical ? [legacySelectedVertical] : [];
  const verticalMultiOptions: VerticalMultiSelectOption[] = [
    ...verticalOptions.map((value) => ({ value: `associated:${value}`, label: value })),
    { value: "state:cross_vertical", label: "Cross-Vertical" },
    { value: "state:missing", label: "Vertical not assigned" },
    { value: "state:unrecognized", label: "Vertical value needs review" },
    { value: "state:synchronization_incomplete", label: "Vertical data not fully synchronized" }
  ];
  for (const selected of selectedVerticals) if (!verticalMultiOptions.some((option) => option.value === selected)) verticalMultiOptions.push({ value: selected, label: verticalSelectionLabel(selected) });
  const advancedCount = selectedVerticals.length + projectFilterValues(fields.courseType ? filters.customFields?.[fields.courseType.id] : undefined).length + projectFilterValues(fields.sme ? filters.customFields?.[fields.sme.id] : undefined).length + projectFilterValues(fields.courseLength ? filters.customFields?.[fields.courseLength.id] : undefined).length;
  const visibleNames = new Set(["q", "statuses", "reportingYear", "reportingYears", "associatedVertical", "verticalReportingCategory", "verticalState", "unresolvedVerticalOnly", "verticalSelection", "verticalSelections"]);
  for (const field of [fields.owner, fields.tool, fields.courseType, fields.sme, fields.courseLength]) if (field) visibleNames.add(`cf_${field.id}`);
  const preserved = [...new URLSearchParams(filtersToQuery({ ...filters, page: 1 })).entries()].filter(([name]) => !visibleNames.has(name) && name !== "page");
  const active = activeProjectFilters(filters, fields, people, statuses, selectedVerticals, returnTo);

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
        <ProjectsMultiSelect label="Year" name="reportingYears" options={years.map((year) => ({ value: String(year), label: String(year) }))} selected={selectedYears} allLabel="All years" emptyLabel="No synchronized years are available." disabled={!years.length && !selectedYears.length} />
        <ProjectsMultiSelect label="Status" name="statuses" options={withMissingSelections(statuses.map((status) => ({ value: status.id, label: status.name })), selectedStatuses, (value) => `Unresolved status ${value}`)} selected={selectedStatuses} allLabel="All statuses" emptyLabel="No synchronized statuses are available." disabled={!statuses.length && !selectedStatuses.length} />
        <ProjectsMultiSelect label="Designer" name={fields.owner ? `cf_${fields.owner.id}` : "ownerUnavailable"} options={ownerOptions} selected={projectFilterValues(fields.owner ? filters.customFields?.[fields.owner.id] : undefined)} allLabel="All designers" emptyLabel="No synchronized Designer field is available." disabled={!fields.owner} />
        <ProjectsMultiSelect label="Tool" name={fields.tool ? `cf_${fields.tool.id}` : "toolUnavailable"} options={(fields.tool?.values ?? []).map(valueOption)} selected={projectFilterValues(fields.tool ? filters.customFields?.[fields.tool.id] : undefined)} allLabel="All tools" emptyLabel="No synchronized Tool field is available." disabled={!fields.tool} />
      </div>
      <FilterDisclosure count={advancedCount} initiallyOpen={advancedCount > 0}>
        <div className="projects-advanced-grid">
          <ProjectsMultiSelect label="Course Type" name={fields.courseType ? `cf_${fields.courseType.id}` : "courseTypeUnavailable"} options={(fields.courseType?.values ?? []).map(valueOption)} selected={projectFilterValues(fields.courseType ? filters.customFields?.[fields.courseType.id] : undefined)} allLabel="All course types" emptyLabel="No synchronized Course Type field is available." disabled={!fields.courseType} />
          <VerticalMultiSelect options={verticalMultiOptions} selected={selectedVerticals} disabled={!fields.vertical && !selectedVerticals.length && !facets.verticalStates.size} />
          <ProjectsMultiSelect label="SME" name={fields.sme ? `cf_${fields.sme.id}` : "smeUnavailable"} options={smeOptions} selected={projectFilterValues(fields.sme ? filters.customFields?.[fields.sme.id] : undefined)} allLabel="All SMEs" emptyLabel="No synchronized SME field is available." disabled={!fields.sme} />
          <ProjectsMultiSelect label="Course Length" name={fields.courseLength ? `cf_${fields.courseLength.id}` : "courseLengthUnavailable"} options={(fields.courseLength?.values ?? []).map(valueOption)} selected={projectFilterValues(fields.courseLength ? filters.customFields?.[fields.courseLength.id] : undefined)} allLabel="All course lengths" emptyLabel="No synchronized Course Length field is available." disabled={!fields.courseLength} />
        </div>
      </FilterDisclosure>
    </form>
    {active.length > 0 && <div className="projects-active-filters" aria-label="Active project filters">
      <span>Active:</span>{active.map((item) => <Link href={item.href} key={item.key}>{item.label}<X aria-hidden="true" size={13} /><span className="sr-only">Clear {item.label}</span></Link>)}
      <Link className="projects-clear-all" href={clearProjectFiltersHref(filters, returnTo)}>Clear All</Link>
    </div>}
  </section>;
}

function activeProjectFilters(filters: ReportingFilters, fields: ReturnType<typeof projectFilterFields>, people: ProjectPersonOption[], statuses: StatusFilterOption[], selectedVerticals: readonly string[], returnTo?: string) {
  const items: { key: string; label: string; href: string }[] = [];
  const add = (key: string, label: string, changes: Record<string, string | readonly string[] | null>) => items.push({ key, label, href: projectFilterHref(filters, changes, returnTo) });
  if (filters.q) add("q", `Search: ${filters.q}`, { q: null });
  const selectedYears = filters.reportingYears ?? (filters.reportingYear == null ? [] : [filters.reportingYear]);
  for (const year of selectedYears) add(`year-${year}`, `Year: ${year}`, { reportingYears: selectedYears.filter((value) => value !== year).map(String), reportingYear: null });
  for (const statusId of filters.statuses ?? []) add(`status-${statusId}`, `Status: ${statuses.find((status) => status.id === statusId)?.name ?? statusId}`, { statuses: (filters.statuses ?? []).filter((value) => value !== statusId) });
  for (const [key, field, prefix, contact] of [
    ["owner", fields.owner, "Designer", true], ["tool", fields.tool, "Tool", false], ["course-type", fields.courseType, "Course Type", false], ["sme", fields.sme, "SME", true], ["course-length", fields.courseLength, "Course Length", false]
  ] as const) {
    const values = projectFilterValues(field ? filters.customFields?.[field.id] : undefined);
    for (const value of values) if (field) add(`${key}-${value}`, `${prefix}: ${contact ? projectPersonLabel(value, people) : value}`, { [`cf_${field.id}`]: values.filter((item) => item !== value) });
  }
  for (const selected of selectedVerticals) {
    const remaining = selectedVerticals.filter((value) => value !== selected);
    const changes = filters.verticalSelections?.length
      ? { verticalSelections: remaining.length ? remaining : null }
      : { associatedVertical: null, verticalReportingCategory: null, verticalState: null, unresolvedVerticalOnly: null };
    items.push({ key: `vertical-${selected}`, label: `Vertical: ${verticalSelectionLabel(selected)}`, href: projectFilterHref(filters, changes, returnTo) });
  }
  if (filters.dashboardClassification) add("classification", `Dashboard: ${filters.dashboardClassification.replaceAll("_", " ")}`, { dashboardClassification: null });
  if (filters.dashboardField && filters.dashboardValue) add("dashboard-category", `${filters.dashboardField}: ${filters.dashboardValue}`, { dashboardField: null, dashboardValue: null });
  return items;
}

const valueOption = (value: string) => ({ value, label: value });

function withMissingSelections(options: { value: string; label: string }[], selected: readonly string[], missingLabel: (value: string) => string) {
  return [...options, ...selected.filter((value) => !options.some((option) => option.value === value)).map((value) => ({ value, label: missingLabel(value) }))];
}

function verticalSelectionLabel(value: string) {
  if (value.startsWith("associated:")) return value.slice("associated:".length);
  if (value.startsWith("category:")) return value.slice("category:".length).replace("Cross Vertical", "Cross-Vertical");
  if (value.startsWith("state:")) return verticalStateLabel(value.slice("state:".length) as Parameters<typeof verticalStateLabel>[0]);
  return "Any Vertical issue";
}
