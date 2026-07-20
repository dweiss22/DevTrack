import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("administrator user presentation", () => {
  it("preserves the authenticated role while rendering the route loading shell", () => {
    const source = readFileSync(join(root, "app", "loading.tsx"), "utf8");
    expect(source).toContain("await requireContext()");
    expect(source).toContain('isAdmin={profile.role === "admin"}');
  });

  it("resolves User Management names from authentication instead of rendering ids", () => {
    const source = readFileSync(join(root, "app", "admin", "users", "page.tsx"), "utf8");
    expect(source).toContain("applicationUserDisplayName(user.display_name, authenticationUser)");
    expect(source).not.toContain("user.display_name ?? user.id");
  });

  it("keeps task source identifiers inside collapsed diagnostics", () => {
    const source = readFileSync(join(root, "app", "projects", "[id]", "page.tsx"), "utf8");
    const disclosure = source.indexOf("<details>");
    const responsibleIds = source.indexOf("Responsible IDs:");
    expect(source).toContain("Responsible users:");
    expect(disclosure).toBeGreaterThan(-1);
    expect(responsibleIds).toBeGreaterThan(disclosure);
  });
});
