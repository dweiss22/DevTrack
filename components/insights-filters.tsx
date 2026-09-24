import React from "react";
import Link from "next/link";
import { ProjectsMultiSelect } from "@/components/projects-multi-select";
import { FilterDisclosure } from "@/components/filter-disclosure";
import type { AccessibleProjectFacets, CustomFieldFilterOption, StatusFilterOption } from "@/lib/reporting/options";
import { clearInsightsFiltersHref, insightsFilterHref } from "@/lib/reporting/insights";
import { projectFilterFields, projectFilterValues, projectPersonLabel, projectPersonOptions, reportingYearOptions, type ProjectPersonOption } from "@/lib/reporting/projects";
import { APPROVED_VERTICALS, verticalStateLabel } from "@/lib/wrike/vertical-normalization";
import type { ReportingFilters } from "@/lib/reporting/filters";

type Props = {
  title: string;
  prefix: string;
  pathname: string;
  foreignParams: URLSearchParams;
  filters: ReportingFilters;
  statuses: StatusFilterOption[];
  customFields: CustomFieldFilterOption[];
  people: ProjectPersonOption[];
  facets: AccessibleProjectFacets;
};

export function InsightsFilters({ title, prefix, pathname, foreignParams, filters, statuses, customFields, people, facets }: Props) {
  const fields = projectFilterFields(customFields);
  const years = reportingYearOptions(fields.reporting);
  const selectedYears = filters.reportingYears?.map(String) ?? (filters.reportingYear == null ? [] : [String(filters.reportingYear)]);
  const selectedStatuses = filters.statuses ?? [];
  const ownerOptions = projectPersonOptions(fields.owner, people);
  const selectedCourseTypes = projectFilterValues(fields.courseType ? filters.customFields?.[fields.courseType.id] : undefined);
  const selectedCourseStyles = projectFilterValues(fields.courseStyle ? filters.customFields?.[fields.courseStyle.id] : undefined);
  const selectedCourseLengths = projectFilterValues(fields.courseLength ? filters.customFields?.[fields.courseLength.id] : undefined);
  const selectedTools = projectFilterValues(fields.tool ? filters.customFields?.[fields.tool.id] : undefined);
  const verticalOptions: { value: string; label: string }[] = [
    ...APPROVED_VERTICALS.map((value) => ({ value: `associated:${value}`, label: value })),
    { value: "state:cross_vertical", label: "Cross-Vertical" },
    { value: "state:missing", label: "Vertical not assigned" },
    { value: "state:unrecognized", label: "Vertical value needs review" },
    { value: "state:synchronization_incomplete", label: "Vertical data not fully synchronized" }
  ];
  const selectedVerticals = filters.verticalSelections ?? [];
  for (const selected of selectedVerticals) if (!verticalOptions.some((option) => option.value === selected)) verticalOptions.push({ value: selected, label: verticalSelectionLabel(selected) });
  const advancedCount = selectedVerticals.length + selectedCourseTypes.length + selectedCourseStyles.length + selectedCourseLengths.length;
  const active = activeInsightsFilters(pathname, foreignParams, prefix, filters, fields, people, statuses, selectedVerticals);

  return <section className="card projects-filter-card insights-filter-card" aria-labelledby={`${prefix}insights-filter-heading`}>
    <h3 id={`${prefix}insights-filter-heading`}>{title}</h3>
    <form method="get" className="projects-filter-form">
      {[...foreignParams.entries()].map(([name, value], index) => <input type="hidden" name={name} value={value} key={`${name}-${value}-${index}`} />)}
      <div className="projects-primary-filters">
        <ProjectsMultiSelect label="Year" name={`${prefix}reportingYears`} options={years.map((year) => ({ value: String(year), label: String(year) }))} selected={selectedYears} allLabel="All years" emptyLabel="No synchronized years are available." disabled={!years.length && !selectedYears.length} />
        <ProjectsMultiSelect label="Status" name={`${prefix}statuses`} options={statuses.map((status) => ({ value: status.id, label: status.name }))} selected={selectedStatuses} allLabel="All statuses" emptyLabel="No synchronized statuses are available." disabled={!statuses.length && !selectedStatuses.length} />
        <ProjectsMultiSelect label="Designer" name={fields.owner ? `${prefix}cf_${fields.owner.id}` : `${prefix}ownerUnavailable`} options={ownerOptions} selected={projectFilterValues(fields.owner ? filters.customFields?.[fields.owner.id] : undefined)} allLabel="All designers" emptyLabel="No synchronized Designer field is available." disabled={!fields.owner} />
        <ProjectsMultiSelect label="Tools" name={fields.tool ? `${prefix}cf_${fields.tool.id}` : `${prefix}toolUnavailable`} options={(fields.tool?.values ?? []).map(valueOption)} selected={selectedTools} allLabel="All tools" emptyLabel="No synchronized Tool field is available." disabled={!fields.tool} />
      </div>
      <FilterDisclosure count={advancedCount} initiallyOpen={advancedCount > 0}>
        <div className="projects-advanced-grid">
          <ProjectsMultiSelect label="Course Type" name={fields.courseType ? `${prefix}cf_${fields.courseType.id}` : `${prefix}courseTypeUnavailable`} options={(fields.courseType?.values ?? []).map(valueOption)} selected={selectedCourseTypes} allLabel="All course types" emptyLabel="No Course Type values are present on accessible synchronized tasks." disabled={!fields.courseType} />
          <ProjectsMultiSelect label="Course Style" name={fields.courseStyle ? `${prefix}cf_${fields.courseStyle.id}` : `${prefix}courseStyleUnavailable`} options={(fields.courseStyle?.values ?? []).filter(isCourseStyle).map(valueOption)} selected={selectedCourseStyles} allLabel="All course styles" emptyLabel="No Full Length or Single Video values are present on accessible synchronized tasks." disabled={!fields.courseStyle} />
          <ProjectsMultiSelect label="Vertical" name={`${prefix}verticalSelections`} options={verticalOptions} selected={selectedVerticals} allLabel="All Verticals" emptyLabel="No synchronized Vertical choices are available." disabled={!fields.vertical && !selectedVerticals.length && !facets.verticalStates.size} />
          <ProjectsMultiSelect label="Course Length" name={fields.courseLength ? `${prefix}cf_${fields.courseLength.id}` : `${prefix}courseLengthUnavailable`} options={(fields.courseLength?.values ?? []).map(valueOption)} selected={selectedCourseLengths} allLabel="All course lengths" emptyLabel="No synchronized Course Length field is available." disabled={!fields.courseLength} />
        </div>
      </FilterDisclosure>
      <button type="submit">Apply filters</button>
    </form>
    {active.length > 0 && <div className="projects-active-filters" aria-label={`Active ${title} filters`}>
      <span>Active:</span>{active.map((item) => <Link href={item.href} key={item.key}>{item.label}<span aria-hidden="true"> ×</span><span className="sr-only">Clear {item.label}</span></Link>)}
      <Link className="projects-clear-all" href={clearInsightsFiltersHref(pathname, foreignParams)}>Clear All</Link>
    </div>}
  </section>;
}

