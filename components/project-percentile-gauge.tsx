import React from "react";
import {
  formatOrdinal,
  projectBenchmarkUnavailableMessage,
  type ProjectLengthBenchmark
} from "@/lib/reporting/project-overview";

const loggedHours = (minutes: number) => (minutes / 60).toLocaleString(undefined, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1
});

export function ProjectPercentileGauge({ benchmark }: { benchmark: ProjectLengthBenchmark | null }) {
  const percentile = benchmark?.percentile ?? null;
  if (!benchmark || percentile == null || benchmark.lengthMinutes == null || !benchmark.courseStyle
    || benchmark.targetMinutes == null || benchmark.cohortAverageMinutes == null
    || benchmark.cohortMedianMinutes == null) {
    const message = projectBenchmarkUnavailableMessage(benchmark?.unavailableReason);
    return <div className="project-percentile project-percentile-empty">
      <div className="percentile-value">Percentile unavailable</div>
      <div className="percentile-meter" role="meter" aria-label={`Logged-time percentile. ${message}`} aria-valuemin={0} aria-valuemax={100}>
        <span className="percentile-meter-fill" style={{ width: "0%" }} />
      </div>
      <p>{message}</p>
    </div>;
  }

  const ordinal = formatOrdinal(percentile);
  const rounded = Math.round(percentile);
  const valueText = `${ordinal} percentile of logged development time among ${benchmark.cohortSize} completed ${benchmark.lengthMinutes}-minute ${benchmark.courseStyle} courses`;
  return <div className="project-percentile">
    <div className="percentile-value">{ordinal} percentile of logged development time</div>
    <div className="percentile-meter" role="meter" aria-label="Logged-time percentile" aria-valuemin={0} aria-valuemax={100} aria-valuenow={rounded} aria-valuetext={valueText}>
      <span className="percentile-meter-fill" style={{ width: `${Math.max(0, Math.min(100, percentile))}%` }} />
    </div>
    <p>Compared with {benchmark.cohortSize.toLocaleString()} completed {benchmark.lengthMinutes}-minute {benchmark.courseStyle} course{benchmark.cohortSize === 1 ? "" : "s"}</p>
    <p>{loggedHours(benchmark.targetMinutes)} h logged <span aria-hidden="true">·</span> {loggedHours(benchmark.cohortAverageMinutes)} h cohort average <span aria-hidden="true">·</span> {loggedHours(benchmark.cohortMedianMinutes)} h cohort median</p>
  </div>;
}
