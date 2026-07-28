"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export type SmeManagementRow = {
  wrike_user_id: string; application_user_id: string | null; display_name: string; email: string | null;
  mapping_status: string; coordinator: boolean; assigned_projects: number; active_projects: number;
  completed_projects: number; stalled_projects: number; submitted_surveys: number;
  billable_hours: number; invoiced_amount: number;
};
type IdentityOption = { id: string; name: string; email: string | null };

export function SmeManagementPanel({ rows, identities }: { rows: SmeManagementRow[]; identities: IdentityOption[] }) {
  const router = useRouter(); const [query, setQuery] = useState(""); const [message, setMessage] = useState("");
  const [error, setError] = useState(false); const [working, setWorking] = useState("");
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized ? rows.filter((row) => `${row.display_name} ${row.email ?? ""}`.toLowerCase().includes(normalized)) : rows;
  }, [query, rows]);
  async function request(url: string, method: string, body: unknown, success: string) {
    setWorking(url); setMessage(""); setError(false);
    try {
      const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(payload.error ?? "The SME-management action could not be completed.");
      setMessage(payload.message ?? success); router.refresh();
    } catch (reason) { setError(true); setMessage(reason instanceof Error ? reason.message : "The action could not be completed."); }
    finally { setWorking(""); }
  }
  function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const email = String(form.get("email") ?? "");
    void request("/api/sme-management/users/invitations", "POST", { email }, `${email.trim().toLowerCase()} was invited as an SME.`);
    event.currentTarget.reset();
  }
  const totals = rows.reduce((sum, row) => ({
    projects: sum.projects + Number(row.assigned_projects), surveys: sum.surveys + Number(row.submitted_surveys),
    hours: sum.hours + Number(row.billable_hours), amount: sum.amount + Number(row.invoiced_amount),
  }), { projects: 0, surveys: 0, hours: 0, amount: 0 });
  return <div className="admin-stack">
    {message && <p className={error ? "notice error" : "notice"} role={error ? "alert" : "status"}>{message}</p>}
    <div className="metric-grid sme-management-metrics">
      <article className="card metric-card"><span>SME identities</span><strong>{rows.length}</strong></article>
      <article className="card metric-card"><span>Assignments</span><strong>{totals.projects}</strong></article>
      <article className="card metric-card"><span>Submitted debriefs</span><strong>{totals.surveys}</strong></article>
      <article className="card metric-card"><span>Billable hours</span><strong>{totals.hours.toLocaleString()}</strong></article>
      <article className="card metric-card"><span>Invoiced</span><strong>{currency(totals.amount)}</strong></article>
    </div>
    <section className="card"><div className="section-heading"><div><p className="eyebrow">SCOPED ACCESS</p><h2>Invite SME</h2></div>
      <p>Creates SME-only access. Management grants, impersonation, and deletion remain administrator-controlled.</p></div>
      <form className="user-invite-form" onSubmit={invite}><label>Email address<input name="email" type="email" required maxLength={320} /></label>
        <button disabled={Boolean(working)}>{working.includes("invitations") ? "Inviting…" : "Invite SME"}</button></form></section>
    <section className="card"><div className="section-heading"><div><p className="eyebrow">ALL SMEs</p><h2>SME oversight</h2></div>
      <label className="sme-management-search">Search<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or email" /></label></div>
      {visible.length ? <div className="admin-table-wrap"><table><thead><tr><th>SME</th><th>Mapping</th><th>Projects</th><th>Surveys</th><th>Billing</th><th>Access</th></tr></thead>
        <tbody>{visible.map((row) => <tr key={row.wrike_user_id}><td><strong>{row.display_name}</strong>{row.email ? <><br /><span className="muted">{row.email}</span></> : null}
          {row.coordinator ? <><br /><span className="role-chip">SME Coordinator</span></> : null}</td>
          <td>{row.application_user_id ? <select aria-label={`Wrike identity for ${row.display_name}`} value={row.wrike_user_id}
            disabled={Boolean(working)} onChange={(event) => void request(`/api/sme-management/users/${row.application_user_id}/identity`, "PATCH",
              { wrikeUserId: event.target.value }, `Identity updated for ${row.display_name}.`)}>
            {identities.map((identity) => <option key={identity.id} value={identity.id}>{identity.name}{identity.email ? ` (${identity.email})` : ""}</option>)}</select>
            : <span className="notice warning compact">No DevTrack account</span>}</td>
          <td>{row.assigned_projects} total<br /><span className="muted">{row.active_projects} active · {row.completed_projects} completed · {row.stalled_projects} stalled/canceled</span></td>
          <td>{row.submitted_surveys} submitted</td><td>{Number(row.billable_hours).toLocaleString()} h<br /><span className="muted">{currency(Number(row.invoiced_amount))}</span></td>
          <td><Link className="button secondary" href={`/sme-dashboard?sme=${encodeURIComponent(row.wrike_user_id)}&scope=recent`}>View dashboard</Link></td>
        </tr>)}</tbody></table></div> : <p className="empty">No SME identities match this search.</p>}</section>
  </div>;
}
const currency = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
