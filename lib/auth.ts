import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasCapability, landingPageForRole, normalizeApplicationRole, type Capability } from "@/lib/auth/roles";
import type { RequestIdentityContext } from "@/lib/auth/impersonation";

export const requireContext = cache(async function requireContext() {
  const supabase = await createClient();
  const { data, error: claimsError } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const actorUserId = typeof claims?.sub === "string" ? claims.sub : null;
  if (claimsError || !actorUserId) redirect("/login");
  const { data: rawIdentity, error: identityError } = await supabase.rpc("current_request_identity");
  const identity = rawIdentity as RequestIdentityContext | null;
  if (identityError || !identity) redirect("/login");
  const { data: storedProfile, error } = await supabase.from("application_users").select("organization_id, role, display_name, profile_completed,wrike_user_id,account_state").eq("id", identity.effectiveUserId).maybeSingle();
  if (error) throw new Error("DevTrack could not verify your organization access. Retry the request.");
  if (!storedProfile || storedProfile.account_state !== "active") redirect("/access-pending");
  const profile = { ...storedProfile, role: normalizeApplicationRole(storedProfile.role) };
  if (!profile.profile_completed) redirect("/account-setup");
  const user = {
    id: identity.effectiveUserId,
    email: identity.effectiveEmail ?? (identity.impersonating ? null : typeof claims?.email === "string" ? claims.email : null),
  };
  const actor = { id: actorUserId, role: normalizeApplicationRole(identity.actorRole), name: identity.actorName };
  return { user, actor, identity, profile, supabase };
});
export async function requireAdmin() {
  return requireCapability("manage_settings");
}
export async function requireCapability(capability: Capability) {
  const context = await requireContext();
  if (!hasCapability(context.profile.role, capability)) throw new Error("You do not have permission to perform this action.");
  return context;
}
export async function requirePageCapability(capability: Capability) {
  const context = await requireContext();
  if (!hasCapability(context.profile.role, capability)) redirect(landingPageForRole(context.profile.role));
  return context;
}
