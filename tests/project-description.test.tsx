import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProjectDescription, sanitizeWrikeDescription } from "@/components/project-description";

describe("Wrike project descriptions", () => {
  it("renders Wrike links and line breaks as readable, safe content", () => {
    const description = '<a href="https://www.usfa.fema.gov/downloads/pdf/code_of_ethics.pdf">Firefighter Code of Ethics</a><br /><a href="https://example.com/ethics">Trevino&#39;s Situational Factors</a><br />';
    const markup = renderToStaticMarkup(<ProjectDescription description={description} />);
    expect(markup).toContain("Firefighter Code of Ethics");
    expect(markup).toContain("Trevino");
    expect(markup).toContain('href="https://www.usfa.fema.gov/downloads/pdf/code_of_ethics.pdf"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).toContain("<br />");
    expect(markup).not.toContain("&lt;a");
  });

  it("removes executable or embedded markup while retaining ordinary formatting", () => {
    const sanitized = sanitizeWrikeDescription('<p onclick="alert(1)"><strong>Research</strong></p><script>alert(2)</script><iframe src="https://evil.test"></iframe><a href="javascript:alert(3)">Unsafe</a><a href="mailto:owner@example.com">Email</a>');
    expect(sanitized).toContain("<p><strong>Research</strong></p>");
    expect(sanitized).toContain("Unsafe</a>");
    expect(sanitized).toContain('href="mailto:owner@example.com"');
    expect(sanitized).not.toMatch(/onclick|javascript:|script|iframe|alert\(/i);
  });
});
