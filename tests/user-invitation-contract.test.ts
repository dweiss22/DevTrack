import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = fs.readFileSync(path.join(root, "supabase/migrations/202607230002_application_user_invitations.sql"), "utf8");
const rbacMigration = fs.readFileSync(path.join(root, "supabase/migrations/202607230003_role_based_access_control.sql"), "utf8");
const callback = fs.readFileSync(path.join(root, "app/auth/callback/route.ts"), "utf8");
const inviteRoute = fs.readFileSync(path.join(root, "app/api/admin/users/invitations/route.ts"), "utf8");
const recoveryRoute = fs.readFileSync(path.join(root, "app/api/auth/recover/route.ts"), "utf8");
const updatePasswordRoute = fs.readFileSync(path.join(root, "app/api/auth/update-password/route.ts"), "utf8");
const recoveryBridge = fs.readFileSync(path.join(root, "components/recovery-session-bridge.tsx"), "utf8");
const roleRoute = fs.readFileSync(path.join(root, "app/api/admin/users/[id]/route.ts"), "utf8");
const profileRoute = fs.readFileSync(path.join(root, "app/api/profile/route.ts"), "utf8");
const setupRoute = fs.readFileSync(path.join(root, "app/api/auth/complete-invitation/route.ts"), "utf8");
const clientSources = [
  "components/user-management-panel.tsx",
  "components/account-setup-form.tsx",
  "components/profile-form.tsx",
  "components/recovery-session-bridge.tsx",
].map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");

describe("app-managed user access security contract", () => {
  it("provisions active membership and uses recovery instead of an invitation token", () => {
    expect(inviteRoute).toContain("normalizeInvitationEmail");
    expect(inviteRoute).toContain("createUser");
    expect(inviteRoute).toContain("email_confirm: true");
    expect(inviteRoute).toContain('.from("application_users")');
    expect(inviteRoute).toContain("profile_completed: true");
    expect(inviteRoute).toContain("resetPasswordForEmail");
    expect(inviteRoute).toContain("passwordRecoveryRedirectUrl()");
    expect(inviteRoute).not.toContain("inviteUserByEmail");
  });

  it("keeps legacy invitation acceptance safe while no longer issuing new invitations", () => {
    expect(migration).toContain("normalized_email = lower(btrim(email))");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("normalized_email=normalized_target_email");
    expect(migration).toContain("(auth_user_id is null or auth_user_id=target_user_id)");
    expect(migration).toContain("'idempotent',true");
    expect(migration).toContain("insert into public.application_users");
    expect(callback).toContain('rpc("accept_application_user_invitation"');
    expect(callback).toContain("target_email: user.email");
    expect(callback).toContain('"/update-password"');
  });

  it("sends recovery only for active members and validates membership again before password update", () => {
    expect(recoveryRoute).toContain("findAuthenticationUserByEmail");
    expect(recoveryRoute).toContain('.eq("account_state", "active")');
    expect(recoveryRoute).toContain("The response remains intentionally generic");
    expect(updatePasswordRoute).toContain('.eq("account_state", "active")');
    expect(updatePasswordRoute).toContain('signOut({ scope: "others" })');
  });

  it("converts the verified recovery fragment into a cookie session and removes tokens from the URL", () => {
    expect(recoveryBridge).toContain("createBrowserClient");
    expect(recoveryBridge).toContain("setSession");
    expect(recoveryBridge).toContain('window.history.replaceState(null, "", "/auth/recovery")');
    expect(recoveryBridge).toContain('window.location.replace("/update-password")');
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
