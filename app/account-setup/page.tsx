import { redirect } from "next/navigation";
import { AccountSetupForm } from "@/components/account-setup-form";
import { createClient } from "@/lib/supabase/server";

export default async function AccountSetupPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: membership } = await supabase.from("application_users").select("display_name,profile_completed").eq("id", user.id).maybeSingle();
  if (!membership) redirect("/access-pending");
  if (membership.profile_completed) redirect("/");
  const metadataName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "";
  return <AccountSetupForm email={user.email ?? "Unavailable"} initialDisplayName={membership.display_name ?? metadataName} />;
}
