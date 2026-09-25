"use client";

import React, { useEffect, useRef, useState } from "react";
import { InsightsFilters } from "@/components/insights-filters";
import { InsightsCumulativeChart } from "@/components/insights-cumulative-chart";
import { InsightsComparisonChart } from "@/components/insights-comparison-chart";
import { filtersToQuery, type ReportingFilters } from "@/lib/reporting/filters";
import { activeReportingFilterLabels, summarizeReportingFilters, type HoursTimeseries } from "@/lib/reporting/insights";
import { projectFilterFields } from "@/lib/reporting/projects";
import type { AccessibleProjectFacets, CustomFieldFilterOption, StatusFilterOption } from "@/lib/reporting/options";
import type { ProjectPersonOption } from "@/lib/reporting/projects";

type SharedOptions = {
  statuses: StatusFilterOption[];
  customFields: CustomFieldFilterOption[];
  people: ProjectPersonOption[];
  facets: AccessibleProjectFacets;
};

async function fetchHoursTimeseries(filters: ReportingFilters, signal: AbortSignal): Promise<HoursTimeseries> {
  const response = await fetch(`/api/development/insights?${filtersToQuery(filters)}`, { signal });
  if (!response.ok) throw new Error("Unable to load hours time series.");
  return response.json();
}

export function InsightsCumulativePanel({ initialFilters, initialData, options }: { initialFilters: ReportingFilters; initialData: HoursTimeseries; options: SharedOptions }) {
  const [filters, setFilters] = useState(initialFilters);
  const [data, setData] = useState(initialData);
  const [updating, setUpdating] = useState(false);
  const initialFiltersRef = useRef(initialFilters);
  const requestRef = useRef(0);

  useEffect(() => {
    if (filters === initialFiltersRef.current) return;
    const requestId = ++requestRef.current;
    const controller = new AbortController();
    setUpdating(true);
    fetchHoursTimeseries(filters, controller.signal)
      .then((next) => { if (requestRef.current === requestId) setData(next); })
      .catch((error) => { if (error instanceof Error && error.name !== "AbortError") console.error("insights_cumulative_fetch_failed", error); })
      .finally(() => { if (requestRef.current === requestId) setUpdating(false); });
    return () => controller.abort();
  }, [filters]);

  const fields = projectFilterFields(options.customFields);
  const filterLabels = activeReportingFilterLabels(filters, { fields, statuses: options.statuses, people: options.people });

  return <section className="card insights-panel" aria-labelledby="cumulative-hours-title">
    <p className="eyebrow">DEVELOPMENT ANALYTICS</p>
    <InsightsFilters title="Filters" filters={filters} statuses={options.statuses} customFields={options.customFields} people={options.people} facets={options.facets} onFiltersChange={setFilters} />
    <div className={`insights-chart-transition${updating ? " is-updating" : ""}`}><InsightsCumulativeChart data={data} filterLabels={filterLabels} /></div>
  </section>;
}

export function InsightsComparisonPanel({ initialFiltersA, initialFiltersB, initialDataA, initialDataB, options }: {
  initialFiltersA: ReportingFilters;
  initialFiltersB: ReportingFilters;
  initialDataA: HoursTimeseries;
  initialDataB: HoursTimeseries;
  options: SharedOptions;
}) {
  const [filtersA, setFiltersA] = useState(initialFiltersA);
  const [filtersB, setFiltersB] = useState(initialFiltersB);
  const [dataA, setDataA] = useState(initialDataA);
  const [dataB, setDataB] = useState(initialDataB);
  const [updating, setUpdating] = useState(false);
  const initialFiltersARef = useRef(initialFiltersA);
  const initialFiltersBRef = useRef(initialFiltersB);
  const requestRef = useRef(0);
  const fields = projectFilterFields(options.customFields);

  useEffect(() => {
    if (filtersA === initialFiltersARef.current && filtersB === initialFiltersBRef.current) return;
    const requestId = ++requestRef.current;
    const controller = new AbortController();
    setUpdating(true);
    Promise.all([fetchHoursTimeseries(filtersA, controller.signal), fetchHoursTimeseries(filtersB, controller.signal)])
      .then(([nextA, nextB]) => { if (requestRef.current === requestId) { setDataA(nextA); setDataB(nextB); } })
      .catch((error) => { if (error instanceof Error && error.name !== "AbortError") console.error("insights_comparison_fetch_failed", error); })
      .finally(() => { if (requestRef.current === requestId) setUpdating(false); });
    return () => controller.abort();
  }, [filtersA, filtersB]);

  const titleA = summarizeReportingFilters(filtersA, { fields, statuses: options.statuses, people: options.people });
  const titleB = summarizeReportingFilters(filtersB, { fields, statuses: options.statuses, people: options.people });
  const filterLabelsA = activeReportingFilterLabels(filtersA, { fields, statuses: options.statuses, people: options.people });
  const filterLabelsB = activeReportingFilterLabels(filtersB, { fields, statuses: options.statuses, people: options.people });
  const swap = () => { setFiltersA(filtersB); setFiltersB(filtersA); };

  return <section className="card insights-panel" aria-labelledby="comparison-chart-title">
    <p className="eyebrow">DEVELOPMENT ANALYTICS</p>
    <div className="insights-compare-grid">
      <InsightsFilters title={`Metric A · ${titleA}`} filters={filtersA} statuses={options.statuses} customFields={options.customFields} people={options.people} facets={options.facets} onFiltersChange={setFiltersA} />
      <InsightsFilters title={`Metric B · ${titleB}`} filters={filtersB} statuses={options.statuses} customFields={options.customFields} people={options.people} facets={options.facets} onFiltersChange={setFiltersB} />
    </div>
    <div className={`insights-chart-transition${updating ? " is-updating" : ""}`}><InsightsComparisonChart metricA={dataA} metricB={dataB} metricATitle={titleA} metricBTitle={titleB} filterLabelsA={filterLabelsA} filterLabelsB={filterLabelsB} onSwap={swap} /></div>
  </section>;
}
