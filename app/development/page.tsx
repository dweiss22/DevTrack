import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireContext } from "@/lib/auth";

export default async function DevelopmentPage() {
  const { profile } = await requireContext();
  return <AppShell isAdmin={profile.role === "admin"}><header className="page-header"><div><p className="eyebrow">DEVELOPMENT</p><h1>Development</h1><p>Move from portfolio-level trends into synchronized project work and recorded effort.</p></div></header><section className="chart-grid"><article className="card"><h2>Project workspace</h2><p>Review current statuses, assignees, due dates, folders, and normalized custom fields.</p><Link className="button" href="/projects">View projects</Link></article><article className="card"><h2>Recorded effort</h2><p>Inspect valid Wrike time entries associated with visible projects.</p><Link className="button secondary" href="/time-entries">View time entries</Link></article></section></AppShell>;
}
