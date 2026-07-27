export default function SurveysLoading() {
  return <div className="page-loading" role="status" aria-live="polite">
    <span className="loading-pulse" />
    <p>Loading assigned surveys…</p>
  </div>;
}
