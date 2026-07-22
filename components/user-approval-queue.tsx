"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type PendingApplicationUser = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
};

export function UserApprovalQueue({ users }: { users: PendingApplicationUser[] }) {
  const router = useRouter();
  const [approvedIds, setApprovedIds] = useState<string[]>([]);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [hasError, setHasError] = useState(false);
  const pendingUsers = users.filter((user) => !approvedIds.includes(user.id));

  async function approve(user: PendingApplicationUser) {
    setSubmittingId(user.id);
    setMessage("");
    setHasError(false);
    try {
      const response = await fetch("/api/admin/users/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) {
        setHasError(true);
        setMessage(body.error ?? "DevTrack could not approve this account.");
        return;
      }
      setApprovedIds((current) => [...current, user.id]);
      setMessage(`${user.email} now has DevTrack access.`);
      router.refresh();
    } catch {
      setHasError(true);
      setMessage("DevTrack could not approve this account. Please retry.");
    } finally {
      setSubmittingId(null);
    }
  }

  return <section className="card user-approval-card" aria-labelledby="pending-approvals-title">
    <div className="section-heading"><div><p className="eyebrow">ACCESS CONTROL</p><h2 id="pending-approvals-title">Pending approvals</h2></div><p>{pendingUsers.length} awaiting approval</p></div>
    <p className="muted">These people have a Supabase authentication account but do not yet have access to this DevTrack organization.</p>
    {message && <p className={hasError ? "notice error" : "notice"} role={hasError ? "alert" : "status"}>{message}</p>}
    {pendingUsers.length ? <div className="admin-table-wrap"><table><thead><tr><th>User</th><th>Email</th><th>Account created</th><th>Action</th></tr></thead><tbody>{pendingUsers.map((user) => <tr key={user.id}><td>{user.name}</td><td>{user.email}</td><td>{new Date(user.createdAt).toLocaleDateString()}</td><td><button onClick={() => approve(user)} disabled={submittingId !== null}>{submittingId === user.id ? "Approving…" : "Approve access"}</button></td></tr>)}</tbody></table></div> : <p className="empty">No authentication accounts are awaiting approval.</p>}
  </section>;
}
