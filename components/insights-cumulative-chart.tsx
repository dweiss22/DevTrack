"use client";

import React, { useRef, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { averageHoursPerCourse, hoursFromMinutes, type HoursTimeseries } from "@/lib/reporting/insights";
import { ChartExportButton } from "@/components/chart-export-button";

type ChartMode = "cumulative" | "period";
const CUMULATIVE_TITLE = "Cumulative hours";
const CUMULATIVE_DESCRIPTION = "Recorded hours across the courses matching the filters above, grouped by month.";

export function InsightsCumulativeChart({ data, filterLabels }: { data: HoursTimeseries; filterLabels: string[] }) {
  const [mode, setMode] = useState<ChartMode>("cumulative");
  const chartRef = useRef<HTMLDivElement>(null);
  const chartData = data.periods.map((period) => ({
    label: period.label,
    hours: round1(hoursFromMinutes(period.minutes)),
    cumulativeHours: round1(hoursFromMinutes(period.cumulativeMinutes)),
    projectCount: period.projectCount
  }));
  const totalHours = round1(hoursFromMinutes(data.totalMinutes));
  const avgHours = round1(averageHoursPerCourse(data.totalMinutes, data.totalCourses));
  const filterSections = [{ label: "Filters", lines: filterLabels }];

  return <article className="insights-chart-card" aria-labelledby="cumulative-hours-title">
    <div className="chart-heading">
      <div>
        <h2 id="cumulative-hours-title">{CUMULATIVE_TITLE}</h2>
        <p>{CUMULATIVE_DESCRIPTION}</p>
      </div>
      <div className="insights-chart-controls">
        <div className="insights-mode-toggle" role="group" aria-label="Chart view">
          <button type="button" aria-pressed={mode === "cumulative"} onClick={() => setMode("cumulative")}>Cumulative</button>
          <button type="button" aria-pressed={mode === "period"} onClick={() => setMode("period")}>By month</button>
        </div>
        <ChartExportButton containerRef={chartRef} filename="cumulative-hours.png" title={CUMULATIVE_TITLE} description={CUMULATIVE_DESCRIPTION} filterSections={filterSections} />
      </div>
    </div>
    <p className="insights-chart-summary"><strong>{data.totalCourses.toLocaleString()}</strong> matching course{data.totalCourses === 1 ? "" : "s"} · <strong>{totalHours.toLocaleString()}</strong> total hours · <strong>{avgHours.toLocaleString()}</strong> avg hours/course</p>
    {chartData.length ? <>
      <div className="insights-chart-canvas" role="img" aria-label={mode === "cumulative" ? "Area chart of cumulative recorded hours by month" : "Bar chart of recorded hours by month"} ref={chartRef}>
        <ResponsiveContainer width="100%" height={320}>
          {mode === "cumulative"
            ? <AreaChart data={chartData} margin={{ top: 12, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(hours) => `${hours}h`} />
                <Tooltip content={<CumulativeTooltip />} />
                <Area type="monotone" dataKey="cumulativeHours" name="Cumulative hours" stroke="#145b9e" fill="#145b9e33" strokeWidth={3} />
              </AreaChart>
            : <BarChart data={chartData} margin={{ top: 12, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(hours) => `${hours}h`} />
                <Tooltip content={<PeriodTooltip />} />
                <Bar dataKey="hours" name="Hours" fill="#145b9e" radius={[5, 5, 0, 0]} />
              </BarChart>}
        </ResponsiveContainer>
      </div>
      <details className="chart-data">
        <summary>View accessible data</summary>
        <table>
          <thead><tr><th>Month</th><th>Hours</th><th>Cumulative hours</th><th>Courses with time this month</th></tr></thead>
          <tbody>{chartData.map((row) => <tr key={row.label}><td>{row.label}</td><td>{row.hours}</td><td>{row.cumulativeHours}</td><td>{row.projectCount}</td></tr>)}</tbody>
        </table>
      </details>
    </> : <p className="chart-empty">No recorded time matches these filters.</p>}
    {data.courses.length > 0 && <details className="chart-data">
      <summary>Hours per course ({data.courses.length.toLocaleString()})</summary>
      <table>
        <thead><tr><th>Course</th><th>Hours</th></tr></thead>
        <tbody>{data.courses.map((course) => <tr key={course.taskId}><td>{course.title}</td><td>{round1(hoursFromMinutes(course.minutes)).toLocaleString()}</td></tr>)}</tbody>
        <tfoot><tr><th>Average across {data.totalCourses.toLocaleString()} course{data.totalCourses === 1 ? "" : "s"} (incl. courses with no time)</th><th>{avgHours.toLocaleString()}</th></tr></tfoot>
      </table>
    </details>}
  </article>;
}

function CumulativeTooltip({ active, payload }: { active?: boolean; payload?: { payload: { label: string; cumulativeHours: number; hours: number } }[] }) {
  const row = payload?.[0]?.payload;
  return active && row ? <div className="chart-tooltip"><strong>{row.label}</strong><span>{row.cumulativeHours.toLocaleString()} cumulative hours</span><span>{row.hours.toLocaleString()} hours this month</span></div> : null;
}

function PeriodTooltip({ active, payload }: { active?: boolean; payload?: { payload: { label: string; hours: number; projectCount: number } }[] }) {
  const row = payload?.[0]?.payload;
  return active && row ? <div className="chart-tooltip"><strong>{row.label}</strong><span>{row.hours.toLocaleString()} hours</span><span>{row.projectCount} course{row.projectCount === 1 ? "" : "s"} with recorded time</span></div> : null;
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}
