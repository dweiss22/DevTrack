"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { roleLabel, type ApplicationRole, type ManagementRole, type OperationalRole } from "@/lib/auth/roles";
import { SmeProjectFolder } from "@/components/sme-project-folder";
import { smeClassificationLabel, type SmeClassification } from "@/lib/smes/domain";

export type ManagedMember = {
  id: string; name: string; email: string; role: ApplicationRole; createdAt: string;
  wrikeUserId: string | null; accountState: "active" | "deletion_pending";
  profileCompleted: boolean; personaWrikeUserId: string | null;
  operationalRoles: OperationalRole[]; managementRoles: ManagementRole[]; accessWrikeUserId: string | null;
  deletionJobId: string | null;
  smeClassification: SmeClassification | null;
  smeClassificationUpdatedAt: string | null;
  smeIdentityId: string | null;
  smeProjectFolderUrl?: string | null;
};
type IdentityOption = { id: string; name: string; email: string | null };
type SmeIdentityOption = {
  id: string; name: string; normalizedName: string;
  resolutionStatus: "discovered" | "verified" | "ambiguous" | "resolved";
  ambiguityReason: string | null; wrikeUserId: string | null;
  applicationUserId: string | null;
};
type DeletionPreview = {
  targetUserId: string; displayName: string; email: string; role: ApplicationRole;
  delete: { conversations: number; reportingMemberships: number; invitations: number; draftSurveys: number; draftAttachments: number };
  retain: { submittedSurveys: number; surveyRevisions: number; surveyAuditEvents: number; historicalLabel: string };
};

