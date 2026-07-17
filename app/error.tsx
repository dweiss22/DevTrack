"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="login"><section className="card" role="alert"><p className="eyebrow">DASHBOARD ERROR</p><h1>Dashboard data could not be loaded</h1><p>The synchronized reporting query failed. No zero values have been substituted.</p><button type="button" onClick={reset}>Try again</button></section></main>;
}
