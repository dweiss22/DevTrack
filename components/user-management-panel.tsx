"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { roleLabel, type ApplicationRole } from "@/lib/auth/roles";

type AssignableRole = "admin" | "id" | "sme";
export type ManagedMember = { id: string; name: string; email: string; role: ApplicationRole; createdAt: string; wrikeUserId: string | null };
export type ManagedInvitation = { id: string; email: string; role: AssignableRole; status: "pending" | "failed"; invitedAt: string; lastSentAt: string | null; lastError: string | null };
type IdentityOption = { id: string; name: string; email: string | null };

export function UserManagementPanel({ members, invitations, identities }: { members: ManagedMember[]; invitations: ManagedInvitation[]; identities: IdentityOption[] }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [submitting, setSubmitting] = useState("");

  async function request(url: string, method: string, body: unknown, success: string) {
    setSubmitting(url); setMessage(""); setError(false);
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) { setError(true); setMessage(payload.error ?? "The user-management action could not be completed."); return; }
      setMessage(success); router.refresh();
    } catch {
      setError(true); setMessage("The user-management action could not be completed. Please retry.");
    } finally {
      setSubmitting("");
    }
  }

  function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const role = String(form.get("role") ?? "id");
    void request("/api/admin/users/invitations", "POST", { email, role }, `Invitation sent to ${email.trim().toLowerCase()}.`);
    event.currentTarget.reset();
  }

  return <div className="admin-stack">
    {message && <p className={error ? "notice error" : "notice"} role={error ? "alert" : "status"}>{message}</p>}
    <section className="card" aria-labelledby="add-user-title">
      <div className="section-heading"><div><p className="eyebrow">APP-MANAGED ACCESS</p><h2 id="add-user-title">Add user</h2></div><p>DevTrack emails a secure setup link and preapproves the selected role.</p></div>
      <form className="user-invite-form" onSubmit={invite}>
        <label>Email address<input name="email" type="email" autoComplete="email" maxLength={320} required placeholder="person@example.com" /></label>
        <label>Application role<select name="role" defaultValue="id"><option value="id">ID</option><option value="sme">SME</option><option value="admin">Admin</option></select></label>
        <button disabled={Boolean(submitting)}>{submitting === "/api/admin/users/invitations" ? "Sending invitation…" : "Send invitation"}</button>
      </form>
    </section>

    <section className="user-members-section" aria-labelledby="pending-invitations-title">
      <div className="section-heading"><div><h2 id="pending-invitations-title">Pending invitations</h2></div><p>{invitations.length} open</p></div>
      {invitations.length ? <div className="admin-table-wrap"><table><thead><tr><th>Email</th><th>Status</th><th>Role</th><th>Sent</th><th>Actions</th></tr></thead><tbody>{invitations.map((invitation) => {
        const endpoint = `/api/admin/users/invitations/${invitation.id}`;
        return <tr key={invitation.id}><td>{invitation.email}</td><td>{invitation.status === "failed" ? "Email failed" : "Invitation pending"}{invitation.lastError ? <><br /><span className="error">{invitation.lastError}</span></> : null}</td><td><select aria-label={`Role for ${invitation.email}`} value={invitation.role} disabled={Boolean(submitting)} onChange={(event) => request(endpoint, "PATCH", { action: "change_role", role: event.target.value }, `Role updated for ${invitation.email}.`)}><option value="id">ID</option><option value="sme">SME</option><option value="admin">Admin</option></select></td><td>{invitation.lastSentAt ? new Date(invitation.lastSentAt).toLocaleString() : "Not sent"}</td><td><div className="table-actions"><button className="secondary" disabled={Boolean(submitting)} onClick={() => request(endpoint, "PATCH", { action: "resend" }, `Invitation resent to ${invitation.email}.`)}>Resend</button><button className="secondary danger" disabled={Boolean(submitting)} onClick={() => { if (confirm(`Cancel the invitation for ${invitation.email}?`)) void request(endpoint, "PATCH", { action: "cancel" }, `Invitation canceled for ${invitation.email}.`); }}>Cancel</button></div></td></tr>;
      })}</tbody></table></div> : <p className="card empty">No invitations are awaiting account setup.</p>}
    </section>

    <section className="user-members-section" aria-labelledby="organization-members-title">
      <div className="section-heading"><div><h2 id="organization-members-title">Organization members</h2></div><p>{members.length} active</p></div>
      {members.length ? <div className="admin-table-wrap"><table><thead><tr><th>User</th><th>Email</th><th>Role</th><th>SME identity</th><th>Added</th></tr></thead><tbody>{members.map((member) => {
        const locked = member.role === "super_admin";
        return <tr key={member.id}><td>{member.name}</td><td>{member.email}</td><td>{locked ? <><strong>{roleLabel(member.role)}</strong><br /><span className="muted">Fixed account</span></> : <select aria-label={`Role for ${member.name}`} value={member.role} disabled={Boolean(submitting)} onChange={(event) => request(`/api/admin/users/${member.id}`, "PATCH", { role: event.target.value }, `Role updated for ${member.email}.`)}><option value="id">ID</option><option value="sme">SME</option><option value="admin">Admin</option></select>}</td><td>{member.role === "sme" ? <select aria-label={`SME identity for ${member.name}`} value={member.wrikeUserId ?? ""} disabled={Boolean(submitting)} onChange={(event) => request(`/api/admin/users/${member.id}/sme-identity`, "PATCH", { wrikeUserId: event.target.value || null }, `SME identity updated for ${member.email}.`)}><option value="">Not mapped</option>{identities.map((identity) => <option key={identity.id} value={identity.id}>{identity.name}{identity.email ? ` (${identity.email})` : ""}</option>)}</select> : "Not applicable"}</td><td>{new Date(member.createdAt).toLocaleDateString()}</td></tr>;
      })}</tbody></table></div> : <p className="card empty">No application users are assigned to this organization.</p>}
    </section>
  </div>;
}
