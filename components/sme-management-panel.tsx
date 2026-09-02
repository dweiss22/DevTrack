"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { smeClassificationLabel, type SmeClassification } from "@/lib/smes/domain";
import { SmeProjectFolder } from "@/components/sme-project-folder";

export type SmeManagementRow = {
  sme_identity_id: string; wrike_user_id: string | null; application_user_id: string | null;
  display_name: string; email: string | null;
  mapping_status: string; coordinator: boolean; assigned_projects: number; active_projects: number;
  completed_projects: number; stalled_projects: number; submitted_surveys: number;
  billable_hours: number; invoiced_amount: number;
  sme_classification: SmeClassification | null;
  sme_classification_updated_at: string | null;
  project_folder_url: string | null;
};
type SmeIdentityOption = {
  id: string; name: string; normalizedName: string;
  resolutionStatus: "discovered" | "verified" | "ambiguous" | "resolved";
  ambiguityReason: string | null; wrikeUserId: string | null;
  applicationUserId: string | null;
};

export function SmeManagementPanel({ rows, identities }: { rows: SmeManagementRow[]; identities: SmeIdentityOption[] }) {
  const router = useRouter(); const [query, setQuery] = useState(""); const [message, setMessage] = useState("");
  const [error, setError] = useState(false); const [working, setWorking] = useState("");
  const [newSmeNameDrafts, setNewSmeNameDrafts] = useState<Record<string, string>>({});
  const NEW_SME_NAME_OPTION = "__new__";
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
  function linkSmeIdentity(row: SmeManagementRow, identityId: string) {
    if (!row.application_user_id) return;
    const identity = identities.find((option) => option.id === identityId);
    if (!identity) return;
    const replacing = Boolean(row.sme_identity_id && row.sme_identity_id !== identity.id)
      || Boolean(identity.applicationUserId && identity.applicationUserId !== row.application_user_id)
      || identity.resolutionStatus === "ambiguous";
    const confirmed = !replacing || window.confirm(
      `Confirm linking ${row.display_name} to the field-derived SME identity “${identity.name}”. `
      + "This replaces the existing linkage or resolves an ambiguous match; project and survey history will remain attached to the SME identity."
    );
    if (!confirmed) return;
    void request(`/api/admin/users/${row.application_user_id}/sme-identity`, "PATCH", {
      smeIdentityId: identity.id, confirmReplacement: replacing,
    }, `${row.display_name} is now linked to ${identity.name}.`);
  }
  function reserveAndLinkSmeIdentity(row: SmeManagementRow) {
    if (!row.application_user_id) return;
    const newDisplayName = (newSmeNameDrafts[row.application_user_id] ?? "").trim();
    if (!newDisplayName) return;
    const replacing = Boolean(row.sme_identity_id);
    const confirmed = !replacing || window.confirm(
      `Confirm linking ${row.display_name} to a new SME identity reserved for “${newDisplayName}”. `
      + "This replaces the existing linkage; project and survey history will remain attached to the prior SME identity."
    );
    if (!confirmed) return;
    void request(`/api/admin/users/${row.application_user_id}/sme-identity`, "PATCH", {
      newDisplayName, confirmReplacement: replacing,
    }, `${row.display_name} is now linked to a reserved identity for “${newDisplayName}”. `
      + "This SME's projects will appear automatically once that exact name is typed into a Wrike project's SME field.");
    setNewSmeNameDrafts((current) => { const next = { ...current }; delete next[row.application_user_id as string]; return next; });
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
      <p>Creates SME-only access with “SME type not configured.” An Admin must classify the account before debrief submission.</p></div>
      <form className="user-invite-form" onSubmit={invite}><label>Email address<input name="email" type="email" required maxLength={320} /></label>
        <button disabled={Boolean(working)}>{working.includes("invitations") ? "Inviting…" : "Invite SME"}</button></form></section>
    <section className="card"><div className="section-heading"><div><p className="eyebrow">ALL SMEs</p><h2>SME oversight</h2></div>
      <label className="sme-management-search">Search<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or email" /></label></div>
      {visible.length ? <div className="admin-table-wrap"><table><thead><tr><th>SME</th><th>SME type</th><th>Field-derived identity</th><th>Project folder</th><th>Projects</th><th>Surveys</th><th>Billing</th><th>Access</th></tr></thead>
        <tbody>{visible.map((row) => {
          const draftingNewName = row.application_user_id ? newSmeNameDrafts[row.application_user_id] !== undefined : false;
          return <tr key={row.sme_identity_id}><td><strong>{row.display_name}</strong>{row.email ? <><br /><span className="muted">{row.email}</span></> : null}
          {row.coordinator ? <><br /><span className="role-chip">SME Coordinator</span></> : null}</td>
          <td>{row.application_user_id ? <>{smeClassificationLabel(row.sme_classification)}
            {row.sme_classification_updated_at ? <><br /><span className="muted">
              Updated {new Date(row.sme_classification_updated_at).toLocaleDateString()}
            </span></> : null}</> : <span className="muted">No DevTrack account</span>}</td>
          <td>{row.application_user_id ? <><select aria-label={`Field-derived SME identity for ${row.display_name}`}
            value={draftingNewName ? NEW_SME_NAME_OPTION : row.sme_identity_id}
            disabled={Boolean(working)}
            onChange={(event) => event.target.value === NEW_SME_NAME_OPTION
              ? setNewSmeNameDrafts((current) => ({ ...current, [row.application_user_id as string]: "" }))
              : linkSmeIdentity(row, event.target.value)}>
            {identities.map((identity) => <option key={identity.id} value={identity.id}>
              {identity.name}{identity.resolutionStatus === "ambiguous" ? " — confirmation required" : ""}
            </option>)}
            <option value={NEW_SME_NAME_OPTION}>＋ New name not yet in Wrike</option>
          </select>
          {draftingNewName && <div className="sme-new-identity-draft">
            <input type="text" placeholder="Name as it will appear in Wrike's SME field" maxLength={200}
              value={newSmeNameDrafts[row.application_user_id as string] ?? ""} disabled={Boolean(working)}
              onChange={(event) => setNewSmeNameDrafts((current) => ({ ...current, [row.application_user_id as string]: event.target.value }))} />
            <button type="button" className="secondary" disabled={Boolean(working) || !(newSmeNameDrafts[row.application_user_id as string] ?? "").trim()}
              onClick={() => reserveAndLinkSmeIdentity(row)}>Reserve &amp; link</button>
            <button type="button" className="secondary" disabled={Boolean(working)}
              onClick={() => setNewSmeNameDrafts((current) => { const next = { ...current }; delete next[row.application_user_id as string]; return next; })}>Cancel</button>
          </div>}</> : <span className="notice warning compact">No DevTrack account</span>}</td>
          <td><SmeProjectFolder smeIdentityId={row.sme_identity_id} initialUrl={row.project_folder_url} editable /></td>
          <td>{row.assigned_projects} total<br /><span className="muted">{row.active_projects} active · {row.completed_projects} completed · {row.stalled_projects} stalled/canceled</span></td>
          <td>{row.submitted_surveys} submitted</td><td>{Number(row.billable_hours).toLocaleString()} h<br /><span className="muted">{currency(Number(row.invoiced_amount))}</span></td>
          <td><Link className="button secondary" href={`/sme-dashboard?sme=${encodeURIComponent(row.sme_identity_id)}&scope=recent`}>View dashboard</Link></td>
        </tr>;
        })}</tbody></table></div> : <p className="empty">No SME identities match this search.</p>}</section>
  </div>;
}
const currency = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
