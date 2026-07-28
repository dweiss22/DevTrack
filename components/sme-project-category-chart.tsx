"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { workflowCategoryColor } from "@/lib/reporting/workflow-category-colors";

export function SmeProjectCategoryChart({ rows }: { rows: Array<{ category: string; minutes: number }> }) {
  const data = rows.map((row) => ({ ...row, hours: Number(row.minutes) / 60 }));
  if (!data.length) return <p className="empty">No recorded time is available for this project.</p>;
  return <><div className="sme-category-chart" role="img" aria-label="Bar chart of total project hours by time category">
    <ResponsiveContainer width="100%" height={300}><BarChart data={data} margin={{ top: 12, right: 18, left: 0, bottom: 52 }}>
      <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="category" interval={0}
        angle={data.length > 3 ? -20 : 0} textAnchor={data.length > 3 ? "end" : "middle"} />
      <YAxis /><Tooltip formatter={(value) => [`${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })} h`, "Hours"]} />
      <Bar dataKey="hours" name="Hours" radius={[6, 6, 0, 0]}>{data.map((row) =>
        <Cell key={row.category} fill={workflowCategoryColor(row.category)} />)}</Bar>
    </BarChart></ResponsiveContainer>
  </div><details className="chart-data"><summary>View accessible data</summary><table><thead><tr><th>Category</th><th>Hours</th></tr></thead>
    <tbody>{data.map((row) => <tr key={row.category}><td>{row.category}</td><td>{row.hours.toFixed(2)}</td></tr>)}</tbody></table></details></>;
}
