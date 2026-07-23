"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { roleLabel, type ApplicationRole } from "@/lib/auth/roles";

type AssignableRole = "admin" | "id" | "sme";
export type ManagedMember = {
  id: string; name: string; email: string; role: ApplicationRole; createdAt: string;
  wrikeUserId: string | null; accountState: "active" | "deletion_pending";
  profileCompleted: boolean; personaWrikeUserId: string | null;
  deletionJobId: string | null;
};
export type ManagedInvitation = { id: string; email: string; role: AssignableRole; status: "pending" | "failed"; invitedAt: string; lastSentAt: string | null; lastError: string | null };
type IdentityOption = { id: string; name: string; email: string | null };
type DeletionPreview = {
  targetUserId: string; displayName: string; email: string; role: ApplicationRole;
  delete: { conversations: number; reportingMemberships: number; invitations: number; draftSurveys: number; draftAttachments: number };
  retain: { submittedSurveys: number; surveyRevisions: number; surveyAuditEvents: number; historicalLabel: string };
};

export function UserManagementPanel({ members, invitations, identities, personaIdentities, managerId, managerRole, impersonating }: {
  members: ManagedMember[]; invitations: ManagedInvitation[]; identities: IdentityOption[];
  personaIdentities: IdentityOption[];
  managerId: string; managerRole: ApplicationRole; impersonating: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [submitting, setSubmitting] = useState("");
  const [impersonationTarget, setImpersonationTarget] = useState<ManagedMember | null>(null);
  const [deletionTarget, setDeletionTarget] = useState<ManagedMember | null>(null);
  const [deletionPreview, setDeletionPreview] = useState<DeletionPreview | null>(null);
  const [deletionStage, setDeletionStage] = useState("");

  async function request(url: string, method: string, body: unknown, success: string) {
    setSubmitting(url); setMessage(""); setError(false);
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) { setError(true); setMessage(payload.error ?? "The user-management action could not be completed."); return; }
      setMessage(success); router.refresh();
    } catch {
      setError(true); setMessage("The user-management action could not be completed. Please retry.");
    } finally { setSubmitting(""); }
  }

  function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    void request("/api/admin/users/invitations", "POST", { email, role: form.get("role") }, `Invitation sent to ${email.trim().toLowerCase()}.`);
    event.currentTarget.reset();
  }

  async function startImpersonation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!impersonationTarget) return;
    setSubmitting("impersonation");
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "");
    const response = await fetch("/api/admin/impersonations", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUserId: impersonationTarget.id, reason }),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) {
      setError(true); setMessage(payload.error ?? "Impersonation could not be started."); setSubmitting(""); return;
    }
    window.location.assign("/");
  }

  async function openDeletion(member: ManagedMember) {
    setDeletionTarget(member); setDeletionPreview(null); setDeletionStage("Loading preview…");
    const response = await fetch(`/api/admin/users/${member.id}/deletion-preview`);
    const payload = await response.json() as { preview?: DeletionPreview; error?: string };
    if (!response.ok || !payload.preview) return setDeletionStage(payload.error ?? "The deletion preview could not be loaded.");
    setDeletionPreview(payload.preview); setDeletionStage("");
  }

  async function startDeletion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deletionTarget || !deletionPreview) return;
    const form = new FormData(event.currentTarget);
    setSubmitting("deletion"); setDeletionStage("Starting deletion…");
    const response = await fetch(`/api/admin/users/${deletionTarget.id}/deletion`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: form.get("reason"), confirmationEmail: form.get("confirmationEmail") }),
    });
    const payload = await response.json() as { deletion?: { id?: string }; error?: string };
    if (!response.ok || !payload.deletion?.id) {
      setDeletionStage(payload.error ?? "Deletion could not be started."); setSubmitting(""); return;
    }
    await advanceDeletion(payload.deletion.id);
  }

  async function advanceDeletion(jobId: string) {
    setSubmitting("deletion");
    let complete = false;
    while (!complete) {
      const advance = await fetch(`/api/admin/user-deletions/${jobId}/advance`, { method: "POST" });
      const progress = await advance.json() as { deletion?: { stage?: string }; error?: string };
      const stage = progress.deletion?.stage ?? "failed";
      setDeletionStage(stage === "failed" ? `${progress.error ?? "A stage failed."} Retry is available.` : `Deletion stage: ${stage.replaceAll("_", " ")}`);
      if (!advance.ok || stage === "failed") break;
      complete = stage === "finalized";
    }
    setSubmitting("");
    if (complete) {
      setMessage(`${deletionTarget?.email ?? "The user"} was deleted. Historical records now show “Deleted user.”`);
      setError(false); setDeletionTarget(null); setDeletionPreview(null); router.refresh();
    }
  }

  const canManageTarget = (member: ManagedMember) => !impersonating && member.id !== managerId
    && member.role !== "super_admin" && (managerRole === "super_admin" || (managerRole === "admin" && member.role !== "admin"))
    && member.accountState === "active" && member.profileCompleted;

  return <div className="admin-stack">
    {message && <p className={error ? "notice error" : "notice"} role={error ? "alert" : "status"}>{message}</p>}
    <section className="card" aria-labelledby="add-user-title">
      <div className="section-heading"><div><p className="eyebrow">APP-MANAGED ACCESS</p><h2 id="add-user-title">Add user</h2></div><p>DevTrack emails a secure setup link and preapproves the selected role.</p></div>
      <form className="user-invite-form" onSubmit={invite}>
        <label>Email address<input name="email" type="email" autoComplete="email" maxLength={320} required placeholder="person@example.com" /></label>
        <label>Application role<select name="role" defaultValue="id"><option value="id">ID</option><option value="sme">SME</option><option value="admin">Admin</option></select></label>
        <button disabled={Boolean(submitting) || impersonating}>{submitting === "/api/admin/users/invitations" ? "Sending invitation…" : "Send invitation"}</button>
      </form>
      {impersonating && <p className="notice warning">Invitation and user-security actions are disabled while impersonating.</p>}
    </section>

    <section className="user-members-section" aria-labelledby="pending-invitations-title">
      <div className="section-heading"><div><h2 id="pending-invitations-title">Pending invitations</h2></div><p>{invitations.length} open</p></div>
      {invitations.length ? <div className="admin-table-wrap"><table><thead><tr><th>Email</th><th>Status</th><th>Role</th><th>Sent</th><th>Actions</th></tr></thead><tbody>{invitations.map((invitation) => {
        const endpoint = `/api/admin/users/invitations/${invitation.id}`;
        return <tr key={invitation.id}><td>{invitation.email}</td><td>{invitation.status === "failed" ? "Email failed" : "Invitation pending"}{invitation.lastError ? <><br /><span className="error">{invitation.lastError}</span></> : null}</td><td><select aria-label={`Role for ${invitation.email}`} value={invitation.role} disabled={Boolean(submitting) || impersonating} onChange={(event) => request(endpoint, "PATCH", { action: "change_role", role: event.target.value }, `Role updated for ${invitation.email}.`)}><option value="id">ID</option><option value="sme">SME</option><option value="admin">Admin</option></select></td><td>{invitation.lastSentAt ? new Date(invitation.lastSentAt).toLocaleString() : "Not sent"}</td><td><div className="table-actions"><button className="secondary" disabled={Boolean(submitting) || impersonating} onClick={() => request(endpoint, "PATCH", { action: "resend" }, `Invitation resent to ${invitation.email}.`)}>Resend</button><button className="secondary danger" disabled={Boolean(submitting) || impersonating} onClick={() => { if (confirm(`Cancel the invitation for ${invitation.email}?`)) void request(endpoint, "PATCH", { action: "cancel" }, `Invitation canceled for ${invitation.email}.`); }}>Cancel</button></div></td></tr>;
      })}</tbody></table></div> : <p className="card empty">No invitations are awaiting account setup.</p>}
    </section>

    <section className="user-members-section" aria-labelledby="organization-members-title">
      <div className="section-heading"><div><h2 id="organization-members-title">Organization members</h2></div><p>{members.length} active</p></div>
      {members.length ? <div className="admin-table-wrap"><table><thead><tr><th>User</th><th>Email</th><th>Role</th><th>Wrike identity / persona</th><th>Added</th><th>Actions</th></tr></thead><tbody>{members.map((member) => {
        const locked = member.role === "super_admin";
        const canMap = member.role === "sme" || member.role === "id";
        const persona = locked && managerRole === "super_admin" && member.id === managerId;
        return <tr key={member.id}><td>{member.name}{member.accountState === "deletion_pending" ? <><br /><span className="error">Deletion pending</span></> : null}</td><td>{member.email}</td><td>{locked ? <><strong>{roleLabel(member.role)}</strong><br /><span className="muted">Fixed account</span></> : <select aria-label={`Role for ${member.name}`} value={member.role} disabled={Boolean(submitting) || impersonating || member.accountState !== "active"} onChange={(event) => request(`/api/admin/users/${member.id}`, "PATCH", { role: event.target.value }, `Role updated for ${member.email}.`)}><option value="id">ID</option><option value="sme">SME</option><option value="admin">Admin</option></select>}</td><td>{canMap ? <select aria-label={`Wrike identity for ${member.name}`} value={member.wrikeUserId ?? ""} disabled={Boolean(submitting) || impersonating || member.accountState !== "active"} onChange={(event) => request(`/api/admin/users/${member.id}/wrike-identity`, "PATCH", { wrikeUserId: event.target.value || null }, `Wrike identity updated for ${member.email}.`)}><option value="">Not mapped</option>{identities.map((identity) => <option key={identity.id} value={identity.id}>{identity.name}{identity.email ? ` (${identity.email})` : ""}</option>)}</select> : persona ? <label>ID operational persona<select aria-label="ID operational persona" value={member.personaWrikeUserId ?? ""} disabled={Boolean(submitting) || impersonating} onChange={(event) => request(`/api/admin/users/${member.id}/operational-personas/id`, event.target.value ? "PUT" : "DELETE", event.target.value ? { wrikeUserId: event.target.value } : {}, event.target.value ? "ID persona assigned." : "ID persona removed.")}><option value="">Not assigned</option>{personaIdentities.map((identity) => <option key={identity.id} value={identity.id}>{identity.name}{identity.email ? ` (${identity.email})` : ""}</option>)}</select></label> : "Not applicable"}</td><td>{new Date(member.createdAt).toLocaleDateString()}</td><td><div className="table-actions">{member.accountState === "deletion_pending" && member.deletionJobId && !impersonating ? <button className="secondary danger" type="button" disabled={Boolean(submitting)} onClick={() => { setDeletionTarget(member); setDeletionStage("Resuming deletion…"); void advanceDeletion(member.deletionJobId!); }}>Retry deletion</button> : canManageTarget(member) ? <><button className="secondary" type="button" onClick={() => setImpersonationTarget(member)}>Log in as</button><button className="secondary danger" type="button" onClick={() => void openDeletion(member)}>Delete user</button></> : <span className="muted">Protected</span>}</div></td></tr>;
      })}</tbody></table></div> : <p className="card empty">No application users are assigned to this organization.</p>}
    </section>

    {impersonationTarget && <div className="modal-backdrop"><section className="card management-dialog" role="dialog" aria-modal="true" aria-labelledby="impersonate-title"><h2 id="impersonate-title">Log in as {impersonationTarget.name}</h2><p>You will see DevTrack with this user’s permissions. All changes retain both identities in the audit history.</p><form onSubmit={startImpersonation}><label>Reason<textarea name="reason" required minLength={3} maxLength={1000} autoFocus /></label><div className="table-actions"><button disabled={Boolean(submitting)}>Start impersonation</button><button className="secondary" type="button" onClick={() => setImpersonationTarget(null)} disabled={Boolean(submitting)}>Cancel</button></div></form></section></div>}
    {deletionTarget && <div className="modal-backdrop"><section className="card management-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-user-title"><h2 id="delete-user-title">Delete {deletionTarget.name}</h2>{deletionPreview ? <><p>This removes authentication, membership, mappings, conversations, invitations, and never-submitted drafts.</p><ul><li>{deletionPreview.delete.draftSurveys} draft surveys and {deletionPreview.delete.draftAttachments} draft files deleted</li><li>{deletionPreview.delete.conversations} conversations and {deletionPreview.delete.reportingMemberships} reporting assignments deleted</li><li>{deletionPreview.retain.submittedSurveys} submitted surveys and {deletionPreview.retain.surveyAuditEvents} audit events retained as “Deleted user”</li></ul><form onSubmit={startDeletion}><label>Deletion reason<textarea name="reason" required minLength={3} maxLength={2000} /></label><label>Type {deletionPreview.email} to confirm<input name="confirmationEmail" type="email" required autoComplete="off" /></label><div className="table-actions"><button className="danger" disabled={Boolean(submitting)}>Delete user</button><button className="secondary" type="button" onClick={() => setDeletionTarget(null)} disabled={Boolean(submitting)}>Cancel</button></div></form>{deletionStage && <p className="notice" role="status">{deletionStage}</p>}</> : <p>{deletionStage}</p>}</section></div>}
  </div>;
}
