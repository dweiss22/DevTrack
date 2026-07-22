import { AppShell } from "@/components/app-shell";
import { UserApprovalQueue } from "@/components/user-approval-queue";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { applicationUserDisplayName, applicationUserEmail } from "@/lib/users/application-user-display";

export default async function UserManagementPage() {
  const { supabase, profile } = await requireAdmin();
  const admin = createAdminClient();
  const [{ data: users, error }, { data: authentication, error: authenticationError }, { data: assignedUsers, error: assignmentsError }] = await Promise.all([
    supabase.from("application_users").select("id,display_name,role,created_at").eq("organization_id", profile.organization_id).order("display_name"),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    admin.from("application_users").select("id"),
  ]);
  if (error) throw new Error(`User management could not be loaded: ${error.message}`);
  if (authenticationError) throw new Error(`User names could not be loaded from authentication: ${authenticationError.message}`);
  if (assignmentsError) throw new Error(`Pending approvals could not be loaded: ${assignmentsError.message}`);

  const authenticationById = new Map(authentication.users.map((user) => [user.id, user]));
  const assignedUserIds = new Set((assignedUsers ?? []).map((user) => user.id));
  const pendingUsers = authentication.users
    .filter((user) => !assignedUserIds.has(user.id))
    .map((user) => ({ id: user.id, name: applicationUserDisplayName(null, user), email: applicationUserEmail(user), createdAt: user.created_at }))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  return <AppShell isAdmin><header className="page-header"><div><p className="eyebrow">ADMINISTRATIVE FUNCTIONS</p><h1>User Management</h1><p>Review access requests and organization membership. Authentication accounts remain managed by Supabase.</p></div></header><UserApprovalQueue users={pendingUsers} /><section className="user-members-section" aria-labelledby="organization-members-title"><h2 id="organization-members-title">Organization members</h2>{users?.length ? <table><thead><tr><th>User</th><th>Email</th><th>Role</th><th>Added</th></tr></thead><tbody>{users.map((user) => {
    const authenticationUser = authenticationById.get(user.id);
    return <tr key={user.id}><td>{applicationUserDisplayName(user.display_name, authenticationUser)}</td><td>{applicationUserEmail(authenticationUser)}</td><td>{user.role}</td><td>{new Date(user.created_at).toLocaleDateString()}</td></tr>;
  })}</tbody></table> : <p className="card empty">No application users are assigned to this organization.</p>}</section></AppShell>;
}
