"use client";

export default function ProjectsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="login"><section className="card projects-load-failure" role="alert">
    <p className="eyebrow">PROJECTS ERROR</p>
    <h1>Projects could not be loaded</h1>
    <p>An unexpected error occurred before the Projects report could finish. Retry the request and use the diagnostic code to locate the matching server log.</p>
    <details className="projects-diagnostic-details"><summary>Diagnostic details</summary><dl>
      <div><dt>Route</dt><dd><code>/projects</code></dd></div>
      <div><dt>Diagnostic code</dt><dd><code>{error.digest ?? "not provided"}</code></dd></div>
      {process.env.NODE_ENV !== "production" ? <div><dt>Development message</dt><dd><code>{error.message}</code></dd></div> : null}
    </dl></details>
    <button type="button" onClick={reset}>Try again</button>
  </section></main>;
}
