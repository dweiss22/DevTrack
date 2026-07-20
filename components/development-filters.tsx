import React from "react";
import type { DevelopmentFilters, DevelopmentOptions, DevelopmentYearOptions } from "@/lib/reporting/development";

const DEVELOPMENT_FIELD_PATTERN = /(instructional designer|course owner|subject.?matter|\bsme\b|authoring tool|course type|product type)/i;

export function developmentCustomFields(options: DevelopmentOptions) {
  return options.customFields.filter((field) => DEVELOPMENT_FIELD_PATTERN.test(field.name));
}

export function developmentContactKeys(options: DevelopmentOptions) {
  return new Set(developmentCustomFields(options)
    .filter((field) => /(designer|owner|subject.?matter|\bsme\b)/i.test(field.name))
    .map((field) => field.name.toLocaleLowerCase()));
}

export function DevelopmentFiltersForm({ filters, years }: { filters: DevelopmentFilters; years: DevelopmentYearOptions; options: DevelopmentOptions }) {
  return <form className="card dashboard-year-filter" method="get" aria-label="Development Reporting Year filter">
    <label>Reporting Year<select name="reportingSelection" defaultValue={filters.reportingYearMode === "missing" ? "missing" : `year:${filters.reportingYear}`}>
      <option value="" disabled>Select year</option>
      {years.years.map((year) => <option key={year.year} value={`year:${year.year}`}>{year.label}</option>)}
      {years.missingProjects > 0 && <option value="missing">Missing/Unresolved</option>}
    </select></label>
    <button type="submit">Apply</button>
    <a className="button secondary" href="/development">Clear</a>
  </form>;
}
