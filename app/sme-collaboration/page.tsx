import { AppShell } from "@/components/app-shell";
import { ReportFilters } from "@/components/report-filters";
import { UnresolvedReferenceLabel } from "@/components/wrike-reference";
import { requirePageCapability } from "@/lib/auth";
import { isAdministratorRole } from "@/lib/auth/roles";
import { hours } from "@/lib/metrics";
import { loadTimeSummary } from "@/lib/reporting/data";
import { parseReportingFilters } from "@/lib/reporting/filters";
import { loadReportingOptions } from "@/lib/reporting/options";

export default async function SmeCollaborationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filters = parseReportingFilters(await searchParams);
  const { supabase, profile } = await requirePageCapability("view_standard_pages");
  const [summary, options] = await Promise.all([loadTimeSummary(supabase, filters, "person"), loadReportingOptions(supabase, profile.organization_id)]);
  return <AppShell isAdmin={isAdministratorRole(profile.role)}><header className="page-header"><div><p className="eyebrow">SME COLLABORATION</p><h1>SME Collaboration</h1><p>Visible collaboration effort summarized from synchronized Wrike timelogs.</p></div></header><ReportFilters filters={filters} {...options} includeTime={false} />{summary.length ? <table><thead><tr><th>Collaborator</th><th>Time entries</th><th>Recorded hours</th><th>Average entry</th></tr></thead><tbody>{summary.map((row) => <tr key={row.group_key}><td>{row.resolved === false && row.wrike_user_id ? <UnresolvedReferenceLabel id={row.wrike_user_id} type="user" /> : row.label}</td><td>{row.entry_count}</td><td>{hours(row.minutes)}</td><td>{hours(row.minutes / Math.max(1,row.entry_count))}</td></tr>)}</tbody></table> : <p className="card empty">No visible SME collaboration time matches these filters.</p>}</AppShell>;
}
