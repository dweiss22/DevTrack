"use client";

import React, { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  filterProjectTime,
  groupProjectTimeByCategory,
  groupProjectTimeByContributor,
  groupProjectTimeOverTime,
  projectTimeOptions,
  type ProjectTimeEntry,
  type TimeGrain
} from "@/lib/reporting/project-time";

const COLORS = ["#145b9e", "#0c8f78", "#7c3aed", "#d97706", "#64748b", "#0891b2"];

export function ProjectTimeAnalytics({ entries, plannedMinutes }: { entries: ProjectTimeEntry[]; plannedMinutes: number | null }) {
  const contributors = useMemo(() => projectTimeOptions(entries, "contributor"), [entries]);
  const categories = useMemo(() => projectTimeOptions(entries, "category"), [entries]);
  const actualMinutes = entries.reduce((total, entry) => total + entry.minutes, 0);
  return <section aria-labelledby="project-time-analysis-heading">
    <div className="section-heading"><div><p className="eyebrow">TIME ANALYSIS</p><h2 id="project-time-analysis-heading">Recorded effort</h2></div><p>Each chart can be narrowed independently without changing the project list.</p></div>
    <div className="project-chart-grid">
      <TimelineChart entries={entries} contributors={contributors} categories={categories} />
      <ContributorChart entries={entries} categories={categories} />
      <CategoryChart entries={entries} contributors={contributors} />
      {plannedMinutes != null && <PlannedActualChart plannedMinutes={plannedMinutes} actualMinutes={actualMinutes} />}
    </div>
  </section>;
}

type Option = { id: string; label: string; resolved: boolean };

