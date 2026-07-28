"use client";

import React, { useId, useState } from "react";
import {
  CartesianGrid, Cell, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  categoryPeriodForYear,
  type IdCategoryAverage,
  type IdDashboardAnalytics,
  type IdDevelopmentYear,
} from "@/lib/dashboards/id-analytics";
import {
  compactWorkflowCategoryLabel,
  workflowCategoryColor,
} from "@/lib/reporting/workflow-category-colors";

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
  return <article className="card dashboard-chart id-dashboard-chart" aria-labelledby="id-development-time-title">
    <h2 id="id-development-time-title">Average Development Time by Course Reporting Year</h2>
    <p>The selected ID’s total logged time divided by their distinct assigned projects in each course reporting year.</p>
    {hasData ? <>
      <div className="id-chart-canvas" role="img" aria-label="Line chart of average development hours per project by course reporting year">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={analytics.developmentTimeByYear} margin={{ top: 12, right: 24, left: 30, bottom: 30 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="year" allowDecimals={false}
              label={{ value: "Course reporting year", position: "insideBottom", offset: -18 }} />
            <YAxis domain={[0, "auto"]} tickFormatter={(minutes) => `${formatHours(Number(minutes))}h`}
              label={{ value: "Average hours per project", angle: -90, position: "insideLeft", offset: -18 }} />
            <Tooltip content={<DevelopmentTimeTooltip />} />
            <Line type="monotone" dataKey="averageMinutes" name="Average hours per project"
              connectNulls={false} stroke="#145b9e" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <AccessibleData title="Average development time data"
        headers={["Course reporting year", "Qualifying projects", "Average hours per project", "Selected ID total hours"]}
        rows={analytics.developmentTimeByYear.map((row) => [
          String(row.year),
          String(row.projectCount),
          row.averageMinutes == null ? "No qualifying projects" : formatHoursOneDecimal(row.averageMinutes),
          row.totalMinutes == null ? "—" : formatHours(row.totalMinutes),
        ])} />
    </> : <p className="chart-empty">{analytics.timeDataSynchronized
      ? "No assigned projects with a course reporting year are available for this ID."
      : "Time data is unavailable until a successful synchronization completes."}</p>}
  </article>;
}

function CategoryTimeChart({ analytics }: { analytics: IdDashboardAnalytics }) {
  const selectId = useId();
  const [selectedYear, setSelectedYear] = useState<"all" | number>("all");
  const period = categoryPeriodForYear(analytics, selectedYear);
  const hasData = analytics.timeDataSynchronized && period.categories.length > 0;
  return <article className="card dashboard-chart id-dashboard-chart" aria-labelledby="id-category-time-title">
    <div className="chart-heading id-chart-heading">
      <div><h2 id="id-category-time-title">Time by Workflow Category</h2>
        <p>The selected ID’s logged hours and share of time in each synchronized workflow category.</p></div>
      <label className="id-chart-year-selector" htmlFor={selectId}>Course reporting year
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
          {period.categories.map((category) => <li key={category.name} title={category.name}>
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
      ? `No qualifying time entries are available for ${selectedYear === "all" ? "this ID" : selectedYear}.`
      : "Time data is unavailable until a successful synchronization completes."}</p>}
  </article>;
}

export function DevelopmentTimeTooltip({ active, payload }: {
  active?: boolean;
  payload?: { payload: IdDevelopmentYear }[];
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return <div className="chart-tooltip" role="status" aria-live="polite">
    <strong>Course reporting year {row.year}</strong>
    <span>Average: {row.averageMinutes == null ? "No qualifying projects" : `${formatHoursOneDecimal(row.averageMinutes)} hours per project`}</span>
    <span>Qualifying projects: {row.projectCount}</span>
  </div>;
}

export function CategoryTimeTooltip({ active, payload }: {
  active?: boolean;
  payload?: { payload: IdCategoryAverage }[];
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
