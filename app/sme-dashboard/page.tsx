import { AppShell } from "@/components/app-shell";
import { SmeDashboard, type SmeDashboardRow, type SmeDashboardUser } from "@/components/sme-dashboard";
import { requirePageCapability } from "@/lib/auth";
import { hasCapability, isAdministratorRole } from "@/lib/auth/roles";

export default async function SmeDashboardPage({ searchParams }: { searchParams: Promise<{ sme?: string }> }) {
  const { user, profile, supabase } = await requirePageCapability("view_sme_dashboard");
  const requested = (await searchParams).sme;
  const { data: userRows, error: usersError } = await supabase.rpc("reporting_sme_dashboard_users");
  if (usersError) throw new Error("The SME Dashboard user list could not be loaded.");
  const users = (userRows ?? []) as SmeDashboardUser[];
  const canSelect = hasCapability(profile.role, "select_sme_dashboard_user");
  const selectedId = canSelect ? requested : user.id;
  const selected = users.find((candidate) => candidate.application_user_id === selectedId) ?? null;
  const { data: taskRows, error: tasksError } = selected
    ? await supabase.rpc("reporting_sme_dashboard", { target_application_user_id: selected.application_user_id })
    : { data: [], error: null };
  if (tasksError) throw new Error("The selected SME Dashboard could not be loaded.");

  return <AppShell isAdmin={isAdministratorRole(profile.role)}><header className="page-header"><div><p className="eyebrow">ASSIGNED COURSE DEVELOPMENT</p><h1>SME Dashboard{selected ? ` — ${selected.display_name}` : ""}</h1><p>Assignment, status, timing, and synchronized effort for one authorized SME identity.</p></div></header><SmeDashboard users={users} selected={selected} rows={(taskRows ?? []) as SmeDashboardRow[]} canSelect={canSelect} /></AppShell>;
}
