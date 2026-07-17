"use client";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { BarChart3, BookOpenCheck, BriefcaseBusiness, Database, FolderKanban, LogOut, Menu, Users, UsersRound, X } from "lucide-react";
import { DevTrackBrand } from "@/components/devtrack-brand";
import lexipolLogo from "@/images/Lexipol_logo_wht-60.png";
import { navigationForRole, navigationPathIsActive, type NavigationEntry } from "@/lib/navigation";

const icons = { dashboard: BarChart3, development: BookOpenCheck, sme: Users, other: UsersRound, projects: FolderKanban, users: BriefcaseBusiness, data: Database };

export function SidebarNavigation({ isAdmin, lastSynced }: { isAdmin: boolean; lastSynced?: string | null }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const entries = navigationForRole(isAdmin || pathname.startsWith("/admin"));
  const close = () => setMobileOpen(false);

  async function logout() {
    setLoggingOut(true);
    const response = await fetch("/api/auth/logout", { method: "POST" });
    if (response.ok) window.location.assign("/login");
    else setLoggingOut(false);
  }

  return <>
    <button className="sidebar-mobile-toggle" type="button" aria-controls="application-sidebar" aria-expanded={mobileOpen} aria-label={mobileOpen ? "Close navigation" : "Open navigation"} onClick={() => setMobileOpen((open) => !open)}>{mobileOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}<span>Menu</span></button>
    {mobileOpen && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={close} />}
    <aside id="application-sidebar" className={mobileOpen ? "sidebar-open" : undefined}>
      <div><DevTrackBrand /><nav aria-label="Primary navigation">{entries.map((entry) => entry.kind === "divider"
        ? <div className="nav-divider" role="separator" key={entry.id} />
        : <NavigationLink entry={entry} pathname={pathname} close={close} />)}</nav></div>
      <div className="sidebar-footer">
        {lastSynced !== undefined && <p className="sync-note">{lastSynced ? `Last imported ${new Date(lastSynced).toLocaleString()}` : "No project data imported yet"}</p>}
        <Image className="lexipol-logo" src={lexipolLogo} alt="Lexipol" width={142} />
        <button className="logout-button" type="button" onClick={logout} disabled={loggingOut}><LogOut size={18} aria-hidden="true" />{loggingOut ? "Logging out…" : "Logout"}</button>
      </div>
    </aside>
  </>;
}

function NavigationLink({ entry, pathname, close }: { entry: Extract<NavigationEntry, { kind: "link" }>; pathname: string; close: () => void }) {
  const Icon = icons[entry.id];
  const active = navigationPathIsActive(pathname, entry.href);
  return <Link href={entry.href} aria-current={active ? "page" : undefined} className={active ? "active" : undefined} onClick={close}><Icon size={18} aria-hidden="true" /><span>{entry.label}</span></Link>;
}
