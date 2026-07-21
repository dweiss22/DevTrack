import React from "react";
import type { ReportingFailure } from "@/lib/reporting/failure";

export function ProjectsLoadFailure({ failure, isAdmin, nonfatal = false, nonfatalImpact }: { failure: ReportingFailure; isAdmin: boolean; nonfatal?: boolean; nonfatalImpact?: string }) {
  if (nonfatal) return <section className="notice warning projects-diagnostic" role="status">
    <strong>{failure.title}</strong>
    <span>{failure.message} {nonfatalImpact ?? "Project rows remain available; only development percentiles are temporarily unavailable."}</span>
    <DiagnosticDetails failure={failure} isAdmin={isAdmin} />
  </section>;
  return <section className="card projects-load-failure" role="alert">
    <p className="eyebrow">PROJECTS ERROR</p>
    <h1>Projects could not be loaded</h1>
    <h2>{failure.title}</h2>
    <p>{failure.message}</p>
    <DiagnosticDetails failure={failure} isAdmin={isAdmin} />
    <a className="button" href="/projects">Try Projects again</a>
  </section>;
}

function DiagnosticDetails({ failure, isAdmin }: { failure: ReportingFailure; isAdmin: boolean }) {
  return <details className="projects-diagnostic-details">
    <summary>Diagnostic details</summary>
    <dl>
      <div><dt>Operation</dt><dd>{failure.operation}</dd></div>
      <div><dt>Classification</dt><dd>{failure.kind.replaceAll("_", " ")}</dd></div>
      <div><dt>Database code</dt><dd><code>{failure.diagnosticCode ?? "not provided"}</code></dd></div>
      {isAdmin && failure.technicalMessage ? <div><dt>Database response</dt><dd><code>{failure.technicalMessage}</code></dd></div> : null}
    </dl>
  </details>;
}
