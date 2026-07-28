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
    expect(navigationForRole(sme).some((entry) => entry.kind === "link" && entry.id === "surveys")).toBe(false);
  });

  it("ships audited grants and an anonymized, recent-aware project experience", () => {
    const roles = source("supabase/migrations/202607280001_additive_management_roles.sql");
    const experience = source("supabase/migrations/202607280002_sme_management_experience.sql");
    expect(roles).toContain("application_user_management_role_audit");
    expect(roles).toContain("current_access_operational_roles");
    expect(roles).toContain("current_access_management_roles");
    expect(experience).toContain("current_date-interval '12 months'");
    expect(experience).toContain("'categoryTime'");
    expect(experience).not.toContain("'userName'");
    expect(source("components/sme-project-detail.tsx")).toContain("minor-change review period has passed");
    expect(source("app/@modal/(.)sme-dashboard/projects/[projectId]/page.tsx")).toContain("SmeProjectModal");
  });
});
