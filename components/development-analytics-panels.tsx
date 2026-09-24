"use client";

import React, { useEffect, useRef, useState } from "react";
import { DevelopmentCompletionChart, DevelopmentHoursByCategoryChart, DevelopmentStatusChart } from "@/components/development-analytics";
import { developmentFiltersToQuery, type DevelopmentAnalytics, type DevelopmentFilters, type DevelopmentYearOptions } from "@/lib/reporting/development";

async function fetchDevelopmentAnalytics(filters: DevelopmentFilters, signal: AbortSignal): Promise<DevelopmentAnalytics> {
  const response = await fetch(`/api/development/analytics?${developmentFiltersToQuery(filters)}`, { signal });
  if (!response.ok) throw new Error("Unable to load development analytics.");
  return response.json();
}

function useDevelopmentAnalyticsPanel(initialFilters: DevelopmentFilters, initialData: DevelopmentAnalytics) {
  const [filters, setFilters] = useState(initialFilters);
  const [data, setData] = useState(initialData);
  const [updating, setUpdating] = useState(false);
  const didMountRef = useRef(false);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!didMountRef.current) { didMountRef.current = true; return; }
    const requestId = ++requestRef.current;
    const controller = new AbortController();
    setUpdating(true);
    fetchDevelopmentAnalytics(filters, controller.signal)
      .then((next) => { if (requestRef.current === requestId) setData(next); })
      .catch((error) => { if (error instanceof Error && error.name !== "AbortError") console.error("development_analytics_fetch_failed", error); })
      .finally(() => { if (requestRef.current === requestId) setUpdating(false); });
    return () => controller.abort();
  }, [filters]);

  return { filters, setFilters, data, updating };
}

function DevelopmentYearSelect({ filters, years, onChange }: { filters: DevelopmentFilters; years: DevelopmentYearOptions; onChange: (next: DevelopmentFilters) => void }) {
  const value = filters.reportingYearMode === "missing" ? "missing" : `year:${filters.reportingYear}`;
  return <label className="development-panel-year-filter">Reporting Year
    <select value={value} onChange={(event) => {
      const selection = event.target.value;
      onChange({ ...filters, reportingYearMode: selection === "missing" ? "missing" : "year", reportingYear: selection.startsWith("year:") ? Number(selection.slice(5)) : filters.reportingYear });
    }}>
      <option value="" disabled>Select year</option>
      {years.years.map((year) => <option key={year.year} value={`year:${year.year}`}>{year.label}</option>)}
      {years.missingProjects > 0 && <option value="missing">Missing/Unresolved</option>}
    </select>
  </label>;
}

type PanelProps = { initialFilters: DevelopmentFilters; initialData: DevelopmentAnalytics; years: DevelopmentYearOptions; projectFilters: DevelopmentFilters; projectForeign: URLSearchParams };

export function DevelopmentCompletionPanel({ initialFilters, initialData, years, projectFilters, projectForeign }: PanelProps) {
  const { filters, setFilters, data, updating } = useDevelopmentAnalyticsPanel(initialFilters, initialData);
  return <section className="card development-overview" aria-labelledby="development-overview-title">
    <DevelopmentYearSelect filters={filters} years={years} onChange={setFilters} />
    <div className={`insights-chart-transition${updating ? " is-updating" : ""}`}>
      <DevelopmentCompletionChart metrics={data.metrics} projectFilters={projectFilters} projectForeign={projectForeign} />
    </div>
  </section>;
}

export function DevelopmentStatusPanel({ initialFilters, initialData, years, projectFilters, projectForeign }: PanelProps) {
  const { filters, setFilters, data, updating } = useDevelopmentAnalyticsPanel(initialFilters, initialData);
  return <article className="card development-analysis-card">
    <DevelopmentYearSelect filters={filters} years={years} onChange={setFilters} />
    <div className={`insights-chart-transition${updating ? " is-updating" : ""}`}>
      <DevelopmentStatusChart activeStatuses={data.activeStatuses} projectFilters={projectFilters} projectForeign={projectForeign} />
    </div>
  </article>;
}

export function DevelopmentHoursByCategoryPanel({ initialFilters, initialData, years, projectFilters, projectForeign }: PanelProps) {
  const { filters, setFilters, data, updating } = useDevelopmentAnalyticsPanel(initialFilters, initialData);
  return <article className="card development-analysis-card">
    <DevelopmentYearSelect filters={filters} years={years} onChange={setFilters} />
    <div className={`insights-chart-transition${updating ? " is-updating" : ""}`}>
      <DevelopmentHoursByCategoryChart hoursByCategory={data.hoursByCategory} projectFilters={projectFilters} projectForeign={projectForeign} />
    </div>
  </article>;
}
