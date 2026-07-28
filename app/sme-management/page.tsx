import { AppShell } from "@/components/app-shell";
import { SmeManagementPanel, type SmeManagementRow } from "@/components/sme-management-panel";
import { requirePageCapability } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function SmeManagementPage() {
  const { supabase, profile } = await requirePageCapability("manage_smes");
  const [{ data: rows, error }, { data: identities, error: identitiesError }] = await Promise.all([
    supabase.rpc("sme_management_rows"),
    createAdminClient().from("wrike_users").select("id,display_name,email").eq("organization_id", profile.organization_id)
      .eq("is_active", true).eq("is_unresolved", false).eq("identity_verified", true).order("display_name"),
  ]);
  if (error) throw new Error("SME Management could not be loaded.");
  if (identitiesError) throw new Error("Verified SME identities could not be loaded.");
  return <AppShell><header className="page-header"><div><p className="eyebrow">SME MANAGEMENT</p><h1>SME Management</h1>
    <p>Organization-wide SME access, assignments, survey completion, and submitted billing.</p></div></header>
    <SmeManagementPanel rows={(rows ?? []) as SmeManagementRow[]} identities={(identities ?? []).map((identity) => ({
      id: identity.id, name: identity.display_name, email: identity.email,
    }))} /></AppShell>;
}
