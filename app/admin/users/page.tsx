import { AppShell } from "@/components/app-shell";
import { UserManagementPanel } from "@/components/user-management-panel";
import { UserApprovalQueue } from "@/components/user-approval-queue";
import { AdditiveAccessPanel } from "@/components/additive-access-panel";
import { requirePageCapability } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { applicationUserDisplayName, applicationUserEmail } from "@/lib/users/application-user-display";
import { normalizeApplicationRole } from "@/lib/auth/roles";
import { reportingFailure } from "@/lib/reporting/failure";

export default async function UserManagementPage() {
  const { supabase, profile, identity, actor } = await requirePageCapability("manage_users");
  const admin = createAdminClient();
  const [{ data: users, error }, { data: authentication, error: authenticationError }, { data: assignedUsers, error: assignmentsError }, { data: wrikeUsers, error: wrikeUsersError }, { data: personas, error: personasError }, { data: managementRoles, error: managementRolesError }, { data: deletionJobs, error: deletionJobsError }, { data: smeProfiles, error: smeProfilesError }] = await Promise.all([
    supabase.from("application_users").select("id,display_name,role,created_at,wrike_user_id,account_state,profile_completed").eq("organization_id", profile.organization_id).order("display_name"),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    admin.from("application_users").select("id"),
    admin.from("wrike_users").select("id,display_name,email,is_unresolved,is_active,identity_verified").eq("organization_id", profile.organization_id).eq("is_active", true).eq("is_unresolved", false).eq("identity_verified", true).order("display_name"),
    admin.from("application_user_operational_personas").select("application_user_id,wrike_user_id,operational_role").eq("organization_id", profile.organization_id).eq("is_active", true),
    admin.from("application_user_management_roles").select("application_user_id,management_role").eq("organization_id", profile.organization_id).eq("is_active", true),
    admin.from("administrator_user_deletions").select("id,target_user_id,updated_at").eq("organization_id", profile.organization_id).neq("stage", "finalized").order("updated_at", { ascending: false }),
    admin.from("application_user_sme_profiles").select("application_user_id,classification,updated_at")
      .eq("organization_id", profile.organization_id),
  ]);
  if (error) throw new Error(`User management could not be loaded: ${error.message}`);
  if (authenticationError) throw new Error(`User names could not be loaded from authentication: ${authenticationError.message}`);
  if (assignmentsError) throw new Error(`Pending approvals could not be loaded: ${assignmentsError.message}`);
  if (wrikeUsersError) throw new Error(`Synchronized Wrike identities could not be loaded: ${wrikeUsersError.message}`);
  if (personasError) throw new Error(`Operational personas could not be loaded: ${personasError.message}`);
  if (deletionJobsError) throw new Error(`User deletion status could not be loaded: ${deletionJobsError.message}`);
  if (smeProfilesError) throw new Error(`SME account types could not be loaded: ${smeProfilesError.message}`);
  const managementRolesFailure = managementRolesError
    ? reportingFailure(managementRolesError, "Additive role management", "202607280001_additive_management_roles.sql")
    : null;

  const authenticationById = new Map(authentication.users.map((user) => [user.id, user]));
  const assignedUserIds = new Set((assignedUsers ?? []).map((user) => user.id));
  const pendingUsers = authentication.users
    .filter((user) => !assignedUserIds.has(user.id))
    .map((user) => ({ id: user.id, name: applicationUserDisplayName(null, user), email: applicationUserEmail(user), createdAt: user.created_at }))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  const personasByUser = new Map<string, NonNullable<typeof personas>>();
  for (const persona of personas ?? []) personasByUser.set(persona.application_user_id, [...(personasByUser.get(persona.application_user_id) ?? []), persona]);
  const managementByUser = new Map<string, string[]>();
  for (const grant of managementRoles ?? []) managementByUser.set(grant.application_user_id, [...(managementByUser.get(grant.application_user_id) ?? []), grant.management_role]);
  const deletionJobByUser = new Map((deletionJobs ?? []).map((job) => [job.target_user_id, job.id]));
  const smeProfileByUser = new Map((smeProfiles ?? []).map((row) => [row.application_user_id, row]));
  const members = (users ?? []).map((user) => {
    const authenticationUser = authenticationById.get(user.id);
    return {
      id: user.id, name: applicationUserDisplayName(user.display_name, authenticationUser),
      email: applicationUserEmail(authenticationUser), role: normalizeApplicationRole(user.role),
      createdAt: user.created_at, wrikeUserId: user.wrike_user_id,
      accountState: user.account_state as "active" | "deletion_pending",
      profileCompleted: Boolean(user.profile_completed),
      personaWrikeUserId: personasByUser.get(user.id)?.find((persona) => persona.operational_role === "id")?.wrike_user_id ?? null,
      operationalRoles: (personasByUser.get(user.id)?.map((persona) => persona.operational_role)
        ?? (user.role === "id" || user.role === "sme" ? [user.role] : [])) as Array<"id" | "sme">,
      managementRoles: (managementByUser.get(user.id)
        ?? (user.role === "admin" || user.role === "super_admin" ? [user.role] : [])) as Array<"sme_coordinator" | "admin" | "super_admin">,
      accessWrikeUserId: personasByUser.get(user.id)?.find((persona) => persona.wrike_user_id)?.wrike_user_id ?? user.wrike_user_id,
      deletionJobId: deletionJobByUser.get(user.id) ?? null,
      smeClassification: smeProfileByUser.get(user.id)?.classification as "internal" | "external" | null ?? null,
      smeClassificationUpdatedAt: smeProfileByUser.get(user.id)?.updated_at ?? null,
    };
  });
  const identityOptions = (wrikeUsers ?? []).map((identity) => ({ id: identity.id, name: identity.display_name, email: identity.email }));
  const occupiedIdWrikeUsers = new Set([
    ...(users ?? []).filter((user) => user.role === "id" && user.wrike_user_id).map((user) => user.wrike_user_id as string),
    ...(personas ?? []).filter((persona) => persona.application_user_id !== actor.id).map((persona) => persona.wrike_user_id),
  ]);
  const currentPersonaWrikeUserId = personasByUser.get(actor.id)?.find((persona) => persona.operational_role === "id")?.wrike_user_id ?? null;
  const personaIdentityOptions = identityOptions.filter((option) =>
    option.id === currentPersonaWrikeUserId || !occupiedIdWrikeUsers.has(option.id));
  return <AppShell isAdmin><header className="page-header"><div><p className="eyebrow">ADMINISTRATIVE FUNCTIONS</p><h1>User Management</h1><p>Add users, manage organization roles, and map ID and SME accounts to verified Wrike identities.</p></div></header>
    {managementRolesFailure ? <section className="notice warning" role="status">
      <strong>{managementRolesFailure.title}</strong>{" "}
      <span>{managementRolesFailure.message} Existing user administration remains available, but additive management-role controls are temporarily hidden.</span>
      {managementRolesFailure.diagnosticCode ? <p><strong>Database code:</strong> <code>{managementRolesFailure.diagnosticCode}</code></p> : null}
    </section> : null}
    <UserManagementPanel members={members} identities={identityOptions}
      personaIdentities={personaIdentityOptions}
      managerId={actor.id} managerRole={profile.role} impersonating={identity.impersonating} />
    {!managementRolesFailure ? <AdditiveAccessPanel members={members.map((member) => ({
      id: member.id, name: member.name, email: member.email,
      operationalRoles: member.operationalRoles, managementRoles: member.managementRoles,
      accessWrikeUserId: member.accessWrikeUserId,
      locked: member.managementRoles.includes("super_admin"),
    }))} identities={identityOptions} impersonating={identity.impersonating}
      canGrantAdmin={profile.access.managementRoles.includes("super_admin")} /> : null}
    <UserApprovalQueue users={pendingUsers} /></AppShell>;
}
