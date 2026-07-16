import Image from "next/image";
import Link from "next/link";
import { BarChart3, FolderKanban, Settings } from "lucide-react";
import { DevTrackBrand } from "@/components/devtrack-brand";
import lexipolLogo from "@/images/Lexipol_logo_wht-60.png";

const links = [{ href: "/", label: "Overview", icon: BarChart3 }, { href: "/tasks", label: "Tasks", icon: FolderKanban }, { href: "/admin", label: "Administration", icon: Settings }];
export function AppShell({ children, lastSynced }: { children: React.ReactNode; lastSynced?: string | null }) {
  return <div className="app-shell"><aside><div><DevTrackBrand /><nav>{links.map(({ href, label, icon: Icon }) => <Link href={href} key={href}><Icon size={18} />{label}</Link>)}</nav></div><div className="sidebar-footer"><Image className="lexipol-logo" src={lexipolLogo} alt="Lexipol" width={142} /><p className="sync-note">{lastSynced ? `Last imported ${new Date(lastSynced).toLocaleString()}` : "No task data imported yet"}</p></div></aside><main>{children}</main></div>;
}
