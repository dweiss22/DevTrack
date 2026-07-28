import { AppShell } from "@/components/app-shell";
import { SmeManagementPanel, type SmeManagementRow } from "@/components/sme-management-panel";
import { requirePageCapability } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportingFailure } from "@/lib/reporting/failure";

export default async function SmeManagementPage() {
  const { supabase, profile } = await requirePageCapability("manage_smes");
  const [{ data: rows, error }, { data: identities, error: identitiesError }] = await Promise.all([
    supabase.rpc("sme_management_rows"),
    createAdminClient().from("wrike_users").select("id,display_name,email").eq("organization_id", profile.organization_id)
      .eq("is_active", true).eq("is_unresolved", false).eq("identity_verified", true).order("display_name"),
  ]);
  if (identitiesError) throw new Error("Verified SME identities could not be loaded.");
  const failure = error
    ? reportingFailure(error, "SME Management", "202607280001_additive_management_roles.sql and 202607280002_sme_management_experience.sql")
    : null;
  return <AppShell><header className="page-header"><div><p className="eyebrow">SME MANAGEMENT</p><h1>SME Management</h1>
    <p>Organization-wide SME access, assignments, survey completion, and submitted billing.</p></div></header>
    {failure ? <section className="card dashboard-query-error" role="alert">
      <p className="eyebrow">SME MANAGEMENT DATA</p>
      <h2>{failure.title}</h2>
      <p>{failure.message}</p>
      {failure.diagnosticCode ? <p><strong>Database code:</strong> <code>{failure.diagnosticCode}</code></p> : null}
      <a className="button secondary" href="/sme-management">Retry SME Management</a>
    </section> : <SmeManagementPanel rows={(rows ?? []) as SmeManagementRow[]} identities={(identities ?? []).map((identity) => ({
      id: identity.id, name: identity.display_name, email: identity.email,
    }))} />}</AppShell>;
}
