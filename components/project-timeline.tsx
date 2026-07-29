import React from "react";
import { buildProjectTimeline, type ProjectTimelineInput } from "@/lib/projects/timeline";

export function ProjectTimeline({ input, headingId, className = "", embedded = false }: {
  input: ProjectTimelineInput;
  headingId: string;
  className?: string;
  embedded?: boolean;
}) {
  const milestones = buildProjectTimeline(input);
  if (!milestones.length) return null;
  const maxLane = Math.max(...milestones.map((milestone) => milestone.lane));
  const sectionClassName = `${embedded ? "project-timeline-embedded" : "card"} project-timeline ${className}`.trim();
  return <section className={sectionClassName} aria-labelledby={headingId}>
    <div className="project-timeline-heading">
      <div><p className="eyebrow">KEY DATES</p>{embedded
        ? <h3 id={headingId}>Project timeline</h3>
        : <h2 id={headingId}>Project timeline</h2>}</div>
      <ul className="project-timeline-legend" aria-label="Milestone types">
        {[
          ["actual", "Project date"],
          ["planned", "Planned"],
          ["completion", "Completion"],
          ["publication", "Publication"],
        ].map(([kind, label]) => <li key={kind} className={`kind-${kind}`}><span aria-hidden="true" />{label}</li>)}
      </ul>
    </div>
    <div className="project-timeline-visual" style={{
      "--timeline-lane-count": maxLane + 1,
    } as React.CSSProperties}>
      <div className="project-timeline-rail" aria-hidden="true" />
      <ol>
        {milestones.map((milestone) => <li
          key={milestone.id}
          className={`project-timeline-event kind-${milestone.kind}`}
          tabIndex={0}
          aria-label={`${milestone.kindLabel}: ${milestone.label}, ${milestone.formattedDate}. Focus this milestone to bring its callout forward.`}
          style={{
            "--milestone-position": `${milestone.position}%`,
            "--milestone-lane": milestone.lane,
          } as React.CSSProperties}
        >
          <span className="project-timeline-marker" aria-hidden="true" />
          <div className="project-timeline-callout" aria-hidden="true">
            <span className="project-timeline-kind">{milestone.kindLabel}</span>
            <strong>{milestone.label}</strong>
            <time dateTime={milestone.date}>{milestone.formattedDate}</time>
          </div>
        </li>)}
      </ol>
    </div>
  </section>;
}