export function UserManagementPanel({ members, identities, smeIdentities, personaIdentities, managerId, managerRole, impersonating }: {
  members: ManagedMember[]; identities: IdentityOption[];
  smeIdentities: SmeIdentityOption[];
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
  const [inviteRole, setInviteRole] = useState<OperationalRole>("id");

  async function request(url: string, method: string, body: unknown, success: string) {
    setSubmitting(url); setMessage(""); setError(false);
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json() as { error?: string; message?: string };
      if (!response.ok) { setError(true); setMessage(payload.error ?? "The user-management action could not be completed."); return; }
      setMessage(payload.message ?? success); router.refresh();
    } catch {
      setError(true); setMessage("The user-management action could not be completed. Please retry.");
    } finally { setSubmitting(""); }
  }

  function addUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    void request("/api/admin/users/invitations", "POST", {
      email,
      role: form.get("role"),
      smeClassification: form.get("role") === "sme" ? form.get("smeClassification") : undefined,
    }, `${email.trim().toLowerCase()} was added to DevTrack.`);
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

  function linkSmeIdentity(member: ManagedMember, identityId: string) {
    const identity = smeIdentities.find((option) => option.id === identityId);
    if (!identity) return;
    const replacing = Boolean(member.smeIdentityId && member.smeIdentityId !== identity.id)
      || Boolean(identity.applicationUserId && identity.applicationUserId !== member.id)
      || identity.resolutionStatus === "ambiguous";
    const confirmed = !replacing || window.confirm(
      `Confirm linking ${member.name} (${member.email}) to the field-derived SME identity “${identity.name}”. `
      + "This replaces the existing linkage or resolves an ambiguous match; project and survey history will remain attached to the SME identity."
    );
    if (!confirmed) return;
    void request(`/api/admin/users/${member.id}/sme-identity`, "PATCH", {
      smeIdentityId: identity.id,
      confirmReplacement: replacing,
    }, `${member.name} is now linked to ${identity.name}.`);
  }

  return <div className="admin-stack">
    {message && <p className={error ? "notice error" : "notice"} role={error ? "alert" : "status"}>{message}</p>}
    <section className="card" aria-labelledby="add-user-title">
      <div className="section-heading"><div><p className="eyebrow">APP-MANAGED ACCESS</p><h2 id="add-user-title">Add user</h2></div><p>Creates active DevTrack access immediately and emails the standard password link.</p></div>
      <form className="user-invite-form" onSubmit={addUser}>
        <label>Email address<input name="email" type="email" autoComplete="email" maxLength={320} required placeholder="person@example.com" /></label>
        <label>Initial operational role<select name="role" value={inviteRole}
          onChange={(event) => setInviteRole(event.target.value as OperationalRole)}>
          <option value="id">ID</option><option value="sme">SME</option><option value="project_reviewer">Project Reviewer</option></select></label>
        {inviteRole === "sme" ? <label>SME type<select name="smeClassification" required defaultValue="">
          <option value="" disabled>Select SME type</option>
          <option value="internal">Internal SME</option>
          <option value="external">External SME</option>
        </select></label> : null}
        <button disabled={Boolean(submitting) || impersonating}>{submitting === "/api/admin/users/invitations" ? "Adding user…" : "Add user"}</button>
      </form>
      <p className="muted">Grant Admin or SME Coordinator access after adding the user in Operational and app management roles.</p>
      {impersonating && <p className="notice warning">User access and security actions are disabled while impersonating.</p>}
    </section>

    <section className="user-members-section" aria-labelledby="organization-members-title">
      <div className="section-heading"><div><h2 id="organization-members-title">Organization members</h2></div><p>{members.length} active</p></div>
      {members.length ? <div className="admin-table-wrap"><table><thead><tr><th>User</th><th>Email</th><th>Access profile</th><th>SME type</th><th>Wrike identity / ID persona</th><th>Added</th><th>Actions</th></tr></thead><tbody>{members.map((member) => {
        const locked = member.role === "super_admin";
        const persona = locked && managerRole === "super_admin" && member.id === managerId;
        const identityOption = identities.find((identity) => identity.id === member.accessWrikeUserId);
        return <tr key={member.id}>
          <td>{member.name}{member.accountState === "deletion_pending" ? <><br /><span className="error">Deletion pending</span></> : null}</td>
          <td>{member.email}</td>
          <td>{locked ? <><strong>{roleLabel(member.role)}</strong><br /><span className="muted">Fixed account</span></> : <div className="role-checkboxes">
            {member.operationalRoles.map((role) => <span className="role-chip" key={role}>{operationalRoleLabel(role)}</span>)}
            {member.managementRoles.map((role) => <span className="role-chip" key={role}>{role === "sme_coordinator" ? "SME Coordinator" : role === "admin" ? "Admin" : "SuperAdmin"}</span>)}
            {!member.operationalRoles.length && !member.managementRoles.length ? <span className="muted">No active roles</span> : null}
          </div>}</td>
          <td>{member.operationalRoles.includes("sme") ? <label>
            <span className="sr-only">SME type for {member.name}</span>
            <select aria-label={`SME type for ${member.name}`} value={member.smeClassification ?? ""}
              disabled={Boolean(submitting) || impersonating}
              onChange={(event) => request(`/api/admin/users/${member.id}/sme-classification`, "PATCH",
                { classification: event.target.value }, `SME type updated for ${member.email}.`)}>
              <option value="" disabled>SME type not configured</option>
              <option value="internal">Internal SME</option>
              <option value="external">External SME</option>
            </select>
            <span className="muted">{smeClassificationLabel(member.smeClassification)}
              {member.smeClassificationUpdatedAt ? ` · Updated ${new Date(member.smeClassificationUpdatedAt).toLocaleDateString()}` : ""}
            </span>
          </label> : "Not applicable"}</td>
          <td>{persona ? <label>ID operational persona<select aria-label="ID operational persona" value={member.personaWrikeUserId ?? ""} disabled={Boolean(submitting) || impersonating} onChange={(event) => request(`/api/admin/users/${member.id}/operational-personas/id`, event.target.value ? "PUT" : "DELETE", event.target.value ? { wrikeUserId: event.target.value } : {}, event.target.value ? "ID persona assigned." : "ID persona removed.")}><option value="">Not assigned</option>{personaIdentities.map((identity) => <option key={identity.id} value={identity.id}>{identity.name}{identity.email ? ` (${identity.email})` : ""}</option>)}</select></label> : member.operationalRoles.length ? identityOption ? <>{identityOption.name}{identityOption.email ? <><br /><span className="muted">{identityOption.email}</span></> : null}</> : <span className="muted">Not mapped</span> : "Not applicable"}</td>
          <td>{new Date(member.createdAt).toLocaleDateString()}</td>
          <td><div className="table-actions">{member.accountState === "deletion_pending" && member.deletionJobId && !impersonating ? <button className="secondary danger" type="button" disabled={Boolean(submitting)} onClick={() => { setDeletionTarget(member); setDeletionStage("Resuming deletion…"); void advanceDeletion(member.deletionJobId!); }}>Retry deletion</button> : canManageTarget(member) ? <><button className="secondary" type="button" onClick={() => setImpersonationTarget(member)}>Log in as</button><button className="secondary danger" type="button" onClick={() => void openDeletion(member)}>Delete user</button></> : <span className="muted">Protected</span>}</div></td>
        </tr>;
      })}</tbody></table></div> : <p className="card empty">No application users are assigned to this organization.</p>}
    </section>

    <section className="card" aria-labelledby="sme-identity-links-title">
      <div className="section-heading"><div><p className="eyebrow">FIELD-DERIVED IDENTITY</p>
        <h2 id="sme-identity-links-title">SME account links</h2></div>
        <p>Link an application account to the durable SME identity discovered from imported project fields. Historical projects and surveys stay with the identity.</p></div>
      <div className="admin-table-wrap"><table><thead><tr>
        <th>Application user</th><th>Field-derived SME identity</th><th>Normalized match</th><th>Linkage status</th><th>Project folder</th>
      </tr></thead><tbody>{members.filter((member) => member.operationalRoles.includes("sme")).map((member) => {
        const linked = smeIdentities.find((identity) => identity.id === member.smeIdentityId);
        return <tr key={`sme-link:${member.id}`}>
          <td><strong>{member.name}</strong><br /><span className="muted">{member.email}</span></td>
          <td><select aria-label={`Field-derived SME identity for ${member.name}`}
            value={member.smeIdentityId ?? ""} disabled={Boolean(submitting) || impersonating}
            onChange={(event) => linkSmeIdentity(member, event.target.value)}>
            <option value="" disabled>Select discovered SME</option>
            {smeIdentities.map((identity) => <option key={identity.id} value={identity.id}>
              {identity.name}{identity.resolutionStatus === "ambiguous" ? " — confirmation required" : ""}
            </option>)}
          </select></td>
          <td>{linked ? <><strong>{linked.name}</strong><br /><code>{linked.normalizedName}</code></>
            : <span className="muted">Not linked</span>}</td>
          <td>{linked ? <><span className="role-chip">Linked</span>{" "}
            <span className="muted">{linked.resolutionStatus === "verified" ? "Verified Wrike match"
              : linked.resolutionStatus === "resolved" ? "Admin-confirmed match"
                : "Field-derived match"}</span></>
            : <span className="notice compact warning">Link required</span>}</td>
          <td>{member.smeIdentityId
            ? <SmeProjectFolder smeIdentityId={member.smeIdentityId} initialUrl={member.smeProjectFolderUrl ?? null} editable />
            : <span className="muted">Link an identity first</span>}</td>
        </tr>;
      })}</tbody></table></div>
    </section>

    {impersonationTarget && <div className="modal-backdrop"><section className="card management-dialog" role="dialog" aria-modal="true" aria-labelledby="impersonate-title"><h2 id="impersonate-title">Log in as {impersonationTarget.name}</h2><p>You will see DevTrack with this user’s permissions. All changes retain both identities in the audit history.</p><form onSubmit={startImpersonation}><label>Reason<textarea name="reason" required minLength={3} maxLength={1000} autoFocus /></label><div className="table-actions"><button disabled={Boolean(submitting)}>Start impersonation</button><button className="secondary" type="button" onClick={() => setImpersonationTarget(null)} disabled={Boolean(submitting)}>Cancel</button></div></form></section></div>}
    {deletionTarget && <div className="modal-backdrop"><section className="card management-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-user-title"><h2 id="delete-user-title">Delete {deletionTarget.name}</h2>{deletionPreview ? <><p>This removes authentication, membership, mappings, conversations, invitations, and never-submitted drafts.</p><ul><li>{deletionPreview.delete.draftSurveys} draft surveys and {deletionPreview.delete.draftAttachments} draft files deleted</li><li>{deletionPreview.delete.conversations} conversations and {deletionPreview.delete.reportingMemberships} reporting assignments deleted</li><li>{deletionPreview.retain.submittedSurveys} submitted surveys and {deletionPreview.retain.surveyAuditEvents} audit events retained as “Deleted user”</li></ul><form onSubmit={startDeletion}><label>Deletion reason<textarea name="reason" required minLength={3} maxLength={2000} /></label><label>Type {deletionPreview.email} to confirm<input name="confirmationEmail" type="email" required autoComplete="off" /></label><div className="table-actions"><button className="danger" disabled={Boolean(submitting)}>Delete user</button><button className="secondary" type="button" onClick={() => setDeletionTarget(null)} disabled={Boolean(submitting)}>Cancel</button></div></form>{deletionStage && <p className="notice" role="status">{deletionStage}</p>}</> : <p>{deletionStage}</p>}</section></div>}
  </div>;
}

function operationalRoleLabel(role: OperationalRole) {
  return role === "id" ? "ID" : role === "sme" ? "SME" : "Project Reviewer";
}
