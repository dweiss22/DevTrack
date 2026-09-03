import { env } from "@/lib/env";
import type { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";
import { smeClassificationSchema } from "@/lib/smes/domain";

export const applicationRoleSchema = z.enum(["admin", "id", "sme", "project_reviewer", "videographer"]);
export const operationalInvitationRoleSchema = z.enum(["id", "sme", "project_reviewer", "videographer"]);
export const invitationInputSchema = z.object({
  email: z.string().trim().email().max(320),
  role: operationalInvitationRoleSchema,
  smeClassification: smeClassificationSchema.optional(),
}).superRefine((value, context) => {
  if (value.role === "sme" && !value.smeClassification) {
    context.addIssue({
      code: "custom",
      path: ["smeClassification"],
      message: "Select Internal SME or External SME.",
    });
  }
});

export function normalizeInvitationEmail(email: string) {
  return email.trim().toLowerCase();
}

export function passwordRecoveryRedirectUrl() {
  return new URL("/auth/recovery", env.NEXT_PUBLIC_APP_URL).toString();
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
