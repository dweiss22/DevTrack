import { AppShell } from "@/components/app-shell";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { applicationUserDisplayName, applicationUserEmail } from "@/lib/users/application-user-display";

export default async function UserManagementPage() {
  const { supabase, profile } = await requireAdmin();
  const admin = createAdminClient();
  const [{ data: users, error }, { data: authentication, error: authenticationError }] = await Promise.all([
    supabase.from("application_users").select("id,display_name,role,created_at").eq("organization_id", profile.organization_id).order("display_name"),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);
  if (error) throw new Error(`User management could not be loaded: ${error.message}`);
  if (authenticationError) throw new Error(`User names could not be loaded from authentication: ${authenticationError.message}`);

  const authenticationById = new Map(authentication.users.map((user) => [user.id, user]));
  return <AppShell isAdmin><header className="page-header"><div><p className="eyebrow">ADMINISTRATIVE FUNCTIONS</p><h1>User Management</h1><p>Organization membership and application roles. Authentication remains managed by Supabase.</p></div></header>{users?.length ? <table><thead><tr><th>User</th><th>Email</th><th>Role</th><th>Added</th></tr></thead><tbody>{users.map((user) => {
    const authenticationUser = authenticationById.get(user.id);
    return <tr key={user.id}><td>{applicationUserDisplayName(user.display_name, authenticationUser)}</td><td>{applicationUserEmail(authenticationUser)}</td><td>{user.role}</td><td>{new Date(user.created_at).toLocaleDateString()}</td></tr>;
  })}</tbody></table> : <p className="card empty">No application users are assigned to this organization.</p>}</AppShell>;
}
