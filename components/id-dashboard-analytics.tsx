"use client";

import React, { useId, useMemo, useState } from "react";
import {
  CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart,
  ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  categoryPeriodForYear,
  type IdCategoryAverage,
  type IdCategoryPeriod,
  type IdDashboardAnalytics,
  type IdDevelopmentYear,
} from "@/lib/dashboards/id-analytics";
import {
  compactWorkflowCategoryLabel,
  workflowCategoryColor,
} from "@/lib/reporting/workflow-category-colors";

const SELECTED_ID_COLOR = "#145b9e";
const OTHER_ID_PALETTE = ["#0c8f78", "#c25b12", "#7c3aed", "#b83280", "#527a20", "#087e8b", "#64748b"];

function niceCeilingMinutes(maxMinutes: number) {
  const step = 60;
  return Math.max(step, Math.ceil((maxMinutes * 1.1) / step) * step);
}

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
  const otherIds = analytics.otherIdentitiesByYear;
  const progress = analytics.currentYearProgress;
  const chartData = useMemo(() => {
    const years = new Set<number>(analytics.developmentTimeByYear.map((row) => row.year));
    for (const identity of otherIds) for (const point of identity.points) years.add(point.year);
    const rows = new Map<number, Record<string, number | null>>(
      [...years].sort((a, b) => a - b).map((year) => [year, { year }]),
    );
    for (const row of analytics.developmentTimeByYear) rows.get(row.year)!.averageMinutes = row.averageMinutes;
    otherIds.forEach((identity, index) => {
      for (const point of identity.points) rows.get(point.year)![`other_${index}`] = point.averageMinutes;
    });
    return [...rows.values()];
  }, [analytics.developmentTimeByYear, otherIds]);
  const yAxisMax = analytics.yAxisMaxMinutes != null ? niceCeilingMinutes(analytics.yAxisMaxMinutes) : "auto";
  return <article className="card dashboard-chart id-dashboard-chart" aria-labelledby="id-development-time-title">
    <h2 id="id-development-time-title">Average Development Time by Course Reporting Year</h2>
    <p>The selected ID’s total logged time divided by their distinct assigned projects in each course reporting year.
      Other IDs in the organization are shown faded for context; the Y axis is scaled the same across every ID’s dashboard.</p>
    {hasData ? <>
      <div className="id-chart-canvas" role="img" aria-label="Line chart of average development hours per project by course reporting year, with faded lines for other IDs">
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={chartData} margin={{ top: 12, right: 24, left: 30, bottom: 30 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="year" allowDecimals={false} type="number" domain={["dataMin", "dataMax"]}
              label={{ value: "Course reporting year", position: "insideBottom", offset: -18 }} />
            <YAxis domain={[0, yAxisMax]} tickFormatter={(minutes) => `${formatHours(Number(minutes))}h`}
              label={{ value: "Average hours per project", angle: -90, position: "insideLeft", offset: -18 }} />
            <Tooltip content={<DevelopmentTimeTooltip progress={progress} />} />
            {otherIds.map((identity, index) =>
              <Line key={identity.wrikeUserId} type="monotone" dataKey={`other_${index}`} name={identity.displayName}
                stroke={OTHER_ID_PALETTE[index % OTHER_ID_PALETTE.length]} strokeWidth={1} strokeOpacity={0.35}
                dot={false} activeDot={false} connectNulls={false} isAnimationActive={false} legendType="none" />)}
            <Line type="monotone" dataKey="averageMinutes" name="Average hours per project"
              connectNulls={false} stroke={SELECTED_ID_COLOR} strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
            {progress ? <>
              <ReferenceDot x={progress.year} y={progress.startMinutes} r={4} fill="none"
                stroke={SELECTED_ID_COLOR} strokeDasharray="2 2" isFront />
              {progress.currentAverageMinutes != null ? <ReferenceLine
                segment={[{ x: progress.year, y: progress.startMinutes }, { x: progress.year, y: progress.currentAverageMinutes }]}
                stroke={SELECTED_ID_COLOR} strokeDasharray="4 4" /> : null}
            </> : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {progress && progress.currentAverageMinutes != null ? <p className="id-chart-current-year-note">
        Course reporting year {progress.year} is still in progress: it started at {formatHoursOneDecimal(progress.startMinutes)}h
        and is now averaging {formatHoursOneDecimal(progress.currentAverageMinutes)}h per project.
      </p> : null}
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
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState<"all" | number>(
    () => analytics.categoryTime.years.some((item) => item.year === currentYear) ? currentYear : "all",
  );
  const period = categoryPeriodForYear(analytics, selectedYear);
  const hasData = analytics.timeDataSynchronized && period.categories.length > 0;
  const priorYearPeriod = selectedYear !== "all" && selectedYear < currentYear
    ? analytics.categoryTime.years.find((item) => item.year === selectedYear - 1) ?? null
    : null;
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
          {period.categories.map((category) => {
            const trend = categoryTrend(category, priorYearPeriod, selectedYear);
            return <li key={category.name} title={category.name}>
              <i style={{ backgroundColor: workflowCategoryColor(category.name) }} aria-hidden="true" />
              <span>{compactWorkflowCategoryLabel(category.name)}</span>
              <strong>{formatHoursOneDecimal(category.totalMinutes)}h
                {trend ? <span className={trend.direction === "up" ? "id-trend-up" : "id-trend-down"}
                  aria-label={`${trend.direction === "up" ? "Up" : "Down"} from ${formatHoursOneDecimal(trend.priorMinutes)}h in ${(selectedYear as number) - 1}`}>
                  {trend.direction === "up" ? "▲" : "▼"}
                </span> : null}
              </strong>
            </li>;
          })}
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

export function categoryTrend(
  category: IdCategoryAverage,
  priorYearPeriod: IdCategoryPeriod | null,
  selectedYear: "all" | number,
): { direction: "up" | "down"; priorMinutes: number } | null {
  if (!priorYearPeriod || selectedYear === "all") return null;
  const priorCategory = priorYearPeriod.categories.find((item) => item.name === category.name);
  if (!priorCategory || priorCategory.totalMinutes === category.totalMinutes) return null;
  return {
    direction: category.totalMinutes > priorCategory.totalMinutes ? "up" : "down",
    priorMinutes: priorCategory.totalMinutes,
  };
}

export function DevelopmentTimeTooltip({ active, payload, progress }: {
  active?: boolean;
  payload?: { payload: IdDevelopmentYear }[];
  progress?: IdDashboardAnalytics["currentYearProgress"];
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const isCurrentYearInProgress = progress?.year === row.year && progress.currentAverageMinutes != null;
  return <div className="chart-tooltip" role="status" aria-live="polite">
    <strong>Course reporting year {row.year}</strong>
    <span>Average: {row.averageMinutes == null ? "No qualifying projects" : `${formatHoursOneDecimal(row.averageMinutes)} hours per project`}</span>
    <span>Qualifying projects: {row.projectCount}</span>
    {isCurrentYearInProgress ? <span>Started at {formatHoursOneDecimal(progress!.startMinutes)}h, now {formatHoursOneDecimal(progress!.currentAverageMinutes!)}h</span> : null}
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
