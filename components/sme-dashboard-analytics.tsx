"use client";

import React from "react";
import { Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";

type AnalyticsRow = {
  status_classification: string;
  submitted_billable_hours: number | null;
  submitted_at: string | null;
};

const STATUS = [
  { key: "active", name: "Active", color: "#3b82c4" },
  { key: "completed", name: "Completed", color: "#0c8f78" },
  { key: "stalled_or_canceled", name: "Stalled / Canceled", color: "#64748b" },
  { key: "unclassified", name: "Unclassified", color: "#d97706" },
];

export function SmeDashboardAnalytics({ rows }: { rows: AnalyticsRow[] }) {
  const statusData = STATUS.map((status) => ({
    ...status,
    projects: rows.filter((row) => (row.status_classification || "unclassified") === status.key).length,
  })).filter((row) => row.projects > 0);
  const billed = billedHoursByMonth(rows);
  return <div className="sme-analytics-grid">
    <article className="card sme-chart-card">
      <div className="section-heading"><div><p className="eyebrow">ASSIGNMENT STATUS</p><h2>Assigned projects</h2></div>
        <strong className="sme-chart-total">{rows.length}</strong></div>
      {statusData.length ? <><div className="sme-chart-canvas" role="img" aria-label={`Gauge chart of ${rows.length} assigned projects by status`}>
        <ResponsiveContainer width="100%" height={270}><PieChart><Pie data={statusData} dataKey="projects" nameKey="name"
          innerRadius={68} outerRadius={102} startAngle={210} endAngle={-30} paddingAngle={2}>
          {statusData.map((row) => <Cell key={row.key} fill={row.color} />)}
        </Pie><Tooltip formatter={(value, name) => [`${value} projects`, name]} /><Legend /></PieChart></ResponsiveContainer>
      </div><AccessibleStatus rows={statusData} /></> : <p className="empty">No assignments match this view.</p>}
    </article>
    <article className="card sme-chart-card">
      <div><p className="eyebrow">SUBMITTED BILLING</p><h2>Average billable hours over time</h2>
        <p>Monthly averages from submitted external-SME debriefs.</p></div>
      {billed.length ? <><div className="sme-chart-canvas" role="img" aria-label="Line chart of average submitted billable hours by month">
        <ResponsiveContainer width="100%" height={270}><LineChart data={billed} margin={{ top: 12, right: 20, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" /><YAxis />
          <Tooltip formatter={(value) => [`${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })} h`, "Average"]} />
          <Line type="monotone" dataKey="averageHours" stroke="#145b9e" strokeWidth={3} connectNulls={false} dot={{ r: 4 }} />
        </LineChart></ResponsiveContainer>
      </div><details className="chart-data"><summary>View accessible data</summary><table><thead><tr><th>Month</th><th>Average hours</th><th>Submitted surveys</th></tr></thead>
        <tbody>{billed.map((row) => <tr key={row.key}><td>{row.label}</td><td>{row.averageHours.toFixed(2)}</td><td>{row.surveys}</td></tr>)}</tbody></table></details></>
        : <p className="empty">No submitted external-SME billing is available for this view.</p>}
    </article>
  </div>;
}

function billedHoursByMonth(rows: AnalyticsRow[]) {
  const grouped = new Map<string, { total: number; surveys: number }>();
  for (const row of rows) {
    if (!row.submitted_at || row.submitted_billable_hours == null) continue;
    const key = row.submitted_at.slice(0, 7);
    const current = grouped.get(key) ?? { total: 0, surveys: 0 };
    current.total += Number(row.submitted_billable_hours);
    current.surveys += 1;
    grouped.set(key, current);
  }
  return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => ({
    key,
    label: new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
      .format(new Date(`${key}-01T00:00:00Z`)),
    averageHours: value.total / value.surveys,
    surveys: value.surveys,
  }));
}

function AccessibleStatus({ rows }: { rows: Array<{ key: string; name: string; projects: number }> }) {
  return <details className="chart-data"><summary>View accessible data</summary><table><thead><tr><th>Status</th><th>Projects</th></tr></thead>
    <tbody>{rows.map((row) => <tr key={row.key}><td>{row.name}</td><td>{row.projects}</td></tr>)}</tbody></table></details>;
}
