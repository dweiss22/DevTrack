import { hasCapability, type ApplicationRole, type Capability } from "@/lib/auth/roles";

export type NavigationEntry =
  | { kind: "link"; id: "dashboard" | "development" | "sme-dashboard" | "id-dashboard" | "surveys" | "projects" | "users" | "data"; href: string; label: string; capability: Capability }
  | { kind: "divider"; id: "projects-divider" | "administration-divider" };

export const APPLICATION_NAVIGATION: readonly NavigationEntry[] = [
  { kind: "link", id: "dashboard", href: "/", label: "Dashboard", capability: "view_standard_pages" },
  { kind: "link", id: "development", href: "/development", label: "Development", capability: "view_standard_pages" },
  { kind: "link", id: "sme-dashboard", href: "/sme-dashboard", label: "SME Dashboard", capability: "view_sme_dashboard" },
  { kind: "link", id: "id-dashboard", href: "/id-dashboard", label: "ID Dashboard", capability: "view_id_dashboard" },
  { kind: "link", id: "surveys", href: "/surveys", label: "Surveys", capability: "view_surveys" },
  { kind: "divider", id: "projects-divider" },
  { kind: "link", id: "projects", href: "/projects", label: "Projects", capability: "view_standard_pages" },
  { kind: "divider", id: "administration-divider" },
  { kind: "link", id: "users", href: "/admin/users", label: "User Management", capability: "manage_users" },
  { kind: "link", id: "data", href: "/admin", label: "Data", capability: "manage_data" }
];

export function navigationForRole(role: ApplicationRole) {
  return APPLICATION_NAVIGATION.filter((entry) => entry.kind === "divider" || hasCapability(role, entry.capability))
    .filter((entry, index, entries) => entry.kind !== "divider" || (entries[index - 1]?.kind === "link" && entries.slice(index + 1).some((candidate) => candidate.kind === "link")));
}

export function navigationPathIsActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/projects") return pathname === href || pathname.startsWith(`${href}/`);
  return pathname === href;
}
