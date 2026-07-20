import React from "react";
import type { DashboardYearOption } from "@/lib/reporting/dashboard";

export function DashboardYearFilter({ options, selectedYear }: { options: DashboardYearOption[]; selectedYear: number }) {
  return <form className="card dashboard-year-filter" method="get" aria-label="Dashboard Reporting Year filter">
    <label>Reporting Year<select name="reportingYear" defaultValue={String(selectedYear)}>{options.map((option) => <option key={option.year} value={option.year}>{option.label}</option>)}</select></label>
    <button type="submit">Apply</button>
    <a className="button secondary" href="/">Clear</a>
  </form>;
}
