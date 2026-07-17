import { AppShell } from "@/components/app-shell";
import { requireAdmin } from "@/lib/auth";

export default async function UserManagementPage() {
  const { supabase, profile } = await requireAdmin();
  const { data: users, error } = await supabase.from("application_users").select("id,display_name,role,created_at").eq("organization_id", profile.organization_id).order("display_name");
  if (error) throw new Error(`User management could not be loaded: ${error.message}`);
  return <AppShell isAdmin><header className="page-header"><div><p className="eyebrow">ADMINISTRATIVE FUNCTIONS</p><h1>User Management</h1><p>Organization membership and application roles. Authentication remains managed by Supabase.</p></div></header>{users?.length ? <table><thead><tr><th>User</th><th>Role</th><th>Added</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td>{user.display_name ?? user.id}</td><td>{user.role}</td><td>{new Date(user.created_at).toLocaleDateString()}</td></tr>)}</tbody></table> : <p className="card empty">No application users are assigned to this organization.</p>}</AppShell>;
}
