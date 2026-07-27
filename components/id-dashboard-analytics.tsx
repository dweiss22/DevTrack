"use client";

import React, { useId, useState } from "react";
import {
  CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  categoryPeriodForYear,
  type IdCategoryAverage,
  type IdDashboardAnalytics,
  type IdDevelopmentYear,
} from "@/lib/dashboards/id-analytics";

const CATEGORY_COLORS = [
  "#145b9e", "#0c8f78", "#7c3aed", "#c25b12",
  "#b83280", "#527a20", "#087e8b", "#64748b",
];

export function IdDashboardAnalyticsSection({
  analytics,
  error,
}: {
  analytics: IdDashboardAnalytics | null;
  error?: string | null;
}) {
  if (error) return <section className="card dashboard-query-error" role="alert">
    <h2>ID analytics unavailable</h2><p>{error} Assigned-project details remain available below.</p>
  </section>;
  if (!analytics) return null;

  return <section className="id-dashboard-analytics" aria-label="Instructional Designer analytics">
    <DevelopmentTimeChart analytics={analytics} />
    <CategoryTimeChart analytics={analytics} />
  </section>;
}

function DevelopmentTimeChart({ analytics }: { analytics: IdDashboardAnalytics }) {
  const hasData = analytics.timeDataSynchronized
    && analytics.developmentTimeByYear.some((row) => row.averageMinutes != null);
  return <article className="card dashboard-chart" aria-labelledby="id-development-time-title">
    <h2 id="id-development-time-title">Average Development Time by Year</h2>
    <p>Total logged project effort from all contributors, averaged across the selected ID’s completed projects. Project year is the completion year.</p>
    {hasData ? <>
      <div className="id-chart-canvas" role="img" aria-label="Line chart of average project development hours by completion year">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={analytics.developmentTimeByYear} margin={{ top: 12, right: 24, left: 24, bottom: 28 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="year" type="number" domain={["dataMin", "dataMax"]} allowDecimals={false}
              tickCount={Math.min(analytics.developmentTimeByYear.length, 8)}
              label={{ value: "Completion year", position: "insideBottom", offset: -16 }} />
            <YAxis tickFormatter={(minutes) => `${formatHours(Number(minutes))}h`}
              label={{ value: "Average hours / completed project", angle: -90, position: "insideLeft", offset: -12 }} />
            <Tooltip content={<DevelopmentTimeTooltip />} />
            <Line type="monotone" dataKey="averageMinutes" name="Average hours per completed project"
              connectNulls={false} stroke="#145b9e" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <AccessibleData title="Average development time data"
        headers={["Completion year", "Qualifying projects", "Average hours", "Combined hours"]}
        rows={analytics.developmentTimeByYear.map((row) => [
          String(row.year),
          String(row.projectCount),
          row.averageMinutes == null ? "No qualifying projects" : formatHours(row.averageMinutes),
          row.totalMinutes == null ? "—" : formatHours(row.totalMinutes),
        ])} />
    </> : <p className="chart-empty">{analytics.timeDataSynchronized
      ? "No completed, dated projects are available for this ID."
      : "Time data is unavailable until a successful synchronization completes."}</p>}
  </article>;
}

function CategoryTimeChart({ analytics }: { analytics: IdDashboardAnalytics }) {
  const selectId = useId();
  const [selectedYear, setSelectedYear] = useState<"all" | number>("all");
  const period = categoryPeriodForYear(analytics, selectedYear);
  const hasData = analytics.timeDataSynchronized && period.categories.length > 0;
  return <article className="card dashboard-chart" aria-labelledby="id-category-time-title">
    <div className="chart-heading id-chart-heading">
      <div><h2 id="id-category-time-title">Average Time by Time Entry Category</h2>
        <p>{analytics.categoryTime.denominatorDefinition} Category averages use that denominator; percentages represent the selected ID’s logged-time distribution.</p></div>
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
      <div className="id-chart-canvas" role="img"
        aria-label={`Donut chart of average time by category for ${selectedYear === "all" ? "all time" : selectedYear}`}>
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie data={period.categories} dataKey="averageMinutes" nameKey="name"
              innerRadius={62} outerRadius={96} paddingAngle={2}>
              {period.categories.map((item, index) =>
                <Cell key={item.name} fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]} />)}
            </Pie>
            <Tooltip content={<CategoryTimeTooltip />} />
            <Legend verticalAlign="bottom" height={48} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <p className="id-chart-denominator">{period.qualifyingProjectCount} qualifying project{period.qualifyingProjectCount === 1 ? "" : "s"} · {period.entryCount} time entr{period.entryCount === 1 ? "y" : "ies"}</p>
      <AccessibleData title="Time entry category data"
        headers={["Category", "Average hours per qualifying project", "Percentage", "Total hours"]}
        rows={period.categories.map((category) => [
          category.name, formatHours(category.averageMinutes),
          `${category.percentage.toFixed(1)}%`, formatHours(category.totalMinutes),
        ])} />
    </> : <p className="chart-empty">{analytics.timeDataSynchronized
      ? `No qualifying time entries are available for ${selectedYear === "all" ? "this ID" : selectedYear}.`
      : "Time data is unavailable until a successful synchronization completes."}</p>}
  </article>;
}

function DevelopmentTimeTooltip({ active, payload }: {
  active?: boolean;
  payload?: { payload: IdDevelopmentYear }[];
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return <div className="chart-tooltip" role="status" aria-live="polite">
    <strong>{row.year}</strong>
    <span>Average development time: {row.averageMinutes == null ? "No qualifying projects" : `${formatHours(row.averageMinutes)} hours`}</span>
    <span>Qualifying projects: {row.projectCount}</span>
  </div>;
}

function CategoryTimeTooltip({ active, payload }: {
  active?: boolean;
  payload?: { payload: IdCategoryAverage }[];
}) {
  const category = payload?.[0]?.payload;
  if (!active || !category) return null;
  return <div className="chart-tooltip" role="status" aria-live="polite">
    <strong>{category.name}</strong>
    <span>Average: {formatHours(category.averageMinutes)} hours per qualifying project</span>
    <span>Share of logged time: {category.percentage.toFixed(1)}%</span>
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
