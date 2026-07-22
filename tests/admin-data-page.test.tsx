import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const panel = fs.readFileSync(path.join(root, "components/admin-panel.tsx"), "utf8");
const page = fs.readFileSync(path.join(root, "app/admin/page.tsx"), "utf8");
const css = fs.readFileSync(path.join(root, "app/globals.css"), "utf8");

describe("Data page organization", () => {
  it("uses collapsible sections throughout the administration workspace", () => {
    expect(panel.match(/<AdminDisclosure /g)?.length).toBeGreaterThanOrEqual(8);
    expect(panel).toContain('<details className="card admin-disclosure"');
    expect(css).toContain(".admin-disclosure[open] > summary::after");
  });

  it("combines import and repair actions in one focused section", () => {
    const workspace = panel.slice(panel.indexOf('title="Import & repair"'), panel.indexOf('title="Custom-field comparison"'));
    expect(workspace).toContain("importFolderTasks");
    expect(workspace).toContain("repairVerticals");
    expect(workspace).toContain('href="#data-history"');
  });

  it("offers a clear combined history view", () => {
    expect(panel).toContain('title="History"');
    expect(panel).toContain('id="data-history"');
    expect(panel).toContain("Combined import history");
    expect(panel).toContain("Vertical repair history");
    expect(panel).toContain("Refresh history");
  });

  it("keeps successful outcomes concise and visible after a reload", () => {
    expect(panel).toContain('sessionStorage.setItem("devtrack-data-message"');
    expect(panel).toContain("Import complete —");
    expect(panel).toContain("Vertical repair complete —");
    expect(panel).not.toContain("Import complete:");
    expect(page).toContain("Wrike connected — ready to import.");
  });
});
