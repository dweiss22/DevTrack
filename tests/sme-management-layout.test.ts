import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("SME Management desktop layout", () => {
  it("contains wide content inside the available app-shell column", () => {
    const page = source("app/sme-management/page.tsx");
    const styles = source("app/globals.css");
    expect(page).toContain('className="sme-management-page"');
    expect(styles).toContain(".sme-management-page { min-width: 0; width: 100%; max-width: 1240px;");
    expect(styles).toContain(".admin-stack > *, .admin-table-wrap { min-width: 0; max-width: 100%; }");
    expect(styles).toContain(".sme-management-page .admin-table-wrap { width: 100%; }");
    expect(styles).toContain(".sme-management-page table select { max-width: 240px; }");
  });

  it("reduces metric columns before the sidebar collapses", () => {
    const styles = source("app/globals.css");
    expect(styles).toContain("@media (max-width: 1200px)");
    expect(styles).toContain(".sme-management-metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); }");
  });
});
