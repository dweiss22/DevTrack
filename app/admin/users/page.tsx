import { AppShell } from "@/components/app-shell";
import { UserManagementPanel } from "@/components/user-management-panel";
import { UserApprovalQueue } from "@/components/user-approval-queue";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { applicationUserDisplayName, applicationUserEmail } from "@/lib/users/application-user-display";

export default async function UserManagementPage() {
  const { supabase, profile } = await requireAdmin();
  const admin = createAdminClient();
  const [{ data: users, error }, { data: invitations, error: invitationError }, { data: authentication, error: authenticationError }, { data: assignedUsers, error: assignmentsError }] = await Promise.all([
    supabase.from("application_users").select("id,display_name,role,created_at").eq("organization_id", profile.organization_id).order("display_name"),
    supabase.from("application_user_invitations").select("id,email,role,status,invited_at,last_sent_at,last_error,auth_user_id").eq("organization_id", profile.organization_id).in("status", ["pending", "failed"]).order("invited_at"),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    admin.from("application_users").select("id"),
  ]);
  if (error) throw new Error(`User management could not be loaded: ${error.message}`);
  if (invitationError) throw new Error(`Invitations could not be loaded: ${invitationError.message}`);
  if (authenticationError) throw new Error(`User names could not be loaded from authentication: ${authenticationError.message}`);
  if (assignmentsError) throw new Error(`Pending approvals could not be loaded: ${assignmentsError.message}`);

  const authenticationById = new Map(authentication.users.map((user) => [user.id, user]));
  const assignedUserIds = new Set((assignedUsers ?? []).map((user) => user.id));
  const invitedUserIds = new Set((invitations ?? []).map((invitation) => invitation.auth_user_id).filter(Boolean));
  const pendingUsers = authentication.users
    .filter((user) => !assignedUserIds.has(user.id) && !invitedUserIds.has(user.id))
    .map((user) => ({ id: user.id, name: applicationUserDisplayName(null, user), email: applicationUserEmail(user), createdAt: user.created_at }))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  const members = (users ?? []).map((user) => {
    const authenticationUser = authenticationById.get(user.id);
    return { id: user.id, name: applicationUserDisplayName(user.display_name, authenticationUser), email: applicationUserEmail(authenticationUser), role: user.role as "admin" | "member", createdAt: user.created_at };
  });
  const managedInvitations = (invitations ?? []).map((invitation) => ({
    id: invitation.id, email: invitation.email, role: invitation.role as "admin" | "member",
    status: invitation.status as "pending" | "failed", invitedAt: invitation.invited_at,
    lastSentAt: invitation.last_sent_at, lastError: invitation.last_error,
  }));

  return <AppShell isAdmin><header className="page-header"><div><p className="eyebrow">ADMINISTRATIVE FUNCTIONS</p><h1>User Management</h1><p>Invite users, manage organization roles, and review access requests without relying on deployment-provider accounts.</p></div></header><UserManagementPanel members={members} invitations={managedInvitations} /><UserApprovalQueue users={pendingUsers} /></AppShell>;
}
