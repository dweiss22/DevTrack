import { AppShell } from "@/components/app-shell";
import { AskPanel } from "@/components/ask-panel";
import { requirePageCapability } from "@/lib/auth";
import { isAdministratorRole } from "@/lib/auth/roles";

export default async function AskPage() {
  const { user, profile, supabase } = await requirePageCapability("view_standard_pages");
  const [{ data: organization }, { data: conversations }] = await Promise.all([
    supabase.from("organizations").select("ask_enabled").eq("id", profile.organization_id).single(),
    supabase.from("reporting_conversations").select("id,title,updated_at").eq("user_id", user.id).order("updated_at", { ascending: false }).limit(100)
  ]);
  return <AppShell isAdmin={isAdministratorRole(profile.role)}><header className="page-header"><div><p className="eyebrow">ASK DEVTRACK</p><h1>Questions grounded in your reports</h1><p>Answers use synchronized reporting records from your DevTrack organization.</p></div></header><AskPanel enabled={Boolean(organization?.ask_enabled)} initialConversations={conversations ?? []} /></AppShell>;
}
