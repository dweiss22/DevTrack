import { SidebarNavigation } from "@/components/sidebar-navigation";
import { createClient } from "@/lib/supabase/server";
import { applicationUserDisplayName } from "@/lib/users/application-user-display";
import { normalizeApplicationRole } from "@/lib/auth/roles";

export async function AppShell({ children, lastSynced, isAdmin = false }: { children: React.ReactNode; lastSynced?: string | null; isAdmin?: boolean }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: applicationUser } = user
    ? await supabase.from("application_users").select("display_name,role").eq("id", user.id).maybeSingle()
    : { data: null };
  const profileName = user ? applicationUserDisplayName(applicationUser?.display_name ?? null, user) : "My profile";
  const role = normalizeApplicationRole(applicationUser?.role ?? (isAdmin ? "admin" : "id"));
  return <div className="app-shell"><SidebarNavigation role={role} lastSynced={lastSynced} profileName={profileName} /><main>{children}</main></div>;
}
