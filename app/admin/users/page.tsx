import { AppShell } from "@/components/app-shell";
import { UserManagementPanel } from "@/components/user-management-panel";
import { UserApprovalQueue } from "@/components/user-approval-queue";
import { requirePageCapability } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { applicationUserDisplayName, applicationUserEmail } from "@/lib/users/application-user-display";
import { normalizeApplicationRole } from "@/lib/auth/roles";

export default async function UserManagementPage() {
  const { supabase, profile } = await requirePageCapability("manage_users");
  const admin = createAdminClient();
  const [{ data: users, error }, { data: invitations, error: invitationError }, { data: authentication, error: authenticationError }, { data: assignedUsers, error: assignmentsError }, { data: wrikeUsers, error: wrikeUsersError }] = await Promise.all([
    supabase.from("application_users").select("id,display_name,role,created_at,wrike_user_id").eq("organization_id", profile.organization_id).order("display_name"),
    supabase.from("application_user_invitations").select("id,email,role,status,invited_at,last_sent_at,last_error,auth_user_id").eq("organization_id", profile.organization_id).in("status", ["pending", "failed"]).order("invited_at"),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    admin.from("application_users").select("id"),
    admin.from("wrike_users").select("id,display_name,email,is_unresolved,is_active").eq("organization_id", profile.organization_id).eq("is_active", true).eq("is_unresolved", false).order("display_name"),
  ]);
  if (error) throw new Error(`User management could not be loaded: ${error.message}`);
  if (invitationError) throw new Error(`Invitations could not be loaded: ${invitationError.message}`);
  if (authenticationError) throw new Error(`User names could not be loaded from authentication: ${authenticationError.message}`);
  if (assignmentsError) throw new Error(`Pending approvals could not be loaded: ${assignmentsError.message}`);
  if (wrikeUsersError) throw new Error(`Synchronized Wrike identities could not be loaded: ${wrikeUsersError.message}`);

  const authenticationById = new Map(authentication.users.map((user) => [user.id, user]));
  const assignedUserIds = new Set((assignedUsers ?? []).map((user) => user.id));
  const invitedUserIds = new Set((invitations ?? []).map((invitation) => invitation.auth_user_id).filter(Boolean));
  const pendingUsers = authentication.users
    .filter((user) => !assignedUserIds.has(user.id) && !invitedUserIds.has(user.id))
    .map((user) => ({ id: user.id, name: applicationUserDisplayName(null, user), email: applicationUserEmail(user), createdAt: user.created_at }))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  const members = (users ?? []).map((user) => {
    const authenticationUser = authenticationById.get(user.id);
    return { id: user.id, name: applicationUserDisplayName(user.display_name, authenticationUser), email: applicationUserEmail(authenticationUser), role: normalizeApplicationRole(user.role), createdAt: user.created_at, wrikeUserId: user.wrike_user_id };
  });
  const managedInvitations = (invitations ?? []).map((invitation) => ({
    id: invitation.id, email: invitation.email, role: normalizeApplicationRole(invitation.role) as "admin" | "id" | "sme",
    status: invitation.status as "pending" | "failed", invitedAt: invitation.invited_at,
    lastSentAt: invitation.last_sent_at, lastError: invitation.last_error,
  }));

  const identityOptions = (wrikeUsers ?? []).map((identity) => ({ id: identity.id, name: identity.display_name, email: identity.email }));
  return <AppShell isAdmin><header className="page-header"><div><p className="eyebrow">ADMINISTRATIVE FUNCTIONS</p><h1>User Management</h1><p>Invite users, manage organization roles, and map ID and SME accounts to verified Wrike identities.</p></div></header><UserManagementPanel members={members} invitations={managedInvitations} identities={identityOptions} /><UserApprovalQueue users={pendingUsers} /></AppShell>;
}
