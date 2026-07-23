import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requirePageCapability } from "@/lib/auth";
import { isAdministratorRole } from "@/lib/auth/roles";

export default async function OtherTeamsPage() {
  const { profile } = await requirePageCapability("view_standard_pages");
  return <AppShell isAdmin={isAdministratorRole(profile.role)}><header className="page-header"><div><p className="eyebrow">OTHER TEAMS</p><h1>Other Teams</h1><p>Shared reporting entry points for work outside the primary Development and SME views.</p></div></header><section className="card"><h2>Cross-team project data</h2><p>Use Projects to review all work permitted by your reporting-group access. Team-specific dashboards can be added here without changing the synchronized Wrike source data.</p><Link className="button" href="/projects">Open projects</Link></section></AppShell>;
}
