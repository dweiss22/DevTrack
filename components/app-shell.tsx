import { SidebarNavigation } from "@/components/sidebar-navigation";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { requireContext } from "@/lib/auth";

export async function AppShell({ children, lastSynced, isAdmin = false }: { children: React.ReactNode; lastSynced?: string | null; isAdmin?: boolean }) {
  void isAdmin;
  const { identity, profile } = await requireContext();
  const profileName = profile.display_name?.trim() || identity.effectiveName || "My profile";
  return <div className="app-shell">
    <SidebarNavigation role={profile.role} lastSynced={lastSynced} profileName={profileName} impersonating={identity.impersonating} />
    <main>
      {identity.impersonating && identity.lastActivityAt && identity.absoluteExpiresAt
        ? <ImpersonationBanner effectiveName={identity.effectiveName} actorName={identity.actorName}
          lastActivityAt={identity.lastActivityAt} absoluteExpiresAt={identity.absoluteExpiresAt} />
        : null}
      {children}
    </main>
  </div>;
}
