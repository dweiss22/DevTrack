import { hasCapability, type AccessProfile, type ApplicationRole, type Capability } from "@/lib/auth/roles";

export type NavigationEntry =
  | { kind: "link"; id: "dashboard" | "development" | "sme-dashboard" | "sme-management" | "id-dashboard" | "surveys" | "survey-results" | "projects" | "users" | "data" | "admin-surveys"; href: string; label: string; capability: Capability }
  | { kind: "divider"; id: "projects-divider" | "administration-divider" };

export const APPLICATION_NAVIGATION: readonly NavigationEntry[] = [
  { kind: "link", id: "dashboard", href: "/", label: "Dashboard", capability: "view_core_pages" },
  { kind: "link", id: "development", href: "/development", label: "Development", capability: "view_core_pages" },
  { kind: "link", id: "sme-dashboard", href: "/sme-dashboard", label: "SME Dashboard", capability: "view_sme_dashboard" },
  { kind: "link", id: "id-dashboard", href: "/id-dashboard", label: "ID Dashboard", capability: "view_id_dashboard" },
  { kind: "link", id: "surveys", href: "/surveys", label: "Surveys", capability: "view_personal_survey_index" },
  { kind: "link", id: "survey-results", href: "/survey-results", label: "Survey Results", capability: "view_surveys" },
  { kind: "divider", id: "projects-divider" },
  { kind: "link", id: "projects", href: "/projects", label: "Projects", capability: "view_core_pages" },
  { kind: "divider", id: "administration-divider" },
  { kind: "link", id: "sme-management", href: "/sme-management", label: "SME Management", capability: "manage_smes" },
  { kind: "link", id: "users", href: "/admin/users", label: "User Management", capability: "manage_users" },
  { kind: "link", id: "data", href: "/admin", label: "Data", capability: "manage_data" },
  { kind: "link", id: "admin-surveys", href: "/admin/surveys", label: "Surveys", capability: "manage_surveys" }
];

export function navigationForRole(role: ApplicationRole | AccessProfile) {
  return APPLICATION_NAVIGATION.filter((entry) => entry.kind === "divider" || hasCapability(role, entry.capability))
    .filter((entry, index, entries) => entry.kind !== "divider" || (entries[index - 1]?.kind === "link" && entries.slice(index + 1).some((candidate) => candidate.kind === "link")));
}

export function navigationPathIsActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/projects") return pathname === href || pathname.startsWith(`${href}/`);
  if (href === "/admin/surveys") return pathname === href || pathname.startsWith(`${href}/`);
  return pathname === href;
}
