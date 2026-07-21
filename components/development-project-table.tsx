"use client";
import React from "react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { StatusBadge, UnresolvedReferenceLabel } from "@/components/wrike-reference";
import { developmentFiltersToQuery, type DevelopmentFilters, type DevelopmentProjectRow } from "@/lib/reporting/development";
import { verticalStateLabel } from "@/lib/wrike/vertical-normalization";

type CustomColumn = { key: string; label: string };
const CORE_COLUMNS = [
  ["title","Project"],["year","Reporting year"],["status","Custom status"],["completion","Completion"],["verticals","Associated Vertical"],["verticalCategory","Vertical Reporting Category"],["assignees","Assigned team"],["priority","Priority"],["start","Start"],["due","Due"],["completed","Completed"],["hours","Hours"],["location","Location"],["wrike","Wrike"],["updated","Last updated"]
] as const;
const DEFAULT_COLUMNS = CORE_COLUMNS.map(([key]) => key);

export function DevelopmentProjectTable({ rows, total, filters, customColumns }: { rows: DevelopmentProjectRow[]; total: number; filters: DevelopmentFilters; customColumns: CustomColumn[] }) {
  const available = useMemo(() => [...CORE_COLUMNS.map(([key,label]) => ({ key, label })), ...customColumns.map((column) => ({ ...column, key: `custom:${column.key}` }))], [customColumns]);
  const [visible, setVisible] = useState<string[]>([...DEFAULT_COLUMNS, ...customColumns.map((column) => `custom:${column.key}`)]);
  useEffect(() => { const saved = window.localStorage.getItem("devtrack-development-columns"); if (saved) { try { const parsed = JSON.parse(saved) as string[]; setVisible(parsed.filter((key) => available.some((column) => column.key === key))); } catch { /* Ignore stale browser preferences. */ } } }, [available]);
  const toggle = (key: string) => setVisible((current) => { const next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key]; window.localStorage.setItem("devtrack-development-columns", JSON.stringify(next)); return next; });
  const currentHref = `/development?${developmentFiltersToQuery(filters)}`;
  return <>
    <div className="project-list-toolbar"><div><h2>Reporting-year project list</h2><p>{total.toLocaleString()} matching course{total === 1 ? "" : "s"}</p></div><details className="column-picker"><summary className="button secondary">Visible columns</summary><div>{available.map((column) => <label className="check" key={column.key}><input type="checkbox" checked={visible.includes(column.key)} onChange={() => toggle(column.key)} />{column.label}</label>)}</div></details></div>
    {rows.length ? <div className="development-table-wrap"><table className="development-project-table"><thead><tr>{available.filter((column) => visible.includes(column.key)).map((column) => <th key={column.key}>{sortableKey(column.key) ? <Link href={sortHref(filters, sortableKey(column.key)!)}>{column.label}{filters.sort === sortableKey(column.key) ? " ↓" : ""}</Link> : column.label}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.taskId}>{available.filter((column) => visible.includes(column.key)).map((column) => <td key={column.key}>{cell(row, column.key, currentHref)}</td>)}</tr>)}</tbody></table></div> : <p className="empty">No projects match the selected reporting year and filters.</p>}
    <DevelopmentPagination filters={filters} total={total} />
  </>;
}

function cell(row: DevelopmentProjectRow, key: string, returnTo: string): React.ReactNode {
  if (key.startsWith("custom:")) return <CustomValues field={row.customValues[key.slice(7)]} />;
  const vertical = Object.values(row.customValues).find((field) => field.title.trim().toLocaleLowerCase() === "vertical");
  switch (key) {
    case "title": return <Link href={`/projects/${row.taskId}?returnTo=${encodeURIComponent(returnTo)}&returnLabel=Development`}>{row.title}</Link>;
    case "year": return row.reportingYear ?? "Missing/Unresolved";
    case "status": return row.status.resolved ? <StatusBadge name={row.status.name} id={row.status.id} color={row.status.color} /> : <span className="status-badge unresolved"><UnresolvedReferenceLabel id={row.status.id} type="custom_status" label="Unknown Status" /></span>;
    case "completion": return <span className={`classification-badge ${row.completionClassification}`}>{title(row.completionClassification)}{row.statusUnmapped ? " · Mapping review" : ""}</span>;
    case "verticals": return <span title={vertical?.hasUnresolvedVertical ? "Vertical value needs review" : undefined}>{vertical?.normalizedVerticals?.join(", ") || vertical?.values.join(", ") || "—"}{vertical?.hasUnresolvedVertical ? " ⚠" : ""}</span>;
    case "verticalCategory": return row.verticalState ? verticalStateLabel(row.verticalState) : vertical?.verticalReportingCategory ?? "Vertical data not fully synchronized";
    case "assignees": return row.assignees.length ? row.assignees.map((user,index) => <span key={user.id}>{index ? ", " : ""}{user.resolved ? user.name : <UnresolvedReferenceLabel id={user.id} type="user" label="Unresolved user" />}</span>) : "—";
    case "priority": return row.priority ?? "—"; case "start": return date(row.startDate); case "due": return date(row.dueDate); case "completed": return date(row.completedAt);
    case "hours": return (row.actualMinutes / 60).toLocaleString(undefined,{ maximumFractionDigits: 1 });
    case "location": return row.locations.length ? row.locations.map((location,index) => <span key={location.id}>{index ? ", " : ""}{location.resolved ? location.name : <UnresolvedReferenceLabel id={location.id} type="folder" label="Unresolved location" />}</span>) : "—";
    case "wrike": return row.permalink ? <a href={row.permalink} target="_blank" rel="noreferrer">Open</a> : "—";
    case "updated": return date(row.updatedAt); default: return "—";
  }
}
function CustomValues({ field }: { field?: DevelopmentProjectRow["customValues"][string] }) { if (!field?.values.length) return "—"; return <span title={field.conflict ? "Conflicting normalized source values" : undefined}>{field.values.map((value,index) => { const match=value.match(/^Unresolved field value \((.+)\)$/); return <span key={`${value}-${index}`}>{index ? ", " : ""}{match ? <UnresolvedReferenceLabel id={match[1]} type="user" label="Unresolved field value" /> : value}</span>; })}{field.conflict ? " ⚠" : ""}</span>; }
function DevelopmentPagination({ filters, total }: { filters: DevelopmentFilters; total: number }) { const pages=Math.max(1,Math.ceil(total/filters.pageSize)); if (pages<=1) return null; const href=(page:number)=>`/development?${developmentFiltersToQuery({...filters,page})}`; return <nav className="pagination" aria-label="Development project pages"><span>Page {filters.page} of {pages} · {total} records</span><div>{filters.page>1&&<Link className="button secondary" href={href(filters.page-1)}>Previous</Link>}{filters.page<pages&&<Link className="button secondary" href={href(filters.page+1)}>Next</Link>}</div></nav>; }
function sortHref(filters: DevelopmentFilters, sort: DevelopmentFilters["sort"]) { return `/development?${developmentFiltersToQuery({ ...filters, sort, page: 1 })}`; }
function sortableKey(key: string): DevelopmentFilters["sort"] | null { return ({ title:"title",status:"status",priority:"priority",start:"start",due:"due",completed:"completed",hours:"actual",updated:"updated" } as Record<string,DevelopmentFilters["sort"]>)[key] ?? null; }
function date(value: string | null) { return value ? new Date(value).toLocaleDateString() : "—"; }
function title(value: string) { return value.charAt(0).toUpperCase()+value.slice(1); }