function activeInsightsFilters(pathname: string, foreignParams: URLSearchParams, prefix: string, filters: ReportingFilters, fields: ReturnType<typeof projectFilterFields>, people: ProjectPersonOption[], statuses: StatusFilterOption[], selectedVerticals: readonly string[]) {
  const items: { key: string; label: string; href: string }[] = [];
  const add = (key: string, label: string, changes: Record<string, string | readonly string[] | null>) => items.push({ key, label, href: insightsFilterHref(pathname, foreignParams, prefix, filters, changes) });
  const selectedYears = filters.reportingYears ?? (filters.reportingYear == null ? [] : [filters.reportingYear]);
  for (const year of selectedYears) add(`year-${year}`, `Year: ${year}`, { reportingYears: selectedYears.filter((value) => value !== year).map(String), reportingYear: null });
  for (const statusId of filters.statuses ?? []) add(`status-${statusId}`, `Status: ${statuses.find((status) => status.id === statusId)?.name ?? statusId}`, { statuses: (filters.statuses ?? []).filter((value) => value !== statusId) });
  for (const [key, field, prefixLabel, contact] of [
    ["owner", fields.owner, "Designer", true], ["tool", fields.tool, "Tools", false], ["course-type", fields.courseType, "Course Type", false], ["course-style", fields.courseStyle, "Course Style", false], ["course-length", fields.courseLength, "Course Length", false]
  ] as const) {
    const values = projectFilterValues(field ? filters.customFields?.[field.id] : undefined);
    for (const value of values) if (field) add(`${key}-${value}`, `${prefixLabel}: ${contact ? projectPersonLabel(value, people) : value}`, { [`cf_${field.id}`]: values.filter((item) => item !== value) });
  }
  for (const selected of selectedVerticals) add(`vertical-${selected}`, `Vertical: ${verticalSelectionLabel(selected)}`, { verticalSelections: selectedVerticals.filter((value) => value !== selected) });
  return items;
}

const valueOption = (value: string) => ({ value, label: value });
const isCourseStyle = (value: string) => ["full length", "single video"].includes(value.trim().toLocaleLowerCase());

function verticalSelectionLabel(value: string) {
  if (value.startsWith("associated:")) return value.slice("associated:".length);
  if (value.startsWith("category:")) return value.slice("category:".length).replace("Cross Vertical", "Cross-Vertical");
  if (value.startsWith("state:")) return verticalStateLabel(value.slice("state:".length) as Parameters<typeof verticalStateLabel>[0]);
  return "Any Vertical issue";
}
