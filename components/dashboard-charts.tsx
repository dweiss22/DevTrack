"use client";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DashboardAnalytics, DashboardCategory, ReportingYearStatus, ReportingYearTime } from "@/lib/reporting/dashboard";

const CATEGORY_COLORS = ["#145b9e", "#0c8f78", "#7c3aed", "#d97706", "#dc4c64", "#64748b", "#0891b2", "#65a30d"];

export function DashboardCharts({ analytics }: { analytics: DashboardAnalytics }) {
  return <div className="dashboard-charts">
    <ChartCard title="Projects by Reporting Year" description="Completed Online Learning projects grouped by the normalized Reporting field." empty={!analytics.projectsByReportingYear.length}>
      <ResponsiveContainer width="100%" height={300}><BarChart data={analytics.projectsByReportingYear} margin={{ top: 12, right: 12, left: 0, bottom: 4 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" /><YAxis allowDecimals={false} /><Tooltip formatter={(value) => [`${value} completed projects`, "Projects"]} /><Bar dataKey="projects" name="Completed projects" fill="#145b9e" radius={[6,6,0,0]} /></BarChart></ResponsiveContainer>
      <AccessibleTable caption="Completed projects by reporting year" headers={["Reporting year", "Completed projects"]} rows={analytics.projectsByReportingYear.map((row) => [row.label, row.projects])} />
    </ChartCard>

    <ChartCard title="Average Time Spent by Reporting Year" description="Each completed project contributes one total-time value before the yearly average is calculated." empty={!analytics.averageTimeByReportingYear.length} notice={!analytics.metrics.timeDataSynchronized ? "Time-entry synchronization has not completed, so averages are not shown as zero." : undefined}>
      {analytics.metrics.timeDataSynchronized && <ResponsiveContainer width="100%" height={300}><LineChart data={analytics.averageTimeByReportingYear} margin={{ top: 12, right: 22, left: 8, bottom: 4 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" /><YAxis tickFormatter={(minutes) => `${Math.round(Number(minutes) / 60)}h`} /><Tooltip content={<AverageTimeTooltip />} /><Line type="monotone" dataKey="averageMinutes" name="Average hours per project" stroke="#0c8f78" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} /></LineChart></ResponsiveContainer>}
      <AccessibleTable caption="Average project time by reporting year" headers={["Reporting year", "Projects", "Average hours", "Combined hours"]} rows={analytics.averageTimeByReportingYear.map((row) => [row.label, row.projectCount, row.averageMinutes == null ? "Not synchronized" : hours(row.averageMinutes), hours(row.totalMinutes)])} />
    </ChartCard>

    <ChartCard title="Projects by Status" description="Current project status classification by reporting year. Stalled or canceled is the bottom gray segment." empty={!analytics.projectsByStatus.length}>
      <ResponsiveContainer width="100%" height={330}><BarChart data={analytics.projectsByStatus} margin={{ top: 12, right: 12, left: 0, bottom: 4 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" /><YAxis allowDecimals={false} /><Tooltip content={<StatusTooltip />} /><Legend /><Bar dataKey="stalledOrCanceled" name="Stalled or Canceled" stackId="status" fill="#64748b" /><Bar dataKey="active" name="Active or In Progress" stackId="status" fill="#3b82c4" /><Bar dataKey="completed" name="Completed" stackId="status" fill="#0c8f78" radius={[6,6,0,0]} /></BarChart></ResponsiveContainer>
      <AccessibleTable caption="Project status classification by reporting year" headers={["Reporting year", "Stalled or canceled", "Active or in progress", "Completed", "Total"]} rows={analytics.projectsByStatus.map((row) => [row.label, row.stalledOrCanceled, row.active, row.completed, row.total])} />
    </ChartCard>

    <section className="dashboard-donut-grid" aria-label="Project categorical analysis">
      <DonutChart title="Projects by Course Type" data={analytics.courseTypes} />
      <DonutChart title="Projects by Authoring Tool" data={analytics.authoringTools} />
      <DonutChart title="Projects by Vertical" data={analytics.verticals} />
    </section>
  </div>;
}

function ChartCard({ title, description, empty, notice, children }: { title: string; description: string; empty: boolean; notice?: string; children: React.ReactNode }) {
  return <article className="card dashboard-chart" aria-labelledby={`${slug(title)}-title`}><div className="chart-heading"><div><h2 id={`${slug(title)}-title`}>{title}</h2><p>{description}</p></div></div>{notice && <p className="chart-notice">{notice}</p>}{empty ? <p className="chart-empty">No synchronized projects are available for this chart.</p> : children}</article>;
}

function DonutChart({ title, data }: { title: string; data: DashboardCategory[] }) {
  const total = data.reduce((sum, item) => sum + item.projects, 0);
  return <article className="card dashboard-chart donut-card" aria-labelledby={`${slug(title)}-title`}><h2 id={`${slug(title)}-title`}>{title}</h2><p>Each Online Learning project is counted once.</p>{data.length ? <>
    <ResponsiveContainer width="100%" height={260}><PieChart><Pie data={data} dataKey="projects" nameKey="name" innerRadius={58} outerRadius={92} paddingAngle={2}>{data.map((item, index) => <Cell key={item.name} fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]} />)}</Pie><Tooltip formatter={(value, _name, item) => [`${value} projects (${percent(Number(value), total)})`, item.payload.name]} /><Legend verticalAlign="bottom" height={48} /></PieChart></ResponsiveContainer>
    <AccessibleTable caption={title} headers={["Category", "Projects", "Percentage"]} rows={data.map((item) => [item.name, item.projects, percent(item.projects, total)])} />
  </> : <p className="chart-empty">No synchronized projects are available for this chart.</p>}</article>;
}

function AverageTimeTooltip({ active, payload }: { active?: boolean; payload?: { payload: ReportingYearTime }[] }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return <div className="chart-tooltip"><strong>{row.label}</strong><span>Average: {row.averageMinutes == null ? "Not synchronized" : `${hours(row.averageMinutes)} hours per project`}</span><span>Projects: {row.projectCount}</span><span>Combined: {hours(row.totalMinutes)} hours</span></div>;
}

function StatusTooltip({ active, payload }: { active?: boolean; payload?: { dataKey: keyof ReportingYearStatus; name: string; value: number; payload: ReportingYearStatus; color: string }[] }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return <div className="chart-tooltip"><strong>{row.label}</strong>{payload.map((item) => {
    const statuses = item.dataKey === "completed" ? row.completedStatuses : item.dataKey === "active" ? row.activeStatuses : row.stalledStatuses;
    return <span key={String(item.dataKey)}><i style={{ background: item.color }} />{item.name}: {item.value} ({percent(item.value, row.total)})<small>{statuses.length ? statuses.join(", ") : "No synchronized status names"}</small></span>;
  })}</div>;
}

function AccessibleTable({ caption, headers, rows }: { caption: string; headers: string[]; rows: (string | number)[][] }) {
  return <details className="chart-data"><summary>View accessible data</summary><table><caption className="sr-only">{caption}</caption><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={`${row[0]}-${rowIndex}`}>{row.map((value, index) => <td key={`${headers[index]}-${index}`}>{value}</td>)}</tr>)}</tbody></table></details>;
}

const hours = (minutes: number) => (minutes / 60).toLocaleString(undefined, { maximumFractionDigits: 1 });
const percent = (value: number, total: number) => total ? `${(value / total * 100).toFixed(1)}%` : "0%";
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
