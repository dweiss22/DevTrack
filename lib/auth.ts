import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function requireContext() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile, error } = await supabase.from("application_users").select("organization_id, role, display_name").eq("id", user.id).single();
  if (error || !profile) throw new Error("Your account is not assigned to an organization. Ask an administrator for access.");
  return { user, profile, supabase };
}
export async function requireAdmin() {
  const context = await requireContext();
  if (context.profile.role !== "admin") throw new Error("Administrator access is required.");
  return context;
}
