"use client";

import React from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { workflowCategoryColor } from "@/lib/reporting/workflow-category-colors";

export function SmeProjectCategoryChart({ rows }: { rows: Array<{ category: string; minutes: number }> }) {
  const data = rows.map((row) => ({
    ...row,
    color: workflowCategoryColor(row.category),
    hours: Number(row.minutes) / 60,
  }));
  const totalHours = data.reduce((total, row) => total + row.hours, 0);
  if (!data.length) return <p className="empty">No recorded time is available for this project.</p>;
  return <><div className="sme-category-chart">
    <div className="sme-category-pie" role="img" aria-label="Pie chart of total project hours by time category">
      <ResponsiveContainer width="100%" height={280}><PieChart>
        <Pie data={data} dataKey="hours" nameKey="category" cx="50%" cy="50%" innerRadius="42%" outerRadius="78%"
          paddingAngle={2} stroke="#fff" strokeWidth={2}>
          {data.map((row) => <Cell key={row.category} fill={row.color} />)}
        </Pie>
        <Tooltip formatter={(value) => [`${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })} h`, "Hours"]} />
      </PieChart></ResponsiveContainer>
      <div className="sme-category-total" aria-hidden="true"><strong>{formatHours(totalHours)}</strong><span>Total hours</span></div>
    </div>
    <ul className="sme-category-legend" aria-label="Time category legend">{data.map((row) => <li key={row.category}>
      <span className="sme-category-swatch" style={{ backgroundColor: row.color }} aria-hidden="true" />
      <span className="sme-category-label">{row.category}</span>
      <strong>{formatHours(row.hours)} h</strong>
    </li>)}</ul>
  </div><details className="chart-data"><summary>View accessible data</summary><table><thead><tr><th>Category</th><th>Hours</th></tr></thead>
    <tbody>{data.map((row) => <tr key={row.category}><td>{row.category}</td><td>{row.hours.toFixed(2)}</td></tr>)}</tbody></table></details></>;
}

function formatHours(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
