"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DashboardAnalytics, DashboardCategory, ReportingYearCount, ReportingYearStatus, ReportingYearTime } from "@/lib/reporting/dashboard";
import { assignedDashboardRows, dashboardDrilldownHref, type DashboardClassification, type DashboardField } from "@/lib/reporting/dashboard-navigation";
import type { ReportingFilters } from "@/lib/reporting/filters";

const CATEGORY_COLORS = ["#145b9e", "#0c8f78", "#7c3aed", "#d97706", "#dc4c64", "#64748b", "#0891b2", "#65a30d"];

export function DashboardCharts({ analytics, filters }: { analytics: DashboardAnalytics; filters: ReportingFilters }) {
  const router = useRouter();
  const projectsByReportingYear = assignedDashboardRows(analytics.projectsByReportingYear, "label");
  const averageTimeByReportingYear = assignedDashboardRows(analytics.averageTimeByReportingYear, "label");
  const projectsByStatus = assignedDashboardRows(analytics.projectsByStatus, "label");
  return <div className="dashboard-charts">
    <ChartCard title="Projects by Reporting Year" description="Completed Online Learning projects grouped by the normalized Reporting field. Select a bar to view its projects." empty={!projectsByReportingYear.length}>
      <ResponsiveContainer width="100%" height={300}><BarChart data={projectsByReportingYear} margin={{ top: 12, right: 12, left: 0, bottom: 4 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" /><YAxis allowDecimals={false} /><Tooltip formatter={(value) => [`${value} completed projects`, "Projects"]} /><Bar dataKey="projects" name="Completed projects" fill="#145b9e" radius={[6,6,0,0]} onClick={(entry) => navigateToYear(router.push, filters, chartRow<ReportingYearCount>(entry)?.label, "completed")} /></BarChart></ResponsiveContainer>
      <AccessibleTable caption="Completed projects by reporting year" headers={["Reporting year", "Completed projects"]} rows={projectsByReportingYear.map((row) => [<DrilldownLink href={yearHref(filters, row.label, "completed")} label={row.label} />, row.projects])} />
    </ChartCard>

    <ChartCard title="Average Time Spent by Reporting Year" description="Each completed project contributes one total-time value before the yearly average is calculated. Select a point to view its projects." empty={!averageTimeByReportingYear.length} notice={!analytics.metrics.timeDataSynchronized ? "Time-entry synchronization has not completed, so averages are not shown as zero." : undefined}>
      {analytics.metrics.timeDataSynchronized && <ResponsiveContainer width="100%" height={300}><LineChart data={averageTimeByReportingYear} margin={{ top: 12, right: 22, left: 8, bottom: 4 }} onClick={(state) => navigateToYear(router.push, filters, state?.activeLabel, "completed")}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" /><YAxis tickFormatter={(minutes) => `${Math.round(Number(minutes) / 60)}h`} /><Tooltip content={<AverageTimeTooltip />} /><Line type="monotone" dataKey="averageMinutes" name="Average hours per project" stroke="#0c8f78" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} /></LineChart></ResponsiveContainer>}
      <AccessibleTable caption="Average project time by reporting year" headers={["Reporting year", "Projects", "Average hours", "Combined hours"]} rows={averageTimeByReportingYear.map((row) => [<DrilldownLink href={yearHref(filters, row.label, "completed")} label={row.label} />, row.projectCount, row.averageMinutes == null ? "Not synchronized" : hours(row.averageMinutes), hours(row.totalMinutes)])} />
    </ChartCard>

    <ChartCard title="Projects by Status" description="Current project status classification by reporting year. Select a segment to view its projects." empty={!projectsByStatus.length}>
      <ResponsiveContainer width="100%" height={330}><BarChart data={projectsByStatus} margin={{ top: 12, right: 12, left: 0, bottom: 4 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" /><YAxis allowDecimals={false} /><Tooltip content={<StatusTooltip />} /><Legend /><Bar dataKey="stalledOrCanceled" name="Stalled or Canceled" stackId="status" fill="#64748b" onClick={(entry) => navigateToStatus(router.push, filters, chartRow<ReportingYearStatus>(entry)?.label, "stalled_or_canceled")} /><Bar dataKey="active" name="Active or In Progress" stackId="status" fill="#3b82c4" onClick={(entry) => navigateToStatus(router.push, filters, chartRow<ReportingYearStatus>(entry)?.label, "active")} /><Bar dataKey="completed" name="Completed" stackId="status" fill="#0c8f78" radius={[6,6,0,0]} onClick={(entry) => navigateToStatus(router.push, filters, chartRow<ReportingYearStatus>(entry)?.label, "completed")} /></BarChart></ResponsiveContainer>
      <StatusAccessibleTable filters={filters} data={projectsByStatus} />
    </ChartCard>

    <section className="dashboard-donut-grid" aria-label="Project categorical analysis">
      <DonutChart title="Projects by Course Type" field="course type" data={assignedDashboardRows(analytics.courseTypes, "name")} filters={filters} />
      <DonutChart title="Projects by Authoring Tool" field="authoring tool" data={assignedDashboardRows(analytics.authoringTools, "name")} filters={filters} />
      <DonutChart title="Projects by Vertical" field="vertical" data={assignedDashboardRows(analytics.verticals, "name")} filters={filters} />
    </section>
  </div>;
}

function ChartCard({ title, description, empty, notice, children }: { title: string; description: string; empty: boolean; notice?: string; children: React.ReactNode }) {
  return <article className="card dashboard-chart" aria-labelledby={`${slug(title)}-title`}><div className="chart-heading"><div><h2 id={`${slug(title)}-title`}>{title}</h2><p>{description}</p></div></div>{notice && <p className="chart-notice">{notice}</p>}{empty ? <p className="chart-empty">No assigned project values are available for this chart.</p> : children}</article>;
}

function DonutChart({ title, field, data, filters }: { title: string; field: DashboardField; data: DashboardCategory[]; filters: ReportingFilters }) {
  const router = useRouter();
  const total = data.reduce((sum, item) => sum + item.projects, 0);
  return <article className="card dashboard-chart donut-card" aria-labelledby={`${slug(title)}-title`}><h2 id={`${slug(title)}-title`}>{title}</h2><p>Each Online Learning project is counted once. Select a slice to view its projects.</p>{data.length ? <>
    <ResponsiveContainer width="100%" height={260}><PieChart><Pie data={data} dataKey="projects" nameKey="name" innerRadius={58} outerRadius={92} paddingAngle={2} onClick={(entry) => { const row = chartRow<DashboardCategory>(entry); if (row) router.push(categoryHref(filters, field, row.name)); }}>{data.map((item, index) => <Cell key={item.name} fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]} />)}</Pie><Tooltip formatter={(value, _name, item) => [`${value} projects (${percent(Number(value), total)})`, item.payload.name]} /><Legend verticalAlign="bottom" height={48} /></PieChart></ResponsiveContainer>
    <AccessibleTable caption={title} headers={["Category", "Projects", "Percentage"]} rows={data.map((item) => [<DrilldownLink href={categoryHref(filters, field, item.name)} label={item.name} />, item.projects, percent(item.projects, total)])} />
  </> : <p className="chart-empty">No assigned project values are available for this chart.</p>}</article>;
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

function StatusAccessibleTable({ filters, data }: { filters: ReportingFilters; data: ReportingYearStatus[] }) {
  return <AccessibleTable caption="Project status classification by reporting year" headers={["Reporting year", "Stalled or canceled", "Active or in progress", "Completed", "Total"]} rows={data.map((row) => [row.label, <DrilldownLink href={yearHref(filters, row.label, "stalled_or_canceled")} label={String(row.stalledOrCanceled)} />, <DrilldownLink href={yearHref(filters, row.label, "active")} label={String(row.active)} />, <DrilldownLink href={yearHref(filters, row.label, "completed")} label={String(row.completed)} />, row.total])} />;
}

function AccessibleTable({ caption, headers, rows }: { caption: string; headers: string[]; rows: React.ReactNode[][] }) {
  return <details className="chart-data"><summary>View accessible data</summary><table><caption className="sr-only">{caption}</caption><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={`${row[0]}-${rowIndex}`}>{row.map((value, index) => <td key={`${headers[index]}-${index}`}>{value}</td>)}</tr>)}</tbody></table></details>;
}

function DrilldownLink({ href, label }: { href: string; label: string }) {
  return <Link href={href}>{label}</Link>;
}

function chartRow<T>(entry: unknown): T | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  return ((entry as { payload?: T }).payload ?? entry) as T;
}

function navigateToYear(push: (href: string) => void, filters: ReportingFilters, label: string | number | undefined, classification?: DashboardClassification) {
  const year = Number(label);
  if (Number.isInteger(year)) push(dashboardDrilldownHref(filters, { kind: "year", year, classification }));
}

function navigateToStatus(push: (href: string) => void, filters: ReportingFilters, label: string | undefined, classification: DashboardClassification) {
  navigateToYear(push, filters, label, classification);
}

const yearHref = (filters: ReportingFilters, label: string, classification?: DashboardClassification) => dashboardDrilldownHref(filters, { kind: "year", year: Number(label), classification });
const categoryHref = (filters: ReportingFilters, field: DashboardField, value: string) => dashboardDrilldownHref(filters, { kind: "category", field, value });
const hours = (minutes: number) => (minutes / 60).toLocaleString(undefined, { maximumFractionDigits: 1 });
const percent = (value: number, total: number) => total ? `${(value / total * 100).toFixed(1)}%` : "0%";
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
