import { AppShell } from "@/components/app-shell";
import { SmeManagementPanel, type SmeManagementRow } from "@/components/sme-management-panel";
import { requirePageCapability } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportingFailure } from "@/lib/reporting/failure";

export default async function SmeManagementPage() {
  const { supabase, profile } = await requirePageCapability("manage_smes");
  const [{ data: rows, error }, { data: identities, error: identitiesError }, { data: profiles, error: profilesError }] = await Promise.all([
    supabase.rpc("sme_management_rows"),
    createAdminClient().from("wrike_users").select("id,display_name,email").eq("organization_id", profile.organization_id)
      .eq("is_active", true).eq("is_unresolved", false).eq("identity_verified", true).order("display_name"),
    createAdminClient().from("application_user_sme_profiles")
      .select("application_user_id,classification,updated_at").eq("organization_id", profile.organization_id),
  ]);
  if (identitiesError) throw new Error("Verified SME identities could not be loaded.");
  if (profilesError) throw new Error("SME account types could not be loaded.");
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
    </section> : <SmeManagementPanel rows={(rows ?? []).map((row: SmeManagementRow) => ({
      ...row,
      sme_classification: profiles?.find((item) => item.application_user_id === row.application_user_id)?.classification ?? null,
      sme_classification_updated_at: profiles?.find((item) => item.application_user_id === row.application_user_id)?.updated_at ?? null,
    })) as SmeManagementRow[]} identities={(identities ?? []).map((identity) => ({
      id: identity.id, name: identity.display_name, email: identity.email,
    }))} />}</AppShell>;
}
