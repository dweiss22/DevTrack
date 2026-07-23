export const APPLICATION_ROLES = ["super_admin", "admin", "id", "sme"] as const;
export type ApplicationRole = typeof APPLICATION_ROLES[number];

export const CAPABILITIES = [
  "manage_users",
  "manage_settings",
  "manage_integrations",
  "manage_data",
  "view_standard_pages",
  "view_sme_dashboard",
  "select_sme_dashboard_user",
  "edit_own_profile",
] as const;
export type Capability = typeof CAPABILITIES[number];

const roleCapabilities: Record<ApplicationRole, ReadonlySet<Capability>> = {
  super_admin: new Set(CAPABILITIES),
  admin: new Set(CAPABILITIES),
  id: new Set(["view_standard_pages", "view_sme_dashboard", "select_sme_dashboard_user", "edit_own_profile"]),
  sme: new Set(["view_sme_dashboard", "edit_own_profile"]),
};

export function normalizeApplicationRole(value: unknown): ApplicationRole {
  if (value === "super_admin" || value === "admin" || value === "id" || value === "sme") return value;
  if (value === "member") return "id";
  throw new Error("DevTrack encountered an unsupported application role.");
}

export function hasCapability(role: ApplicationRole, capability: Capability) {
  return roleCapabilities[role].has(capability);
}

export function isAdministratorRole(role: ApplicationRole) {
  return hasCapability(role, "manage_settings");
}

export function roleLabel(role: ApplicationRole) {
  return role === "super_admin" ? "SuperAdmin" : role === "admin" ? "Admin" : role === "id" ? "ID" : "SME";
}

export function landingPageForRole(role: ApplicationRole) {
  return role === "sme" ? "/sme-dashboard" : "/";
}

export function assignableRolesFor(actorRole: ApplicationRole): ApplicationRole[] {
  return hasCapability(actorRole, "manage_users") ? ["admin", "id", "sme"] : [];
}
