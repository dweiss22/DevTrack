import { SidebarNavigation } from "@/components/sidebar-navigation";

export function AppShell({ children, lastSynced, isAdmin = false }: { children: React.ReactNode; lastSynced?: string | null; isAdmin?: boolean }) {
  return <div className="app-shell"><SidebarNavigation isAdmin={isAdmin} lastSynced={lastSynced} /><main>{children}</main></div>;
}
