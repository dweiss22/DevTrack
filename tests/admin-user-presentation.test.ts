import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("administrator user presentation", () => {
  it("keeps admin authorization on the admin page and out of the shared loading shell", () => {
    const loadingSource = readFileSync(join(root, "app", "loading.tsx"), "utf8");
    const adminSource = readFileSync(join(root, "app", "admin", "page.tsx"), "utf8");
    expect(loadingSource).not.toContain("requireContext");
    expect(loadingSource).not.toContain("requireAdmin");
    expect(adminSource).toContain('await requirePageCapability("manage_data")');
    expect(adminSource).toContain("<AppShell isAdmin>");
  });

  it("resolves User Management names from authentication instead of rendering ids", () => {
    const source = readFileSync(join(root, "app", "admin", "users", "page.tsx"), "utf8");
    expect(source).toContain("applicationUserDisplayName(user.display_name, authenticationUser)");
    expect(source).not.toContain("user.display_name ?? user.id");
  });

  it("shows unassigned authentication accounts in an administrator approval queue", () => {
    const page = readFileSync(join(root, "app", "admin", "users", "page.tsx"), "utf8");
    const queue = readFileSync(join(root, "components", "user-approval-queue.tsx"), "utf8");
    const route = readFileSync(join(root, "app", "api", "admin", "users", "approve", "route.ts"), "utf8");
    expect(page).toContain("<UserApprovalQueue users={pendingUsers} />");
    expect(queue).toContain("Approve access");
    expect(route).toContain('await requireCapability("manage_users")');
    expect(route).toContain('role: "id"');
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
