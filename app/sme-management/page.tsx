import { AppShell } from "@/components/app-shell";
import { SmeManagementPanel, type SmeManagementRow } from "@/components/sme-management-panel";
import { requirePageCapability } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportingFailure } from "@/lib/reporting/failure";

export default async function SmeManagementPage() {
  const { supabase, profile } = await requirePageCapability("manage_smes");
  const [{ data: rows, error }, { data: profiles, error: profilesError }, { data: smeIdentities, error: smeIdentitiesError }] = await Promise.all([
    supabase.rpc("sme_management_rows"),
    createAdminClient().from("application_user_sme_profiles")
      .select("application_user_id,classification,updated_at").eq("organization_id", profile.organization_id),
    createAdminClient().from("sme_dashboard_identities")
      .select("id,display_name,normalized_name,resolution_status,ambiguity_reason,wrike_user_id,application_user_id,project_folder_url")
      .eq("organization_id", profile.organization_id).order("display_name"),
  ]);
  if (profilesError) throw new Error("SME account types could not be loaded.");
  if (smeIdentitiesError) throw new Error("Field-derived SME identities could not be loaded.");
  const failure = error
    ? reportingFailure(error, "SME Management", "202609020001_sme_management_field_derived_identities.sql")
    : null;
  const projectFolderUrlByIdentity = new Map((smeIdentities ?? []).map((identity) => [identity.id, identity.project_folder_url as string | null]));
  return <AppShell><div className="sme-management-page"><header className="page-header"><div><p className="eyebrow">SME MANAGEMENT</p><h1>SME Management</h1>
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
      project_folder_url: projectFolderUrlByIdentity.get(row.sme_identity_id) ?? null,
    })) as SmeManagementRow[]} identities={(smeIdentities ?? []).map((identity) => ({
      id: identity.id, name: identity.display_name, normalizedName: identity.normalized_name,
      resolutionStatus: identity.resolution_status as "discovered" | "verified" | "ambiguous" | "resolved",
      ambiguityReason: identity.ambiguity_reason, wrikeUserId: identity.wrike_user_id,
      applicationUserId: identity.application_user_id,
    }))} />}</div></AppShell>;
}
