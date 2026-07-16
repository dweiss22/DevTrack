import Link from "next/link";
import { BarChart3, Clock3, FolderKanban, MessageCircleQuestion, Settings, UsersRound } from "lucide-react";

const links = [{ href: "/", label: "Overview", icon: BarChart3 }, { href: "/tasks", label: "Tasks", icon: FolderKanban }, { href: "/team", label: "Team", icon: UsersRound }, { href: "/time-entries", label: "Time entries", icon: Clock3 }, { href: "/ask", label: "Ask DevTrack", icon: MessageCircleQuestion }, { href: "/admin", label: "Administration", icon: Settings }];
export function AppShell({ children, lastSynced }: { children: React.ReactNode; lastSynced?: string | null }) {
  return <div className="app-shell"><aside><Link className="brand" href="/"><span>DT</span> DevTrack</Link><nav>{links.map(({ href, label, icon: Icon }) => <Link href={href} key={href}><Icon size={18} />{label}</Link>)}</nav><p className="sync-note">{lastSynced ? `Last synced ${new Date(lastSynced).toLocaleString()}` : "No data synced yet"}</p></aside><main>{children}</main></div>;
}
