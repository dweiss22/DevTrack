"use client";

import React, { useId, useState } from "react";
import {
  CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  categoryPeriodForYear,
  type VideoCategoryAverage,
  type VideoCategoryPeriod,
  type VideoDashboardAnalytics,
  type VideoDevelopmentYear,
} from "@/lib/dashboards/video-analytics";
import {
  compactWorkflowCategoryLabel,
  workflowCategoryColor,
} from "@/lib/reporting/workflow-category-colors";

const SELECTED_VIDEO_COLOR = "#145b9e";

export function VideoDashboardAnalyticsSection({
  analytics,
  error,
}: {
  analytics: VideoDashboardAnalytics | null;
  error?: string | null;
}) {
  if (error) return <section className="card dashboard-query-error" role="alert">
    <h2>Videographer analytics unavailable</h2><p>{error} Assigned-project details remain available below.</p>
  </section>;
  if (!analytics) return null;

  return <section className="id-dashboard-analytics" aria-label="Videographer analytics">
    <DevelopmentTimeChart analytics={analytics} />
    <CategoryTimeChart analytics={analytics} />
  </section>;
}

function DevelopmentTimeChart({ analytics }: { analytics: VideoDashboardAnalytics }) {
  const hasData = analytics.timeDataSynchronized
    && analytics.developmentTimeByYear.some((row) => row.averageMinutes != null);
  return <article className="card dashboard-chart id-dashboard-chart" aria-labelledby="video-development-time-title">
    <h2 id="video-development-time-title">Average Development Time by Year</h2>
    <p>The selected videographer&rsquo;s total logged time divided by their distinct completed Single Video projects (including Roll Call Training), by completion year.</p>
    {hasData ? <>
      <div className="id-chart-canvas" role="img" aria-label="Line chart of average development hours per project by year">
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={analytics.developmentTimeByYear} margin={{ top: 12, right: 24, left: 30, bottom: 30 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="year" allowDecimals={false} type="number" domain={["dataMin", "dataMax"]}
              label={{ value: "Completion year", position: "insideBottom", offset: -18 }} />
            <YAxis tickFormatter={(minutes) => `${formatHours(Number(minutes))}h`}
              label={{ value: "Average hours per project", angle: -90, position: "insideLeft", offset: -18 }} />
            <Tooltip content={<DevelopmentTimeTooltip />} />
            <Line type="monotone" dataKey="averageMinutes" name="Average hours per project"
              connectNulls={false} stroke={SELECTED_VIDEO_COLOR} strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <AccessibleData title="Average development time data"
        headers={["Year", "Completed projects", "Average hours per project", "Total hours"]}
        rows={analytics.developmentTimeByYear.map((row) => [
          String(row.year),
          String(row.projectCount),
          row.averageMinutes == null ? "No qualifying projects" : formatHoursOneDecimal(row.averageMinutes),
          row.totalMinutes == null ? "—" : formatHours(row.totalMinutes),
        ])} />
    </> : <p className="chart-empty">{analytics.timeDataSynchronized
      ? "No completed Single Video projects are available for this videographer."
      : "Time data is unavailable until a successful synchronization completes."}</p>}
  </article>;
}

function CategoryTimeChart({ analytics }: { analytics: VideoDashboardAnalytics }) {
  const selectId = useId();
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState<"all" | number>(
    () => analytics.categoryTime.years.some((item) => item.year === currentYear) ? currentYear : "all",
  );
  const period = categoryPeriodForYear(analytics, selectedYear);
  const hasData = analytics.timeDataSynchronized && period.categories.length > 0;
  return <article className="card dashboard-chart id-dashboard-chart" aria-labelledby="video-category-time-title">
    <div className="chart-heading id-chart-heading">
      <div><h2 id="video-category-time-title">Time by Workflow Category</h2>
        <p>The selected videographer&rsquo;s logged hours and share of time in each synchronized workflow category.</p></div>
      <label className="id-chart-year-selector" htmlFor={selectId}>Year
        <select id={selectId} value={selectedYear}
          onChange={(event) => setSelectedYear(event.target.value === "all" ? "all" : Number(event.target.value))}>
          <option value="all">All time</option>
          {analytics.categoryTime.years.map((item) =>
            <option key={item.year} value={item.year ?? ""}>{item.year}</option>)}
        </select>
      </label>
    </div>
    {hasData ? <>
      <div className="id-category-visual">
        <div className="id-chart-canvas" role="img"
          aria-label={`Donut chart of time by workflow category for ${selectedYear === "all" ? "all time" : selectedYear}`}>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={period.categories} dataKey="totalMinutes" nameKey="name"
                innerRadius={62} outerRadius={98} paddingAngle={2}>
                {period.categories.map((item) =>
                  <Cell key={item.name} fill={workflowCategoryColor(item.name)} />)}
              </Pie>
              <Tooltip content={<CategoryTimeTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="id-category-legend" aria-label="Workflow category legend">
          {period.categories.map((category) =>
            <li key={category.name} title={category.name}>
              <i style={{ backgroundColor: workflowCategoryColor(category.name) }} aria-hidden="true" />
              <span>{compactWorkflowCategoryLabel(category.name)}</span>
              <strong>{formatHoursOneDecimal(category.totalMinutes)}h</strong>
            </li>)}
        </ul>
      </div>
      <p className="id-chart-denominator">{period.qualifyingProjectCount} project{period.qualifyingProjectCount === 1 ? "" : "s"} with logged time · {period.entryCount} time entr{period.entryCount === 1 ? "y" : "ies"}</p>
      <AccessibleData title="Workflow category time data"
        headers={["Workflow category", "Hours", "Percentage"]}
        rows={period.categories.map((category) => [
          category.name, formatHoursOneDecimal(category.totalMinutes),
          `${category.percentage.toFixed(1)}%`,
        ])} />
    </> : <p className="chart-empty">{analytics.timeDataSynchronized
      ? `No qualifying time entries are available for ${selectedYear === "all" ? "this videographer" : selectedYear}.`
      : "Time data is unavailable until a successful synchronization completes."}</p>}
  </article>;
}

function DevelopmentTimeTooltip({ active, payload }: {
  active?: boolean;
  payload?: { payload: VideoDevelopmentYear }[];
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return <div className="chart-tooltip" role="status" aria-live="polite">
    <strong>{row.year}</strong>
    <span>Average: {row.averageMinutes == null ? "No qualifying projects" : `${formatHoursOneDecimal(row.averageMinutes)} hours per project`}</span>
    <span>Completed projects: {row.projectCount}</span>
  </div>;
}

function CategoryTimeTooltip({ active, payload }: {
  active?: boolean;
  payload?: { payload: VideoCategoryAverage }[];
}) {
  const category = payload?.[0]?.payload;
  if (!active || !category) return null;
  return <div className="chart-tooltip" role="status" aria-live="polite">
    <strong>{category.name}</strong>
    <span>Hours: {formatHoursOneDecimal(category.totalMinutes)}</span>
    <span>Percentage: {category.percentage.toFixed(1)}%</span>
  </div>;
}

function AccessibleData({
  title,
  headers,
  rows,
}: {
  title: string;
  headers: string[];
  rows: string[][];
}) {
  return <details className="chart-data"><summary>View accessible data</summary>
    <table><caption className="sr-only">{title}</caption><thead><tr>
      {headers.map((header) => <th key={header}>{header}</th>)}
    </tr></thead><tbody>{rows.map((row) => <tr key={row[0]}>
      {row.map((value, index) => <td key={headers[index]}>{value}</td>)}
    </tr>)}</tbody></table>
  </details>;
}

function formatHours(minutes: number) {
  return (minutes / 60).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function formatHoursOneDecimal(minutes: number) {
  return (minutes / 60).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
