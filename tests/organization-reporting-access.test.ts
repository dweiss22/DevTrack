import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (...segments: string[]) => readFileSync(join(process.cwd(), ...segments), "utf8");

describe("organization-wide reporting access presentation", () => {
  it("does not present the deprecated strict-access setting as active configuration", () => {
    const settings = source("app", "api", "admin", "reporting-settings", "route.ts");
    expect(settings).toContain("requireAdmin()");
    expect(settings).toContain('reportingAccess: "organization-wide"');
    expect(settings).not.toContain("reporting_access_enforced");
    expect(settings).not.toContain("reportingAccessEnforced");
  });

  it("describes Ask data as organization-scoped instead of reporting-group-scoped", () => {
    const page = source("app", "ask", "page.tsx");
    const panel = source("components", "ask-panel.tsx");
    expect(page).toContain("synchronized reporting records from your DevTrack organization");
    expect(page).not.toContain("reporting groups permit");
    expect(panel).not.toContain("reporting groups have been tested");
  });

  it("keeps representative imports, repairs, mappings, and user management behind administrator checks", () => {
    for (const route of [
      ["app", "api", "wrike", "import-folder-tasks", "route.ts"],
      ["app", "api", "admin", "wrike", "repair-verticals", "route.ts"],
      ["app", "api", "admin", "wrike", "custom-field-mappings", "route.ts"]
    ]) expect(source(...route)).toContain("requireAdmin()");
    expect(source("app", "admin", "users", "page.tsx")).toContain('requirePageCapability("manage_users")');
  });
});
