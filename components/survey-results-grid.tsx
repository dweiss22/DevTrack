import React from "react";

export type PerformanceRatingRow = {
  subject_id: string; subject_name: string; submission_count: number;
  average_rating: number | null; statement_averages: (number | null)[] | null;
};

export function PerformanceRatingsGrid({ rows, statements, emptyMessage }: {
  rows: PerformanceRatingRow[]; statements: readonly string[]; emptyMessage: string;
}) {
  if (!rows.length) return <p className="card empty">{emptyMessage}</p>;
  return <div className="survey-results-grid">
    {rows.map((row) => <article className="card survey-results-card" key={row.subject_id}>
      <header>
        <h2>{row.subject_name}</h2>
        <p className="muted">{row.submission_count} submitted survey{row.submission_count === 1 ? "" : "s"}</p>
      </header>
      <p className="survey-results-overall"><strong>{row.average_rating ?? "—"}</strong><span>Overall average</span></p>
      <dl className="survey-results-statements">
        {statements.map((statement, index) => <div key={statement}>
          <dt>{statement}</dt>
          <dd>{row.statement_averages?.[index] ?? "—"}</dd>
        </div>)}
      </dl>
    </article>)}
  </div>;
}
