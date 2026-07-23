import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { APPLICATION_ROLES, assignableRolesFor, hasCapability, landingPageForRole } from "@/lib/auth/roles";
import { navigationForRole } from "@/lib/navigation";
import { protectedApiCapability } from "@/middleware";

const root = process.cwd();
const source = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const migration = source("supabase/migrations/202607230003_role_based_access_control.sql");

describe("four-role capability model", () => {
  it("defines exactly the required roles and centralized capability matrix", () => {
    expect(APPLICATION_ROLES).toEqual(["super_admin", "admin", "id", "sme"]);
    for (const capability of ["manage_users", "manage_settings", "manage_integrations", "manage_data", "view_standard_pages", "view_sme_dashboard", "select_sme_dashboard_user", "edit_own_profile"] as const) {
      expect(hasCapability("super_admin", capability)).toBe(true);
    }
    expect(hasCapability("admin", "manage_users")).toBe(true);
    expect(hasCapability("id", "view_standard_pages")).toBe(true);
    expect(hasCapability("id", "select_sme_dashboard_user")).toBe(true);
    expect(hasCapability("id", "manage_users")).toBe(false);
    expect(hasCapability("sme", "view_sme_dashboard")).toBe(true);
    expect(hasCapability("sme", "view_standard_pages")).toBe(false);
    expect(hasCapability("sme", "select_sme_dashboard_user")).toBe(false);
  });

  it("shows role-appropriate navigation and SME landing behavior", () => {
    const ids = (role: "super_admin" | "admin" | "id" | "sme") => navigationForRole(role).flatMap((entry) => entry.kind === "link" ? [entry.id] : []);
    expect(ids("super_admin")).toContain("data");
    expect(ids("admin")).toContain("users");
    expect(ids("id")).toContain("projects");
    expect(ids("id")).toContain("sme-dashboard");
    expect(ids("id")).not.toContain("users");
    expect(ids("sme")).toEqual(["sme-dashboard", "surveys"]);
    expect(hasCapability("sme", "create_sme_debrief")).toBe(true);
    expect(hasCapability("sme", "create_id_review")).toBe(false);
    expect(hasCapability("id", "create_id_review")).toBe(true);
    expect(hasCapability("id", "create_sme_debrief")).toBe(false);
    expect(hasCapability("admin", "manage_surveys")).toBe(true);
    expect(landingPageForRole("sme")).toBe("/sme-dashboard");
  });

  it("never exposes SuperAdmin as an assignable invitation or role option", () => {
    expect(assignableRolesFor("super_admin")).toEqual(["admin", "id", "sme"]);
    expect(assignableRolesFor("admin")).toEqual(["admin", "id", "sme"]);
    expect(source("lib/users/invitations.ts")).not.toContain('"super_admin"');
    expect(source("components/user-management-panel.tsx")).not.toContain('<option value="super_admin">');
  });
});

describe("database-enforced SuperAdmin and SME isolation", () => {
  it("migrates the fixed email and prevents any other SuperAdmin assignment or removal", () => {
    expect(migration).toContain("lower(auth_user.email)='dweiss@lexipol.com'");
    expect(migration).toContain("then 'super_admin'");
    expect(migration).toContain("target_email is distinct from 'dweiss@lexipol.com'");
    expect(migration).toContain("The required SuperAdmin account cannot be removed");
    expect(migration).toContain("The required SuperAdmin account cannot be demoted");
    expect(migration).toContain("guard_fixed_superadmin_auth_identity");
    expect(migration).toContain("The required SuperAdmin email cannot be transferred");
    expect(migration).toContain("The SuperAdmin role cannot be assigned");
  });

  it("migrates ordinary members conservatively to ID and keeps roles out of Auth metadata", () => {
    expect(migration).toContain("else 'id'");
    expect(migration).toContain("role in ('super_admin','admin','id','sme')");
    expect(migration).not.toContain("raw_app_meta_data");
  });

  it("validates SME mapping and prevents duplicate or cross-organization identities", () => {
    expect(migration).toContain("application_users_org_wrike_sme_idx");
    expect(migration).toContain("The SME identity must belong to the same organization");
    expect(migration).toContain("identity.organization_id=member.organization_id");
    expect(migration).toContain("target_wrike_user_id is not null");
  });

  it("blocks SME direct reporting reads and scopes dashboard rows through the mapped assignee", () => {
    expect(migration).toContain('create policy "sme direct read restriction"');
    expect(migration).toContain("coalesce(public.current_application_role(),'''')<>''sme''");
    expect(migration).toContain("where id=auth.uid() and role in ('super_admin','admin','id')");
    expect(migration).toContain("viewer.role='sme'");
    expect(migration).toContain("target_application_user_id<>viewer.id");
    expect(migration).toContain("selected_sme.wrike_user_id");
    expect(migration).toContain("assignee.user_id=selected_sme.wrike_user_id");
    expect(migration).toContain("task.organization_id=viewer.organization_id");
  });
});

describe("server route authorization", () => {
  it("guards standard pages and mutations with capabilities", () => {
    for (const file of ["app/page.tsx", "app/projects/page.tsx", "app/development/page.tsx", "app/ask/page.tsx"]) {
      expect(source(file), file).toContain('requirePageCapability("view_standard_pages")');
    }
    expect(source("app/admin/users/page.tsx")).toContain('requirePageCapability("manage_users")');
    expect(source("app/api/admin/users/invitations/route.ts")).toContain('requireCapability("manage_users")');
    expect(source("app/api/ask/route.ts")).toContain('requireCapability("view_standard_pages")');
    expect(protectedApiCapability("/api/admin/users")).toBe("manage_users");
    expect(protectedApiCapability("/api/wrike/import-folder-tasks")).toBe("manage_integrations");
    expect(protectedApiCapability("/api/conversations/abc")).toBe("view_standard_pages");
  });

  it("validates selected SME membership in the database instead of trusting the URL", () => {
    const page = source("app/sme-dashboard/page.tsx");
    expect(page).toContain('supabase.rpc("reporting_sme_dashboard_identities")');
    expect(page).toContain("identities.find((identity) => identity.wrike_user_id === requested && identity.selectable)");
    expect(page).toContain('supabase.rpc("reporting_sme_dashboard_rows"');
  });
});
