import React from "react";
import { formatOrdinal, type ProjectLengthBenchmark } from "@/lib/reporting/project-overview";

export function ProjectPercentileRing({ benchmark }: { benchmark: ProjectLengthBenchmark | null }) {
  const percentile = benchmark?.percentile ?? null;
  if (!benchmark || percentile == null) return <div className="project-percentile-ring-cell">
    <div className="project-percentile-ring empty" role="meter" aria-label="Development percentile. Not enough comparable data." aria-valuemin={0} aria-valuemax={100} title="Not enough comparable data">
      <RingSvg value={0} />
      <span>—</span>
    </div>
  </div>;

  const rounded = Math.round(percentile);
  const ordinal = formatOrdinal(percentile);
  const description = `${ordinal} percentile among ${benchmark.cohortSize} visible courses with the same normalized length`;
  return <div className="project-percentile-ring-cell">
    <div className="project-percentile-ring" role="meter" aria-label="Development percentile" aria-valuemin={0} aria-valuemax={100} aria-valuenow={rounded} aria-valuetext={description} title={description}>
      <RingSvg value={percentile} />
      <span>{ordinal}</span>
    </div>
  </div>;
}

function RingSvg({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  return <svg viewBox="0 0 42 42" aria-hidden="true">
    <circle className="project-percentile-ring-track" cx="21" cy="21" r="17" pathLength="100" />
    <circle className="project-percentile-ring-value" cx="21" cy="21" r="17" pathLength="100" strokeDasharray={`${clamped} 100`} />
  </svg>;
}
