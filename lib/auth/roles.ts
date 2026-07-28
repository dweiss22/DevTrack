export const APPLICATION_ROLES = ["super_admin", "admin", "id", "sme"] as const;
export type ApplicationRole = typeof APPLICATION_ROLES[number];
export const OPERATIONAL_ROLES = ["id", "sme"] as const;
export type OperationalRole = typeof OPERATIONAL_ROLES[number];
export const MANAGEMENT_ROLES = ["sme_coordinator", "admin", "super_admin"] as const;
export type ManagementRole = typeof MANAGEMENT_ROLES[number];

export type AccessProfile = {
  legacyRole: ApplicationRole;
  operationalRoles: OperationalRole[];
  managementRoles: ManagementRole[];
};

export const CAPABILITIES = [
  "manage_users",
  "manage_settings",
  "manage_integrations",
  "manage_data",
  "view_standard_pages",
  "view_sme_dashboard",
  "select_sme_dashboard_user",
  "view_id_dashboard",
  "select_id_dashboard_user",
  "view_surveys",
  "view_personal_surveys",
  "create_sme_debrief",
  "create_id_review",
  "manage_surveys",
  "impersonate_users",
  "delete_users",
  "manage_operational_personas",
  "manage_smes",
  "view_sme_survey_details",
  "view_personal_survey_index",
  "edit_own_profile",
] as const;
export type Capability = typeof CAPABILITIES[number];

const roleCapabilities: Record<ApplicationRole, ReadonlySet<Capability>> = {
  super_admin: new Set(CAPABILITIES.filter((capability) =>
    capability !== "view_personal_surveys" && capability !== "view_personal_survey_index")),
  admin: new Set(CAPABILITIES.filter((capability) =>
    capability !== "manage_operational_personas" && capability !== "view_personal_surveys"
      && capability !== "view_personal_survey_index")),
  id: new Set(["view_standard_pages", "view_sme_dashboard", "select_sme_dashboard_user", "view_id_dashboard", "view_surveys", "view_personal_surveys", "view_personal_survey_index", "create_id_review", "edit_own_profile"]),
  sme: new Set(["view_sme_dashboard", "view_surveys", "view_personal_surveys", "create_sme_debrief", "edit_own_profile"]),
};

const managementCapabilities: Record<ManagementRole, ReadonlySet<Capability>> = {
  sme_coordinator: new Set([
    "view_sme_dashboard", "select_sme_dashboard_user", "manage_smes",
    "view_sme_survey_details", "view_surveys", "edit_own_profile",
  ]),
  admin: roleCapabilities.admin,
  super_admin: roleCapabilities.super_admin,
};

const operationalCapabilities: Record<OperationalRole, ReadonlySet<Capability>> = {
  id: roleCapabilities.id,
  sme: roleCapabilities.sme,
};

export function normalizeApplicationRole(value: unknown): ApplicationRole {
  if (value === "super_admin" || value === "admin" || value === "id" || value === "sme") return value;
  if (value === "member") return "id";
  throw new Error("DevTrack encountered an unsupported application role.");
}

export function accessProfileForLegacyRole(role: ApplicationRole): AccessProfile {
  return {
    legacyRole: role,
    operationalRoles: role === "id" || role === "sme" ? [role] : [],
    managementRoles: role === "super_admin" || role === "admin" ? [role] : [],
  };
}

export function normalizeAccessProfile(value: Partial<AccessProfile> | null | undefined, fallbackRole: ApplicationRole): AccessProfile {
  const operationalRoles = [...new Set((value?.operationalRoles ?? []).filter((role): role is OperationalRole =>
    role === "id" || role === "sme"))];
  const managementRoles = [...new Set((value?.managementRoles ?? []).filter((role): role is ManagementRole =>
    role === "sme_coordinator" || role === "admin" || role === "super_admin"))];
  const fallback = accessProfileForLegacyRole(fallbackRole);
  return {
    legacyRole: fallbackRole,
    operationalRoles: operationalRoles.length ? operationalRoles : fallback.operationalRoles,
    managementRoles: managementRoles.length ? managementRoles : fallback.managementRoles,
  };
}

export function hasCapability(access: ApplicationRole | AccessProfile, capability: Capability) {
  if (typeof access === "string") return roleCapabilities[access].has(capability);
  return access.operationalRoles.some((role) => operationalCapabilities[role].has(capability))
    || access.managementRoles.some((role) => managementCapabilities[role].has(capability));
}

export function isAdministratorRole(access: ApplicationRole | AccessProfile) {
  return hasCapability(access, "manage_settings");
}

export function roleLabel(role: ApplicationRole) {
  return role === "super_admin" ? "SuperAdmin" : role === "admin" ? "Admin" : role === "id" ? "ID" : "SME";
}

export function landingPageForRole(role: ApplicationRole | AccessProfile) {
  const access = typeof role === "string" ? accessProfileForLegacyRole(role) : role;
  if (hasCapability(access, "view_standard_pages")) return "/";
  if (hasCapability(access, "view_sme_dashboard")) return "/sme-dashboard";
  return "/profile";
}

export function assignableRolesFor(actorRole: ApplicationRole): ApplicationRole[] {
  return hasCapability(actorRole, "manage_users") ? ["admin", "id", "sme"] : [];
}
