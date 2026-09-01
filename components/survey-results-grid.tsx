import React from "react";
import { SME_DEBRIEF_STATEMENTS } from "@/lib/surveys/domain";

export type SurveyResultRow = {
  sme_identity_id: string; sme_name: string; submission_count: number;
  average_rating: number | null; statement_averages: (number | null)[] | null;
};

export function SurveyResultsGrid({ rows }: { rows: SurveyResultRow[] }) {
  if (!rows.length) return <p className="card empty">No submitted Course Development Debrief surveys yet.</p>;
  return <div className="survey-results-grid">
    {rows.map((row) => <article className="card survey-results-card" key={row.sme_identity_id}>
      <header>
        <h2>{row.sme_name}</h2>
        <p className="muted">{row.submission_count} submitted survey{row.submission_count === 1 ? "" : "s"}</p>
      </header>
      <p className="survey-results-overall"><strong>{row.average_rating ?? "—"}</strong><span>Overall average</span></p>
      <dl className="survey-results-statements">
        {SME_DEBRIEF_STATEMENTS.map((statement, index) => <div key={statement}>
          <dt>{statement}</dt>
          <dd>{row.statement_averages?.[index] ?? "—"}</dd>
        </div>)}
      </dl>
    </article>)}
  </div>;
}
