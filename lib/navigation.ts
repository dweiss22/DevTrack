export type NavigationEntry =
  | { kind: "link"; id: "dashboard" | "development" | "sme" | "other" | "projects" | "users" | "data"; href: string; label: string; adminOnly?: boolean }
  | { kind: "divider"; id: "projects-divider" | "administration-divider" };

export const APPLICATION_NAVIGATION: readonly NavigationEntry[] = [
  { kind: "link", id: "dashboard", href: "/", label: "Dashboard" },
  { kind: "link", id: "development", href: "/development", label: "Development" },
  { kind: "link", id: "sme", href: "/sme-collaboration", label: "SME Collaboration" },
  { kind: "link", id: "other", href: "/other-teams", label: "Other Teams" },
  { kind: "divider", id: "projects-divider" },
  { kind: "link", id: "projects", href: "/projects", label: "Projects" },
  { kind: "divider", id: "administration-divider" },
  { kind: "link", id: "users", href: "/admin/users", label: "User Management", adminOnly: true },
  { kind: "link", id: "data", href: "/admin", label: "Data", adminOnly: true }
];

export function navigationForRole(isAdmin: boolean) {
  return APPLICATION_NAVIGATION.filter((entry) => entry.kind === "divider" || !entry.adminOnly || isAdmin)
    .filter((entry, index, entries) => entry.kind !== "divider" || (entries[index - 1]?.kind === "link" && entries.slice(index + 1).some((candidate) => candidate.kind === "link")));
}

export function navigationPathIsActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/projects") return pathname === href || pathname.startsWith(`${href}/`);
  return pathname === href;
}
