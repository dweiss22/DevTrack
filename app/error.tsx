"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="login"><section className="card" role="alert"><p className="eyebrow">APPLICATION ERROR</p><h1>This page could not be loaded</h1><p>An unexpected request failed. Retry the page and use diagnostic code <code>{error.digest ?? "not provided"}</code> to locate the corresponding server log.</p><button type="button" onClick={reset}>Try again</button></section></main>;
}
