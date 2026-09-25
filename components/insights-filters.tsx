"use client";

import React, { useId, type FormEvent } from "react";
import { ProjectsMultiSelect } from "@/components/projects-multi-select";
import { FilterDisclosure } from "@/components/filter-disclosure";
import type { AccessibleProjectFacets, CustomFieldFilterOption, StatusFilterOption } from "@/lib/reporting/options";
import { parseReportingFilters, type ReportingFilters } from "@/lib/reporting/filters";
import { verticalSelectionLabel } from "@/lib/reporting/insights";
import { projectFilterFields, projectFilterValues, projectPersonLabel, projectPersonOptions, reportingYearOptions, type ProjectFilterFields, type ProjectPersonOption } from "@/lib/reporting/projects";
import { APPROVED_VERTICALS } from "@/lib/wrike/vertical-normalization";

type Props = {
  title: string;
  filters: ReportingFilters;
  statuses: StatusFilterOption[];
  customFields: CustomFieldFilterOption[];
  people: ProjectPersonOption[];
  facets: AccessibleProjectFacets;
  onFiltersChange: (filters: ReportingFilters) => void;
};

export function InsightsFilters({ title, filters, statuses, customFields, people, facets, onFiltersChange }: Props) {
  const headingId = useId();
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
  const active = activeInsightsFilters(filters, fields, people, statuses, selectedVerticals);
  const facetsAvailable = !fields.vertical && !selectedVerticals.length && !facets.verticalStates.size;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const raw: Record<string, string[]> = {};
    for (const [key, value] of new FormData(event.currentTarget).entries()) {
      if (typeof value !== "string") continue;
      (raw[key] ??= []).push(value);
    }
    onFiltersChange(parseReportingFilters(raw));
  };

  const clearAll = () => {
    const target: Record<string, unknown> = { ...filters, customFields: { ...(filters.customFields ?? {}) } };
    delete target.reportingYears; delete target.reportingYear; delete target.statuses; delete target.verticalSelections;
    delete target.associatedVertical; delete target.verticalReportingCategory; delete target.verticalState; delete target.unresolvedVerticalOnly;
    for (const field of [fields.owner, fields.tool, fields.courseType, fields.courseStyle, fields.courseLength]) if (field) delete (target.customFields as Record<string, unknown>)[field.id];
    if (!Object.keys(target.customFields as Record<string, string>).length) delete target.customFields;
    onFiltersChange(target as ReportingFilters);
  };

  return <section className="insights-filter-group" aria-labelledby={headingId}>
    <h3 id={headingId}>{title}</h3>
    <form className="projects-filter-form" onSubmit={handleSubmit} key={JSON.stringify(filters)}>
      <div className="projects-primary-filters">
        <ProjectsMultiSelect label="Year" name="reportingYears" options={years.map((year) => ({ value: String(year), label: String(year) }))} selected={selectedYears} allLabel="All years" emptyLabel="No synchronized years are available." disabled={!years.length && !selectedYears.length} />
        <ProjectsMultiSelect label="Status" name="statuses" options={statuses.map((status) => ({ value: status.id, label: status.name }))} selected={selectedStatuses} allLabel="All statuses" emptyLabel="No synchronized statuses are available." disabled={!statuses.length && !selectedStatuses.length} />
        <ProjectsMultiSelect label="Designer" name={fields.owner ? `cf_${fields.owner.id}` : "ownerUnavailable"} options={ownerOptions} selected={projectFilterValues(fields.owner ? filters.customFields?.[fields.owner.id] : undefined)} allLabel="All designers" emptyLabel="No synchronized Designer field is available." disabled={!fields.owner} />
        <ProjectsMultiSelect label="Tools" name={fields.tool ? `cf_${fields.tool.id}` : "toolUnavailable"} options={(fields.tool?.values ?? []).map(valueOption)} selected={selectedTools} allLabel="All tools" emptyLabel="No synchronized Tool field is available." disabled={!fields.tool} />
      </div>
      <FilterDisclosure count={advancedCount} initiallyOpen={advancedCount > 0}>
        <div className="projects-advanced-grid">
          <ProjectsMultiSelect label="Course Type" name={fields.courseType ? `cf_${fields.courseType.id}` : "courseTypeUnavailable"} options={(fields.courseType?.values ?? []).map(valueOption)} selected={selectedCourseTypes} allLabel="All course types" emptyLabel="No Course Type values are present on accessible synchronized tasks." disabled={!fields.courseType} />
          <ProjectsMultiSelect label="Course Style" name={fields.courseStyle ? `cf_${fields.courseStyle.id}` : "courseStyleUnavailable"} options={(fields.courseStyle?.values ?? []).filter(isCourseStyle).map(valueOption)} selected={selectedCourseStyles} allLabel="All course styles" emptyLabel="No Full Length or Single Video values are present on accessible synchronized tasks." disabled={!fields.courseStyle} />
          <ProjectsMultiSelect label="Vertical" name="verticalSelections" options={verticalOptions} selected={selectedVerticals} allLabel="All Verticals" emptyLabel="No synchronized Vertical choices are available." disabled={facetsAvailable} />
          <ProjectsMultiSelect label="Course Length" name={fields.courseLength ? `cf_${fields.courseLength.id}` : "courseLengthUnavailable"} options={(fields.courseLength?.values ?? []).map(valueOption)} selected={selectedCourseLengths} allLabel="All course lengths" emptyLabel="No synchronized Course Length field is available." disabled={!fields.courseLength} />
        </div>
      </FilterDisclosure>
      <button type="submit">Apply filters</button>
    </form>
    {active.length > 0 && <div className="projects-active-filters" aria-label={`Active ${title} filters`}>
      <span>Active:</span>{active.map((item) => <button type="button" onClick={() => onFiltersChange(item.next)} key={item.key}>{item.label}<span aria-hidden="true"> ×</span><span className="sr-only">Clear {item.label}</span></button>)}
      <button type="button" className="projects-clear-all" onClick={clearAll}>Clear All</button>
    </div>}
  </section>;
}

function activeInsightsFilters(filters: ReportingFilters, fields: ProjectFilterFields, people: ProjectPersonOption[], statuses: StatusFilterOption[], selectedVerticals: readonly string[]) {
  const items: { key: string; label: string; next: ReportingFilters }[] = [];
  const add = (key: string, label: string, changes: Record<string, string | readonly string[] | null | undefined>) => items.push({ key, label, next: applyFilterChanges(filters, changes) });
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

function applyFilterChanges(filters: ReportingFilters, changes: Record<string, string | readonly string[] | null | undefined>): ReportingFilters {
  const target: Record<string, unknown> = { ...filters, customFields: { ...(filters.customFields ?? {}) } };
  for (const [key, value] of Object.entries(changes)) {
    if (key.startsWith("cf_")) {
      const id = key.slice(3);
      const custom = target.customFields as Record<string, string | readonly string[]>;
      if (value == null || value === "") delete custom[id];
      else custom[id] = Array.isArray(value) ? value : String(value);
      continue;
    }
    if (value == null || value === "") delete target[key];
    else target[key] = value;
  }
  if (!Object.keys(target.customFields as Record<string, string>).length) delete target.customFields;
  return target as ReportingFilters;
}

const valueOption = (value: string) => ({ value, label: value });
const isCourseStyle = (value: string) => ["full length", "single video"].includes(value.trim().toLocaleLowerCase());
