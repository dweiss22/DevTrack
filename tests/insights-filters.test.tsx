import { describe, expect, it } from "vitest";
import {
  extractPrefixedValues,
  foreignFilterParams,
  insightsFilterHref,
  parsePrefixedReportingFilters,
  swapPrefixedFiltersHref
} from "@/lib/reporting/insights";

describe("insights prefixed filter round-trip", () => {
  it("parses only the query params under a given prefix", () => {
    const query = { reportingYears: ["2026"], a_reportingYears: ["2025"], b_reportingYears: ["2024"], "a_cf_field-1": "Designer A" };
    expect(extractPrefixedValues(query, "a_")).toEqual({ reportingYears: ["2025"], "cf_field-1": "Designer A" });
    const filtersA = parsePrefixedReportingFilters(query, "a_");
    expect(filtersA.reportingYears).toEqual([2025]);
    const filtersB = parsePrefixedReportingFilters(query, "b_");
    expect(filtersB.reportingYears).toEqual([2024]);
    const primary = parsePrefixedReportingFilters(query, "");
    expect(primary.reportingYears).toEqual([2026]);
  });

  it("keeps other panels' params untouched when computing foreign params", () => {
    const query = { statuses: ["s1"], a_statuses: ["s2"], b_statuses: ["s3"] };
    const foreign = foreignFilterParams(query, "a_");
    expect(foreign.getAll("statuses")).toEqual(["s1"]);
    expect(foreign.getAll("b_statuses")).toEqual(["s3"]);
    expect(foreign.has("a_statuses")).toBe(false);
  });

  it("treats the primary panel's empty prefix as 'not a_ or b_', not as a prefix of every key", () => {
    // Regression: an empty-string prefix is technically a prefix of every key, so a naive
    // `key.startsWith(prefix)` check would wrongly classify every other panel's params as "own"
    // and silently drop Metric A / Metric B's filters whenever the primary form is submitted.
    const query = { statuses: ["s1"], a_statuses: ["s2"], b_statuses: ["s3"] };
    const foreign = foreignFilterParams(query, "");
    expect(foreign.getAll("a_statuses")).toEqual(["s2"]);
    expect(foreign.getAll("b_statuses")).toEqual(["s3"]);
    expect(foreign.has("statuses")).toBe(false);
  });

  it("builds an href that changes only the target panel's filters", () => {
    const foreign = new URLSearchParams({ b_statuses: "s3" });
    const href = insightsFilterHref("/insights", foreign, "a_", { statuses: ["s1", "s2"] } as never, { statuses: ["s1"] });
    const url = new URL(href, "https://devtrack.test");
    expect(url.searchParams.getAll("a_statuses")).toEqual(["s1"]);
    expect(url.searchParams.get("b_statuses")).toBe("s3");
  });

  it("swaps every param under one prefix with another, leaving unrelated params alone", () => {
    const query = { reportingYears: ["2026"], a_statuses: ["s1"], b_statuses: ["s2"], a_reportingYears: ["2025"] };
    const href = swapPrefixedFiltersHref("/insights", query, "a_", "b_");
    const url = new URL(href, "https://devtrack.test");
    expect(url.searchParams.getAll("reportingYears")).toEqual(["2026"]);
    expect(url.searchParams.getAll("a_statuses")).toEqual(["s2"]);
    expect(url.searchParams.getAll("b_statuses")).toEqual(["s1"]);
    expect(url.searchParams.getAll("b_reportingYears")).toEqual(["2025"]);
  });
});
