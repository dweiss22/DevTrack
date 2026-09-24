"use client";

import React, { useRef, useState } from "react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { exportChartSvgAsPng } from "@/lib/reporting/chart-export";
import { hoursFromMinutes, percentDifference, type HoursTimeseries } from "@/lib/reporting/insights";

type ChartMode = "bar" | "line";

export function InsightsComparisonChart({ metricA, metricB, swapHref }: { metricA: HoursTimeseries; metricB: HoursTimeseries; swapHref: string }) {
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
  const difference = percentDifference(totalAHours, totalBHours);

  return <article className="card insights-chart-card" aria-labelledby="comparison-chart-title">
    <div className="chart-heading">
      <div>
        <h2 id="comparison-chart-title">Compare two metrics</h2>
        <p>Metric A and Metric B use the independent filter panels above.</p>
      </div>
      <div className="insights-chart-controls">
        <div className="insights-mode-toggle" role="group" aria-label="Chart type">
          <button type="button" aria-pressed={mode === "bar"} onClick={() => setMode("bar")}>Grouped bars</button>
          <button type="button" aria-pressed={mode === "line"} onClick={() => setMode("line")}>Lines</button>
        </div>
        <Link className="button secondary" href={swapHref}>Swap A / B</Link>
        <button type="button" className="secondary" onClick={() => exportChartSvgAsPng(containerRef.current, "comparison-hours.png")}>Export as image</button>
      </div>
    </div>
    <div className="insights-comparison-summary">
      <div className="insights-comparison-stat metric-a"><span>Metric A</span><strong>{totalAHours.toLocaleString()}h</strong><small>{metricA.totalCourses.toLocaleString()} course{metricA.totalCourses === 1 ? "" : "s"}</small></div>
      <div className="insights-comparison-stat metric-b"><span>Metric B</span><strong>{totalBHours.toLocaleString()}h</strong><small>{metricB.totalCourses.toLocaleString()} course{metricB.totalCourses === 1 ? "" : "s"}</small></div>
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
                <Bar dataKey="metricAHours" name="Metric A" fill="#145b9e" radius={[5, 5, 0, 0]} />
                <Bar dataKey="metricBHours" name="Metric B" fill="#d97706" radius={[5, 5, 0, 0]} />
              </BarChart>
            : <LineChart data={chartData} margin={{ top: 12, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(hours) => `${hours}h`} />
                <Tooltip formatter={(value: number) => `${value.toLocaleString()} hours`} />
                <Legend />
                <Line type="monotone" dataKey="metricAHours" name="Metric A" stroke="#145b9e" strokeWidth={3} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="metricBHours" name="Metric B" stroke="#d97706" strokeWidth={3} dot={{ r: 3 }} />
              </LineChart>}
        </ResponsiveContainer>
      </div>
      <details className="chart-data">
        <summary>View accessible data</summary>
        <table>
          <thead><tr><th>Month</th><th>Metric A hours</th><th>Metric B hours</th></tr></thead>
          <tbody>{chartData.map((row) => <tr key={row.label}><td>{row.label}</td><td>{row.metricAHours}</td><td>{row.metricBHours}</td></tr>)}</tbody>
        </table>
      </details>
    </> : <p className="chart-empty">No recorded time matches either metric's filters.</p>}
  </article>;
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}
