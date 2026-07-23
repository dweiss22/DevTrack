import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = fs.readFileSync(path.join(root, "supabase/migrations/202607230002_application_user_invitations.sql"), "utf8");
const rbacMigration = fs.readFileSync(path.join(root, "supabase/migrations/202607230003_role_based_access_control.sql"), "utf8");
const callback = fs.readFileSync(path.join(root, "app/auth/callback/route.ts"), "utf8");
const inviteRoute = fs.readFileSync(path.join(root, "app/api/admin/users/invitations/route.ts"), "utf8");
const roleRoute = fs.readFileSync(path.join(root, "app/api/admin/users/[id]/route.ts"), "utf8");
const profileRoute = fs.readFileSync(path.join(root, "app/api/profile/route.ts"), "utf8");
const setupRoute = fs.readFileSync(path.join(root, "app/api/auth/complete-invitation/route.ts"), "utf8");
const clientSources = [
  "components/user-management-panel.tsx",
  "components/account-setup-form.tsx",
  "components/profile-form.tsx",
].map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");

describe("app-managed invitation security contract", () => {
  it("preauthorizes normalized emails and permits only one open invitation", () => {
    expect(migration).toContain("normalized_email = lower(btrim(email))");
    expect(migration).toContain("application_user_invitations_open_email_idx");
    expect(migration).toContain("where status in ('pending','failed')");
    expect(inviteRoute).toContain("normalizeInvitationEmail");
    expect(inviteRoute).toContain("inviteUserByEmail");
    expect(inviteRoute).toContain("accountSetupRedirectUrl()");
  });

  it("accepts an invitation atomically, idempotently, and only for its authenticated email", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("normalized_email=normalized_target_email");
    expect(migration).toContain("(auth_user_id is null or auth_user_id=target_user_id)");
    expect(migration).toContain("'idempotent',true");
    expect(migration).toContain("insert into public.application_users");
    expect(callback).toContain('rpc("accept_application_user_invitation"');
    expect(callback).toContain("target_email: user.email");
    expect(callback).toContain('"/account-setup"');
  });

  it("keeps organization membership authoritative and protects the last administrator", () => {
    expect(roleRoute).toContain('requireCapability("manage_users")');
    expect(roleRoute).toContain("target_organization_id: profile.organization_id");
    expect(rbacMigration).toContain("change_application_user_role");
    expect(rbacMigration).toContain("The required SuperAdmin account cannot be modified");
    expect(rbacMigration).not.toContain("raw_app_meta_data");
  });

  it("scopes profile updates to the signed-in identity and keeps authorization fields read-only", () => {
    expect(profileRoute).toContain("const { supabase } = await requireContext()");
    expect(profileRoute).toContain('rpc("update_current_profile"');
    expect(profileRoute).not.toContain(".from(");
    expect(profileRoute).not.toContain("role:");
    expect(setupRoute).toContain('.eq("id", user.id)');
    expect(setupRoute).toContain("profile_completed: true");
  });

  it("never exposes service-role credentials to client components", () => {
    expect(clientSources).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(clientSources).not.toContain("createAdminClient");
    expect(clientSources).not.toContain("@/lib/supabase/admin");
  });
});
