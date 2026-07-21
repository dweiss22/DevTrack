import React from "react";
import { formatOrdinal, type ProjectLengthBenchmark } from "@/lib/reporting/project-overview";

const loggedHours = (minutes: number) => (minutes / 60).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function ProjectPercentileGauge({ benchmark }: { benchmark: ProjectLengthBenchmark | null }) {
  const percentile = benchmark?.percentile ?? null;
  if (!benchmark || percentile == null) return <div className="project-percentile project-percentile-empty">
    <div className="percentile-value">Not enough comparable data</div>
    <div className="percentile-meter" role="meter" aria-label="Logged-time percentile. Not enough comparable data." aria-valuemin={0} aria-valuemax={100}>
      <span className="percentile-meter-fill" style={{ width: "0%" }} />
    </div>
    <p>Not enough comparable data.</p>
  </div>;

  const ordinal = formatOrdinal(percentile);
  const rounded = Math.round(percentile);
  const valueText = `${ordinal} percentile among ${benchmark.cohortSize} visible courses with the same normalized length`;
  return <div className="project-percentile">
    <div className="percentile-value">{ordinal} percentile</div>
    <div className="percentile-meter" role="meter" aria-label="Logged-time percentile" aria-valuemin={0} aria-valuemax={100} aria-valuenow={rounded} aria-valuetext={valueText}>
      <span className="percentile-meter-fill" style={{ width: `${Math.max(0, Math.min(100, percentile))}%` }} />
    </div>
    <p>{loggedHours(benchmark.targetMinutes)} h logged <span aria-hidden="true">·</span> {loggedHours(benchmark.cohortAverageMinutes)} h cohort average</p>
  </div>;
}
