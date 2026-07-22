import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { effectiveSortDirection, nextSortDirection, SortableTableHeader } from "@/components/sortable-table-header";
import { parseDevelopmentFilters } from "@/lib/reporting/development";
import { parseProjectReportingFilters } from "@/lib/reporting/filters";
import { projectFilterHref } from "@/lib/reporting/projects";

describe("sortable project table headers", () => {
  it("renders an accessible clickable header with active direction", () => {
    const markup = renderToStaticMarkup(<table><thead><tr><SortableTableHeader label="Project name" href="/projects?sort=title&sortDirection=desc" active direction="asc" /></tr></thead></table>);
    expect(markup).toContain('aria-sort="ascending"');
    expect(markup).toContain("Project name");
    expect(markup).toContain("Activate to reverse sorting");
    expect(markup).toContain('href="/projects?sort=title&amp;sortDirection=desc"');
  });

  it("defaults intuitive directions and toggles an active column", () => {
    expect(effectiveSortDirection("title")).toBe("asc");
    expect(effectiveSortDirection("percentile")).toBe("desc");
    expect(nextSortDirection(false, "desc", "asc")).toBe("asc");
    expect(nextSortDirection(true, "asc")).toBe("desc");
    expect(nextSortDirection(true, "desc")).toBe("asc");
  });

  it("accepts every visible sort key and preserves filters while resetting pagination", () => {
    expect(parseProjectReportingFilters({ sort: "designer", sortDirection: "desc" })).toMatchObject({ sort: "designer", sortDirection: "desc" });
    expect(parseDevelopmentFilters({ sort: "percentile", sortDirection: "asc" }, 2026)).toMatchObject({ sort: "percentile", sortDirection: "asc" });
    const filters = parseProjectReportingFilters({ q: "academy", statuses: "S1", page: "4", sort: "title", sortDirection: "asc" });
    const url = new URL(projectFilterHref(filters, { sort: "folders", sortDirection: "desc" }), "https://devtrack.test");
    expect(url.searchParams.get("q")).toBe("academy");
    expect(url.searchParams.get("statuses")).toBe("S1");
    expect(url.searchParams.get("sort")).toBe("folders");
    expect(url.searchParams.get("sortDirection")).toBe("desc");
    expect(url.searchParams.get("page")).toBe("1");
  });
});
