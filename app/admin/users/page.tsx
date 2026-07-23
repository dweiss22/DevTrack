import { AppShell } from "@/components/app-shell";
import { UserManagementPanel } from "@/components/user-management-panel";
import { UserApprovalQueue } from "@/components/user-approval-queue";
import { requirePageCapability } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { applicationUserDisplayName, applicationUserEmail } from "@/lib/users/application-user-display";
import { normalizeApplicationRole } from "@/lib/auth/roles";

export default async function UserManagementPage() {
  const { supabase, profile, identity, actor } = await requirePageCapability("manage_users");
  const admin = createAdminClient();
  const [{ data: users, error }, { data: invitations, error: invitationError }, { data: authentication, error: authenticationError }, { data: assignedUsers, error: assignmentsError }, { data: wrikeUsers, error: wrikeUsersError }, { data: personas, error: personasError }, { data: deletionJobs, error: deletionJobsError }] = await Promise.all([
    supabase.from("application_users").select("id,display_name,role,created_at,wrike_user_id,account_state,profile_completed").eq("organization_id", profile.organization_id).order("display_name"),
    supabase.from("application_user_invitations").select("id,email,role,status,invited_at,last_sent_at,last_error,auth_user_id").eq("organization_id", profile.organization_id).in("status", ["pending", "failed"]).order("invited_at"),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    admin.from("application_users").select("id"),
    admin.from("wrike_users").select("id,display_name,email,is_unresolved,is_active,identity_verified").eq("organization_id", profile.organization_id).eq("is_active", true).eq("is_unresolved", false).eq("identity_verified", true).order("display_name"),
    admin.from("application_user_operational_personas").select("application_user_id,wrike_user_id").eq("organization_id", profile.organization_id).eq("operational_role", "id").eq("is_active", true),
    admin.from("application_user_deletion_jobs").select("id,target_application_user_id,updated_at").eq("organization_id", profile.organization_id).neq("stage", "finalized").order("updated_at", { ascending: false }),
  ]);
  if (error) throw new Error(`User management could not be loaded: ${error.message}`);
  if (invitationError) throw new Error(`Invitations could not be loaded: ${invitationError.message}`);
  if (authenticationError) throw new Error(`User names could not be loaded from authentication: ${authenticationError.message}`);
  if (assignmentsError) throw new Error(`Pending approvals could not be loaded: ${assignmentsError.message}`);
  if (wrikeUsersError) throw new Error(`Synchronized Wrike identities could not be loaded: ${wrikeUsersError.message}`);
  if (personasError) throw new Error(`Operational personas could not be loaded: ${personasError.message}`);
  if (deletionJobsError) throw new Error(`User deletion status could not be loaded: ${deletionJobsError.message}`);

  const authenticationById = new Map(authentication.users.map((user) => [user.id, user]));
  const assignedUserIds = new Set((assignedUsers ?? []).map((user) => user.id));
  const invitedUserIds = new Set((invitations ?? []).map((invitation) => invitation.auth_user_id).filter(Boolean));
  const pendingUsers = authentication.users
    .filter((user) => !assignedUserIds.has(user.id) && !invitedUserIds.has(user.id))
    .map((user) => ({ id: user.id, name: applicationUserDisplayName(null, user), email: applicationUserEmail(user), createdAt: user.created_at }))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  const personaByUser = new Map((personas ?? []).map((persona) => [persona.application_user_id, persona.wrike_user_id]));
  const deletionJobByUser = new Map((deletionJobs ?? []).map((job) => [job.target_application_user_id, job.id]));
  const members = (users ?? []).map((user) => {
    const authenticationUser = authenticationById.get(user.id);
    return {
      id: user.id, name: applicationUserDisplayName(user.display_name, authenticationUser),
      email: applicationUserEmail(authenticationUser), role: normalizeApplicationRole(user.role),
      createdAt: user.created_at, wrikeUserId: user.wrike_user_id,
      accountState: user.account_state as "active" | "deletion_pending",
      profileCompleted: Boolean(user.profile_completed),
      personaWrikeUserId: personaByUser.get(user.id) ?? null,
      deletionJobId: deletionJobByUser.get(user.id) ?? null,
    };
  });
  const managedInvitations = (invitations ?? []).map((invitation) => ({
    id: invitation.id, email: invitation.email, role: normalizeApplicationRole(invitation.role) as "admin" | "id" | "sme",
    status: invitation.status as "pending" | "failed", invitedAt: invitation.invited_at,
    lastSentAt: invitation.last_sent_at, lastError: invitation.last_error,
  }));

  const identityOptions = (wrikeUsers ?? []).map((identity) => ({ id: identity.id, name: identity.display_name, email: identity.email }));
  const occupiedIdWrikeUsers = new Set([
    ...(users ?? []).filter((user) => user.role === "id" && user.wrike_user_id).map((user) => user.wrike_user_id as string),
    ...(personas ?? []).filter((persona) => persona.application_user_id !== actor.id).map((persona) => persona.wrike_user_id),
  ]);
  const currentPersonaWrikeUserId = personaByUser.get(actor.id) ?? null;
  const personaIdentityOptions = identityOptions.filter((option) =>
    option.id === currentPersonaWrikeUserId || !occupiedIdWrikeUsers.has(option.id));
  return <AppShell isAdmin><header className="page-header"><div><p className="eyebrow">ADMINISTRATIVE FUNCTIONS</p><h1>User Management</h1><p>Invite users, manage organization roles, and map ID and SME accounts to verified Wrike identities.</p></div></header>
    <UserManagementPanel members={members} invitations={managedInvitations} identities={identityOptions}
      personaIdentities={personaIdentityOptions}
      managerId={actor.id} managerRole={profile.role} impersonating={identity.impersonating} />
    <UserApprovalQueue users={pendingUsers} /></AppShell>;
}