function TimelineChart({ entries, contributors, categories }: { entries: ProjectTimeEntry[]; contributors: Option[]; categories: Option[] }) {
  const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [grain, setGrain] = useState<TimeGrain>("week");
  const [contributorId, setContributor] = useState(""); const [categoryId, setCategory] = useState("");
  const data = useMemo(() => groupProjectTimeOverTime(filterProjectTime(entries, { from, to, contributorId, categoryId }), grain), [entries, from, to, contributorId, categoryId, grain]);
  return <ChartCard title="Time over time" description="Recorded hours grouped by day, week, or month.">
    <div className="project-chart-filters">
      <DateFilters prefix="timeline" from={from} to={to} setFrom={setFrom} setTo={setTo} />
      <label>Group by<select value={grain} onChange={(event) => setGrain(event.target.value as TimeGrain)}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></select></label>
      <OptionFilter label="Contributor" value={contributorId} setValue={setContributor} options={contributors} allLabel="All contributors" />
      <OptionFilter label="Category" value={categoryId} setValue={setCategory} options={categories} allLabel="All categories" />
    </div>
    <ChartReset active={Boolean(from || to || contributorId || categoryId || grain !== "week")} onReset={() => { setFrom(""); setTo(""); setContributor(""); setCategory(""); setGrain("week"); }} />
    {data.length ? <><div className="project-chart-canvas" role="img" aria-label="Line chart of recorded hours over time"><ResponsiveContainer width="100%" height={250}><LineChart data={data} margin={{ top: 8, right: 12, left: -15, bottom: 8 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip formatter={hoursTooltip} /><Line type="monotone" dataKey="hours" name="Hours" stroke="#145b9e" strokeWidth={3} dot={{ r: 3 }} /></LineChart></ResponsiveContainer></div><AccessibleData title="Time over time data" headers={["Period", "Hours", "Entries"]} rows={data.map((row) => [row.label, formatHours(row.minutes), String(row.entries)])} /></> : <ChartEmpty />}
  </ChartCard>;
}

function ContributorChart({ entries, categories }: { entries: ProjectTimeEntry[]; categories: Option[] }) {
  const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [categoryId, setCategory] = useState("");
  const data = useMemo(() => groupProjectTimeByContributor(filterProjectTime(entries, { from, to, categoryId })), [entries, from, to, categoryId]);
  return <ChartCard title="Time by contributor" description="Recorded effort attributed to synchronized people.">
    <div className="project-chart-filters"><DateFilters prefix="contributor" from={from} to={to} setFrom={setFrom} setTo={setTo} /><OptionFilter label="Category" value={categoryId} setValue={setCategory} options={categories} allLabel="All categories" /></div>
    <ChartReset active={Boolean(from || to || categoryId)} onReset={() => { setFrom(""); setTo(""); setCategory(""); }} />
    {data.length ? <><div className="project-chart-canvas" role="img" aria-label="Bar chart of recorded hours by contributor"><ResponsiveContainer width="100%" height={250}><BarChart data={data} margin={{ top: 8, right: 12, left: -15, bottom: 8 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={data.length > 4 ? -20 : 0} textAnchor={data.length > 4 ? "end" : "middle"} height={data.length > 4 ? 62 : 34} /><YAxis tick={{ fontSize: 11 }} /><Tooltip formatter={hoursTooltip} /><Bar dataKey="hours" name="Hours" radius={[5, 5, 0, 0]}>{data.map((row, index) => <Cell key={row.key} fill={row.resolved ? COLORS[index % COLORS.length] : "#d97706"} />)}</Bar></BarChart></ResponsiveContainer></div><AccessibleData title="Contributor time data" headers={["Contributor", "Hours", "Entries", "Reference"]} rows={data.map((row) => [row.label, formatHours(row.minutes), String(row.entries), row.resolved ? "Resolved" : "Unresolved"])} /></> : <ChartEmpty />}
  </ChartCard>;
}

function CategoryChart({ entries, contributors }: { entries: ProjectTimeEntry[]; contributors: Option[] }) {
  const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [contributorId, setContributor] = useState("");
  const data = useMemo(() => groupProjectTimeByCategory(filterProjectTime(entries, { from, to, contributorId })), [entries, from, to, contributorId]);
  return <ChartCard title="Time by category" description="Recorded effort grouped by synchronized timelog category." className="project-chart-card-wide">
    <div className="project-chart-filters"><DateFilters prefix="category" from={from} to={to} setFrom={setFrom} setTo={setTo} /><OptionFilter label="Contributor" value={contributorId} setValue={setContributor} options={contributors} allLabel="All contributors" /></div>
    <ChartReset active={Boolean(from || to || contributorId)} onReset={() => { setFrom(""); setTo(""); setContributor(""); }} />
    {data.length ? <><div className="project-chart-canvas" role="img" aria-label="Bar chart of recorded hours by category"><ResponsiveContainer width="100%" height={250}><BarChart data={data} margin={{ top: 8, right: 12, left: -15, bottom: 8 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={data.length > 4 ? -20 : 0} textAnchor={data.length > 4 ? "end" : "middle"} height={data.length > 4 ? 62 : 34} /><YAxis tick={{ fontSize: 11 }} /><Tooltip formatter={hoursTooltip} /><Bar dataKey="hours" name="Hours" radius={[5, 5, 0, 0]}>{data.map((row, index) => <Cell key={row.key} fill={row.resolved ? COLORS[index % COLORS.length] : "#d97706"} />)}</Bar></BarChart></ResponsiveContainer></div><AccessibleData title="Category time data" headers={["Category", "Hours", "Entries", "Reference"]} rows={data.map((row) => [row.label, formatHours(row.minutes), String(row.entries), row.resolved ? "Resolved" : "Unresolved"])} /></> : <ChartEmpty />}
  </ChartCard>;
}

function PlannedActualChart({ plannedMinutes, actualMinutes }: { plannedMinutes: number; actualMinutes: number }) {
  const data = [{ label: "Planned", hours: plannedMinutes / 60, minutes: plannedMinutes }, { label: "Actual", hours: actualMinutes / 60, minutes: actualMinutes }];
  return <ChartCard title="Planned vs. actual" description="Wrike planned effort compared with visible recorded time.">
    <div className="project-chart-canvas" role="img" aria-label="Bar chart comparing planned and actual hours"><ResponsiveContainer width="100%" height={250}><BarChart data={data} margin={{ top: 8, right: 12, left: -15, bottom: 8 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" /><YAxis /><Tooltip formatter={hoursTooltip} /><Bar dataKey="hours" name="Hours" radius={[5, 5, 0, 0]}><Cell fill="#78a7df" /><Cell fill="#145b9e" /></Bar></BarChart></ResponsiveContainer></div>
    <AccessibleData title="Planned and actual effort data" headers={["Effort", "Hours"]} rows={data.map((row) => [row.label, formatHours(row.minutes)])} />
  </ChartCard>;
}

function ChartCard({ title, description, children, className = "" }: { title: string; description: string; children: React.ReactNode; className?: string }) {
  return <article className={`card project-chart-card ${className}`.trim()}><h3>{title}</h3><p>{description}</p>{children}</article>;
}

function DateFilters({ prefix, from, to, setFrom, setTo }: { prefix: string; from: string; to: string; setFrom: (value: string) => void; setTo: (value: string) => void }) {
  return <><label htmlFor={`${prefix}-from`}>From<input id={`${prefix}-from`} type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} /></label><label htmlFor={`${prefix}-to`}>To<input id={`${prefix}-to`} type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} /></label></>;
}

function OptionFilter({ label, value, setValue, options, allLabel }: { label: string; value: string; setValue: (value: string) => void; options: Option[]; allLabel: string }) {
  return <label>{label}<select value={value} onChange={(event) => setValue(event.target.value)}><option value="">{allLabel}</option>{options.map((option) => <option value={option.id} key={option.id}>{option.resolved ? option.label : `${option.label} (unresolved)`}</option>)}</select></label>;
}

function ChartReset({ active, onReset }: { active: boolean; onReset: () => void }) {
  return active ? <button className="link-button project-chart-reset" type="button" onClick={onReset}>Reset chart filters</button> : null;
}

function ChartEmpty() { return <p className="chart-empty">No visible time entries match this chart’s filters.</p>; }

function AccessibleData({ title, headers, rows }: { title: string; headers: string[]; rows: string[][] }) {
  return <details className="chart-data"><summary>View accessible data</summary><table><caption className="sr-only">{title}</caption><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${row[0]}-${index}`}>{row.map((value, cell) => <td key={`${cell}-${value}`}>{value}</td>)}</tr>)}</tbody></table></details>;
}

const formatHours = (minutes: number) => `${(minutes / 60).toLocaleString(undefined, { maximumFractionDigits: 2 })} h`;
const hoursTooltip = (value: number | string) => [`${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })} h`, "Hours"];
