import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { accessProfileForLegacyRole, hasCapability, normalizeAccessProfile } from "@/lib/auth/roles";
import { navigationForRole } from "@/lib/navigation";

const source = (path: string) => readFileSync(path, "utf8");

describe("additive SME access", () => {
  it("composes operational and management roles", () => {
    const access = normalizeAccessProfile({
      operationalRoles: ["id", "sme"], managementRoles: ["sme_coordinator"],
    }, "sme");
    expect(hasCapability(access, "create_sme_debrief")).toBe(true);
    expect(hasCapability(access, "create_id_review")).toBe(true);
    expect(hasCapability(access, "manage_smes")).toBe(true);
    expect(hasCapability(access, "manage_users")).toBe(false);
    expect(navigationForRole(access).some((entry) => entry.kind === "link" && entry.id === "sme-management")).toBe(true);
  });

  it("removes the SME survey index while preserving assignment survey access", () => {
    const sme = accessProfileForLegacyRole("sme");
    expect(hasCapability(sme, "view_personal_surveys")).toBe(true);
    expect(hasCapability(sme, "view_personal_survey_index")).toBe(false);
  });

  it("ships audited grants and an anonymized, recent-aware project experience", () => {
    const roles = source("supabase/migrations/202607280001_additive_management_roles.sql");
    const experience = source("supabase/migrations/202607280002_sme_management_experience.sql");
    expect(roles).toContain("application_user_management_role_audit");
    expect(roles).toContain("execute function public.guard_append_only_security_audit()");
    expect(roles).not.toContain("prevent_audit_mutation");
    expect(roles).toContain("current_access_operational_roles");
    expect(roles).toContain("current_access_management_roles");
    expect(experience).toContain("current_date-interval '12 months'");
    expect(experience).toContain("'categoryTime'");
    expect(experience).not.toContain("'userName'");
    expect(source("components/sme-project-detail.tsx")).toContain("minor-change review period has passed");
    expect(source("app/@modal/(.)sme-dashboard/projects/[projectId]/page.tsx")).toContain("SmeProjectModal");
  });

  it("assigns Admin as an additive app-management role instead of an invitation role", () => {
    const accessPanel = source("components/additive-access-panel.tsx");
    const userPanel = source("components/user-management-panel.tsx");
    const invitations = source("lib/users/invitations.ts");
    const compatibility = source("supabase/migrations/202607280003_additive_admin_compatibility.sql");
    expect(accessPanel).toContain('{ role: "admin", enabled: event.target.checked }');
    expect(accessPanel).toContain("canGrantAdmin");
    expect(userPanel).not.toContain('<option value="admin">Admin</option>');
    expect(invitations).toContain('operationalInvitationRoleSchema = z.enum(["id", "sme", "project_reviewer", "videographer"])');
    expect(compatibility).toContain("sync_additive_admin_legacy_role");
    expect(compatibility).toContain("insert into public.application_user_operational_personas");
    expect(compatibility).toContain("set role='admin'");
    expect(compatibility).toContain("set role=fallback_role");
  });
});
