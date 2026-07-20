import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const requireContext = cache(async function requireContext() {
  const supabase = await createClient();
  const { data, error: claimsError } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const userId = typeof claims?.sub === "string" ? claims.sub : null;
  if (claimsError || !userId) redirect("/login");
  const { data: profile, error } = await supabase.from("application_users").select("organization_id, role, display_name").eq("id", userId).single();
  if (error || !profile) throw new Error("Your account is not assigned to an organization. Ask an administrator for access.");
  const user = { id: userId, email: typeof claims?.email === "string" ? claims.email : null };
  return { user, profile, supabase };
});
export async function requireAdmin() {
  const context = await requireContext();
  if (context.profile.role !== "admin") throw new Error("Administrator access is required.");
  return context;
}
