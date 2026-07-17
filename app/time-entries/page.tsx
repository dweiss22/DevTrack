import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Pagination } from "@/components/pagination";
import { ReportFilters } from "@/components/report-filters";
import { StatusBadge, UnresolvedReferenceLabel } from "@/components/wrike-reference";
import { requireContext } from "@/lib/auth";
import { hours } from "@/lib/metrics";
import { loadTimeRows } from "@/lib/reporting/data";
import { parseReportingFilters } from "@/lib/reporting/filters";
import { loadReportingOptions } from "@/lib/reporting/options";

export default async function TimeEntriesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filters = parseReportingFilters(await searchParams); const { supabase, profile } = await requireContext();
  const [entries, options] = await Promise.all([loadTimeRows(supabase, filters), loadReportingOptions(supabase, profile.organization_id)]);
  const total = entries[0]?.total_count ?? 0;
  return <AppShell><header className="page-header"><div><p className="eyebrow">TIME ENTRIES</p><h1>Recorded time</h1><p>Actual time follows Wrike’s tracked date and your reporting access.</p></div></header><ReportFilters filters={filters} {...options} includeTime={false} />{entries.length ? <><table><thead><tr><th>Date</th><th>Employee</th><th>Task</th><th>Status</th><th>Hours</th><th>Category</th><th>Comment</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.entry_id}><td>{entry.entry_date}</td><td>{entry.user_reference ? entry.user_reference.resolved ? entry.user_reference.fullName : <UnresolvedReferenceLabel id={entry.user_reference.wrikeUserId} type="user" /> : "Unknown"}</td><td><Link href={`/tasks/${entry.task_id}`}>{entry.task_title}</Link></td><td><StatusBadge name={entry.task_status_name} id={entry.status_reference.wrikeCustomStatusId} color={entry.status_reference.color} resolved={entry.status_reference.resolved} /></td><td>{hours(entry.minutes)}</td><td>{entry.category_reference ? entry.category_reference.resolved ? entry.category_reference.name : <UnresolvedReferenceLabel id={entry.category_reference.wrikeCategoryId} type="timelog_category" /> : "—"}</td><td>{entry.comment ?? "—"}</td></tr>)}</tbody></table><Pagination filters={filters} total={total} /></> : <p className="card empty">No visible time entries match these filters.</p>}</AppShell>;
}
