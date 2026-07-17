import { AppShell } from "@/components/app-shell";
import { ReportFilters } from "@/components/report-filters";
import { requireContext } from "@/lib/auth";
import { loadTimeSummary } from "@/lib/reporting/data";
import { parseReportingFilters } from "@/lib/reporting/filters";
import { loadReportingOptions } from "@/lib/reporting/options";
import { hours } from "@/lib/metrics";
import { UnresolvedReferenceLabel } from "@/components/wrike-reference";

export default async function TeamPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filters = parseReportingFilters(await searchParams); const { supabase, profile } = await requireContext(); const [summary, options] = await Promise.all([loadTimeSummary(supabase, filters, "person"), loadReportingOptions(supabase, profile.organization_id)]);
  return <AppShell isAdmin={profile.role === "admin"}><header className="page-header"><div><p className="eyebrow">TEAM MEMBERS</p><h1>Visible workload distribution</h1><p>Time is attributed to each visible timelog author.</p></div></header><ReportFilters filters={filters} {...options} includeTime={false} />{summary.length ? <table><thead><tr><th>Team member</th><th>Time entries</th><th>Recorded hours</th><th>Average entry</th></tr></thead><tbody>{summary.map((row) => <tr key={row.group_key}><td>{row.resolved === false && row.wrike_user_id ? <UnresolvedReferenceLabel id={row.wrike_user_id} type="user" /> : row.label}</td><td>{row.entry_count}</td><td>{hours(row.minutes)}</td><td>{hours(row.minutes / Math.max(1, row.entry_count))}</td></tr>)}</tbody></table> : <p className="card empty">No visible team time matches these filters.</p>}</AppShell>;
}
