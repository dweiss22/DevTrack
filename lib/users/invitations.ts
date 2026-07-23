import { env } from "@/lib/env";
import type { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

export const applicationRoleSchema = z.enum(["admin", "id", "sme"]);
export const invitationInputSchema = z.object({
  email: z.string().trim().email().max(320),
  role: applicationRoleSchema,
});

export function normalizeInvitationEmail(email: string) {
  return email.trim().toLowerCase();
}

export function accountSetupRedirectUrl() {
  return new URL("/auth/confirm?next=/account-setup", env.NEXT_PUBLIC_APP_URL).toString();
}

export async function findAuthenticationUserByEmail(admin: ReturnType<typeof createAdminClient>, email: string) {
  const normalizedEmail = normalizeInvitationEmail(email);
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const match = data.users.find((candidate) => normalizeInvitationEmail(candidate.email ?? "") === normalizedEmail);
    if (match) return match;
    if (data.users.length < 1000) return null;
  }
  throw new Error("The authentication directory is too large to search safely.");
}
