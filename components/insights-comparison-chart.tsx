"use client";

import React, { useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartExportIcon } from "@/components/chart-export-icon";
import { exportChartAsImage } from "@/lib/reporting/chart-export";
import { hoursFromMinutes, percentDifference, type HoursTimeseries } from "@/lib/reporting/insights";

type ChartMode = "bar" | "line";
const COMPARISON_TITLE = "Compare two metrics";

export function InsightsComparisonChart({ metricA, metricB, metricATitle, metricBTitle, filterLabelsA, filterLabelsB, onSwap }: {
  metricA: HoursTimeseries; metricB: HoursTimeseries; metricATitle: string; metricBTitle: string; filterLabelsA: string[]; filterLabelsB: string[]; onSwap: () => void
}) {
  const [mode, setMode] = useState<ChartMode>("bar");
  const containerRef = useRef<HTMLDivElement>(null);
  const months = [...new Set([...metricA.periods.map((period) => period.label), ...metricB.periods.map((period) => period.label)])];
  const byLabel = (series: HoursTimeseries) => new Map(series.periods.map((period) => [period.label, period]));
  const aByLabel = byLabel(metricA);
  const bByLabel = byLabel(metricB);
  const chartData = months.map((label) => ({
    label,
    metricAHours: round1(hoursFromMinutes(aByLabel.get(label)?.minutes ?? 0)),
    metricBHours: round1(hoursFromMinutes(bByLabel.get(label)?.minutes ?? 0))
  }));
  const totalAHours = round1(hoursFromMinutes(metricA.totalMinutes));
  const totalBHours = round1(hoursFromMinutes(metricB.totalMinutes));
  const avgAHoursPerCourse = metricA.totalCourses ? round1(totalAHours / metricA.totalCourses) : 0;
  const avgBHoursPerCourse = metricB.totalCourses ? round1(totalBHours / metricB.totalCourses) : 0;
  const difference = percentDifference(totalAHours, totalBHours);
  const description = `${metricATitle} compared with ${metricBTitle}, based on the filter panels above.`;
  const exportImage = () => exportChartAsImage(containerRef.current, "comparison-hours.png", {
    title: COMPARISON_TITLE,
    description,
    filterSections: [
      { label: `Metric A filters (${metricATitle})`, lines: filterLabelsA },
      { label: `Metric B filters (${metricBTitle})`, lines: filterLabelsB }
    ]
  });

  return <article className="insights-chart-card" aria-labelledby="comparison-chart-title">
    <div className="chart-heading">
      <div>
        <h2 id="comparison-chart-title">{COMPARISON_TITLE}</h2>
        <p>{description}</p>
      </div>
      <div className="insights-chart-controls">
        <div className="insights-mode-toggle" role="group" aria-label="Chart type">
          <button type="button" aria-pressed={mode === "bar"} onClick={() => setMode("bar")}>Grouped bars</button>
          <button type="button" aria-pressed={mode === "line"} onClick={() => setMode("line")}>Lines</button>
        </div>
        <button type="button" className="secondary" onClick={onSwap}>Swap A / B</button>
        <button type="button" className="chart-icon-button" title="Export chart as image" aria-label="Export chart as image" onClick={exportImage}><ChartExportIcon /></button>
      </div>
    </div>
    <div className="insights-comparison-summary">
      <div className="insights-comparison-stat metric-a"><span>Metric A · {metricATitle}</span><strong>{totalAHours.toLocaleString()}h</strong><small>{metricA.totalCourses.toLocaleString()} course{metricA.totalCourses === 1 ? "" : "s"} · avg {avgAHoursPerCourse.toLocaleString()}h/course</small></div>
      <div className="insights-comparison-stat metric-b"><span>Metric B · {metricBTitle}</span><strong>{totalBHours.toLocaleString()}h</strong><small>{metricB.totalCourses.toLocaleString()} course{metricB.totalCourses === 1 ? "" : "s"} · avg {avgBHoursPerCourse.toLocaleString()}h/course</small></div>
      <div className="insights-comparison-stat"><span>Difference (B vs A)</span><strong>{difference == null ? "—" : `${difference >= 0 ? "+" : ""}${round1(difference)}%`}</strong></div>
    </div>
    {chartData.length ? <>
      <div className="insights-chart-canvas" role="img" aria-label="Comparison of recorded hours by month for Metric A and Metric B" ref={containerRef}>
        <ResponsiveContainer width="100%" height={320}>
          {mode === "bar"
            ? <BarChart data={chartData} margin={{ top: 12, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(hours) => `${hours}h`} />
                <Tooltip formatter={(value: number) => `${value.toLocaleString()} hours`} />
                <Legend />
                <Bar dataKey="metricAHours" name={`A · ${metricATitle}`} fill="#145b9e" radius={[5, 5, 0, 0]} />
                <Bar dataKey="metricBHours" name={`B · ${metricBTitle}`} fill="#d97706" radius={[5, 5, 0, 0]} />
              </BarChart>
            : <LineChart data={chartData} margin={{ top: 12, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(hours) => `${hours}h`} />
                <Tooltip formatter={(value: number) => `${value.toLocaleString()} hours`} />
                <Legend />
                <Line type="monotone" dataKey="metricAHours" name={`A · ${metricATitle}`} stroke="#145b9e" strokeWidth={3} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="metricBHours" name={`B · ${metricBTitle}`} stroke="#d97706" strokeWidth={3} dot={{ r: 3 }} />
              </LineChart>}
        </ResponsiveContainer>
      </div>
      <details className="chart-data">
        <summary>View accessible data</summary>
        <table>
          <thead><tr><th>Month</th><th>A · {metricATitle} hours</th><th>B · {metricBTitle} hours</th></tr></thead>
          <tbody>{chartData.map((row) => <tr key={row.label}><td>{row.label}</td><td>{row.metricAHours}</td><td>{row.metricBHours}</td></tr>)}</tbody>
        </table>
      </details>
    </> : <p className="chart-empty">No recorded time matches either metric's filters.</p>}
  </article>;
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}
