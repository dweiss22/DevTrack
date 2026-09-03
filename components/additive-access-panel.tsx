"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ManagementRole, OperationalRole } from "@/lib/auth/roles";

type Member = { id: string; name: string; email: string; operationalRoles: OperationalRole[];
  managementRoles: ManagementRole[]; accessWrikeUserId: string | null; locked: boolean };
type Identity = { id: string; name: string; email: string | null };

export function AdditiveAccessPanel({ members, identities, impersonating, canGrantAdmin }: {
  members: Member[]; identities: Identity[]; impersonating: boolean; canGrantAdmin: boolean;
}) {
  const router = useRouter(); const [working, setWorking] = useState(""); const [message, setMessage] = useState("");
  async function update(url: string, body: unknown, success: string) {
    setWorking(url); setMessage("");
    const response = await fetch(url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json() as { error?: string };
    setMessage(response.ok ? success : payload.error ?? "Access could not be updated.");
    setWorking(""); if (response.ok) router.refresh();
  }
  return <section className="card" aria-labelledby="additive-access-title"><div className="section-heading"><div>
    <p className="eyebrow">TWO-AXIS ACCESS</p><h2 id="additive-access-title">Operational and app management roles</h2></div>
    <p>ID and SME roles may be combined. App management roles add features without replacing operational access. Only SuperAdmin may grant Admin or SuperAdmin access.</p></div>
    {message && <p className="notice" role="status">{message}</p>}
    <div className="admin-table-wrap"><table><thead><tr><th>User</th><th>Operational roles</th><th>Management access</th><th>Verified Wrike identity</th></tr></thead>
      <tbody>{members.map((member) => {
        const toggleRole = (role: OperationalRole, enabled: boolean) => {
          const roles = enabled ? [...new Set([...member.operationalRoles, role])] : member.operationalRoles.filter((item) => item !== role);
          void update(`/api/admin/users/${member.id}/operational-access`, { roles, wrikeUserId: member.accessWrikeUserId }, `Operational access updated for ${member.email}.`);
        };
        return <tr key={member.id}><td><strong>{member.name}</strong><br /><span className="muted">{member.email}</span></td>
          <td><div className="role-checkboxes"><label><input type="checkbox" checked={member.operationalRoles.includes("id")}
            disabled={member.locked || Boolean(working) || impersonating} onChange={(event) => toggleRole("id", event.target.checked)} /> ID</label>
            <label><input type="checkbox" checked={member.operationalRoles.includes("sme")}
              disabled={member.locked || Boolean(working) || impersonating} onChange={(event) => toggleRole("sme", event.target.checked)} /> SME</label>
            <label><input type="checkbox" checked={member.operationalRoles.includes("project_reviewer")}
              disabled={member.locked || Boolean(working) || impersonating} onChange={(event) => toggleRole("project_reviewer", event.target.checked)} /> Project Reviewer</label></div></td>
          <td>{member.locked ? <><strong>SuperAdmin</strong><br /><span className="muted">Fixed account</span></> : <div className="role-checkboxes">
            <label><input type="checkbox" checked={member.managementRoles.includes("super_admin")}
              disabled={!canGrantAdmin || Boolean(working) || impersonating}
              onChange={(event) => void update(`/api/admin/users/${member.id}/management-roles`,
                { role: "super_admin", enabled: event.target.checked }, `SuperAdmin access updated for ${member.email}.`)} /> SuperAdmin</label>
            <label><input type="checkbox" checked={member.managementRoles.includes("admin")}
              disabled={!canGrantAdmin || Boolean(working) || impersonating}
              onChange={(event) => void update(`/api/admin/users/${member.id}/management-roles`,
                { role: "admin", enabled: event.target.checked }, `Admin access updated for ${member.email}.`)} /> Admin</label>
            <label><input type="checkbox" checked={member.managementRoles.includes("sme_coordinator")}
              disabled={!member.operationalRoles.includes("sme") || Boolean(working) || impersonating}
              onChange={(event) => void update(`/api/admin/users/${member.id}/management-roles`,
                { role: "sme_coordinator", enabled: event.target.checked }, `Management access updated for ${member.email}.`)} /> SME Coordinator</label></div>}</td>
          <td>{member.operationalRoles.length ? <select value={member.accessWrikeUserId ?? ""} disabled={Boolean(working) || impersonating}
            aria-label={`Verified Wrike identity for ${member.name}`} onChange={(event) => void update(`/api/admin/users/${member.id}/operational-access`,
              { roles: member.operationalRoles, wrikeUserId: event.target.value || null }, `Identity updated for ${member.email}.`)}>
            <option value="">Not mapped</option>{identities.map((identity) => <option key={identity.id} value={identity.id}>
              {identity.name}{identity.email ? ` (${identity.email})` : ""}</option>)}</select> : "Not applicable"}</td>
        </tr>;
      })}</tbody></table></div></section>;
}
