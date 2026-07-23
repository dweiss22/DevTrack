import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  IMPERSONATION_IDLE_SECONDS,
  IMPERSONATION_MAX_SECONDS,
  isBlockedDuringImpersonation,
  newImpersonationToken,
} from "@/lib/auth/impersonation";
import { hasCapability } from "@/lib/auth/roles";

const root = process.cwd();
const source = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const principalsMigration = source("supabase/migrations/202607230009_application_principals_and_impersonation.sql");
const deletionMigration = source("supabase/migrations/202607230010_retryable_user_offboarding.sql");
const personaMigration = source("supabase/migrations/202607230011_superadmin_id_persona.sql");

describe("secure administrator identity workflows", () => {
  it("generates opaque split tokens and stores only their hashes", async () => {
    const first = await newImpersonationToken();
    const second = await newImpersonationToken();
    expect(first.token).toMatch(/^[0-9a-f-]{36}\.[0-9a-f]{64}$/);
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.token).not.toContain(first.hash);
    expect(second.token).not.toBe(first.token);
    expect(principalsMigration).toContain("token_hash text not null unique");
    expect(principalsMigration).not.toContain("token_secret");
  });

  it("enforces inactivity and absolute expiration without privilege fallback", () => {
    expect(IMPERSONATION_IDLE_SECONDS).toBe(15 * 60);
    expect(IMPERSONATION_MAX_SECONDS).toBe(60 * 60);
    expect(principalsMigration).toContain("last_activity_at>now()-interval '15 minutes'");
    expect(principalsMigration).toContain("absolute_expires_at>now()");
    expect(principalsMigration).toContain("if token is null then return public.current_actor_user_id(); end if");
    expect(principalsMigration).toContain("where session.id=public.current_impersonation_session_id()");
    expect(principalsMigration).toContain("return effective_id");
    expect(principalsMigration).toContain("Invalid or replayed impersonation token.");
  });

  it("blocks security-sensitive operations during impersonation", () => {
    expect(isBlockedDuringImpersonation("/api/admin/users/target", "PATCH")).toBe(true);
    expect(isBlockedDuringImpersonation("/api/admin/impersonations", "POST")).toBe(true);
    expect(isBlockedDuringImpersonation("/api/wrike/disconnect", "POST")).toBe(true);
    expect(isBlockedDuringImpersonation("/api/auth/logout", "POST")).toBe(true);
    expect(isBlockedDuringImpersonation("/api/surveys/id", "GET")).toBe(false);
    expect(isBlockedDuringImpersonation("/api/surveys/id", "POST")).toBe(false);
  });

  it("adds centralized capabilities with server-side role restrictions", () => {
    for (const capability of ["impersonate_users", "delete_users"] as const) {
      expect(hasCapability("super_admin", capability)).toBe(true);
      expect(hasCapability("admin", capability)).toBe(true);
      expect(hasCapability("id", capability)).toBe(false);
      expect(hasCapability("sme", capability)).toBe(false);
    }
    expect(hasCapability("super_admin", "manage_operational_personas")).toBe(true);
    expect(hasCapability("admin", "manage_operational_personas")).toBe(false);
    expect(principalsMigration).toContain("target.role='super_admin'");
    expect(principalsMigration).toContain("actor.role='admin' and target.role='admin'");
    expect(personaMigration).toContain("target_email<>'dweiss@lexipol.com'");
  });

  it("retains immutable history under anonymized non-login principals", () => {
    expect(principalsMigration).toContain("application_user_principals");
    expect(principalsMigration).toContain("normalized_email_hash");
    expect(deletionMigration).toContain("'Deleted user'");
    expect(principalsMigration).toContain("join public.application_user_principals creator");
    expect(deletionMigration).toContain("account_state='deletion_pending'");
    expect(deletionMigration).toContain("perform public.survey_relock");
    expect(deletionMigration).toContain("delete from public.application_users");
  });

  it("makes deletion staged, idempotent, retryable, and manifest-checked", () => {
    for (const stage of ["requested", "access_revoked", "storage_cleaned", "database_cleaned", "auth_deleted", "finalized", "failed"]) {
      expect(deletionMigration).toContain(`'${stage}'`);
    }
    expect(deletionMigration).toContain("application_user_deletion_manifest");
    expect(deletionMigration).toContain("Unclassified application-user foreign key");
    expect(deletionMigration).toContain("block_invitation_during_user_deletion");
    expect(deletionMigration).toContain("deletion.stage<>'finalized'");
    expect(source("components/user-management-panel.tsx")).toContain("Retry deletion");
    expect(source("app/admin/users/page.tsx")).toContain('from("administrator_user_deletions")');
    expect(source("app/admin/users/page.tsx")).toContain("target_user_id");
    expect(source("app/api/admin/user-deletions/[jobId]/advance/route.ts")).toContain('stage === "failed" ? status.resumeStage');
  });

  it("keeps the SuperAdmin ID persona assignment-scoped", () => {
    expect(personaMigration).toContain("one_active_operational_role_per_user_idx");
    expect(personaMigration).toContain("persona_id uuid references public.application_user_operational_personas(id) on delete set null");
    expect(personaMigration).toContain("one_active_operational_role_per_wrike_identity_idx");
    expect(personaMigration).toContain("public.can_act_as_assigned_id(target_task_id)");
    expect(personaMigration).toContain("operational_persona_assignee");
    expect(source("app/id-dashboard/page.tsx")).toContain("ownOperationalView");
    expect(source("components/id-dashboard.tsx")).toContain("Administrative ID view");
  });

  it("records both authenticated actor and effective user for mutations", () => {
    expect(principalsMigration).toContain("actor_user_id");
    expect(principalsMigration).toContain("effective_user_id");
    expect(principalsMigration).toContain("record_impersonated_external_mutation");
    const invoiceRoute = source("app/api/surveys/[id]/invoice/route.ts");
    expect(invoiceRoute).toContain("authenticated_actor_id: actor.id");
    expect(invoiceRoute).toContain('target_relation_name: "public.survey_attachments"');
  });
});
