"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { surveyTitle, type SurveyType } from "@/lib/surveys/domain";
import type { SurveyDefinition } from "@/lib/surveys/definition";

export type AdminSurveyTemplateRow = {
  id: string;
  survey_type: SurveyType;
  template_key: string;
  archived_at: string | null;
  definition: SurveyDefinition;
  lock_version: number;
  updated_at: string;
  latest_version: number | null;
  latest_published_at: string | null;
  is_active: boolean;
};

export function AdminSurveyTemplates({ templates }: { templates: AdminSurveyTemplateRow[] }) {
  const router = useRouter();
  const [working, setWorking] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);

  async function act(template: AdminSurveyTemplateRow, action: "duplicate" | "archive" | "restore") {
    if (action === "archive" && !confirm(`Archive “${template.definition.title}”? Existing drafts and submissions will remain pinned.`)) return;
    setWorking(`${template.id}:${action}`); setMessage(""); setError(false);
    try {
      const response = await fetch(`/api/admin/surveys/templates/${template.id}/actions`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The template action failed.");
      if (action === "duplicate") router.push(`/admin/surveys/templates/${payload.id}`);
      else {
        setMessage(action === "archive" ? "Survey template archived." : "Survey template restored.");
        router.refresh();
      }
    } catch (reason) {
      setError(true); setMessage(reason instanceof Error ? reason.message : "The template action failed.");
    } finally { setWorking(""); }
  }

  return <div className="admin-stack">
    {message && <p className={error ? "notice error" : "notice"} role={error ? "alert" : "status"}>{message}</p>}
    <div className="survey-template-grid">{templates.map((template) => <article className="card survey-template-card" key={template.id}>
      <div className="section-heading"><div><p className="eyebrow">{surveyTitle(template.survey_type)}</p>
        <h2>{template.definition.title}</h2></div>
        <span className={`survey-status ${template.archived_at ? "draft" : template.is_active ? "submitted" : "unlocked"}`}>
          {template.archived_at ? "Archived" : template.is_active ? "Active" : "Available"}
        </span>
      </div>
      <dl className="template-metadata">
        <div><dt>Published version</dt><dd>{template.latest_version ?? "Not published"}</dd></div>
        <div><dt>Draft revision</dt><dd>{template.lock_version}</dd></div>
        <div><dt>Draft updated</dt><dd>{new Date(template.updated_at).toLocaleString()}</dd></div>
        <div><dt>Published</dt><dd>{template.latest_published_at ? new Date(template.latest_published_at).toLocaleString() : "Not yet"}</dd></div>
      </dl>
      <div className="table-actions">
        {!template.archived_at && <Link className="button secondary" href={`/admin/surveys/templates/${template.id}`}>Edit designer</Link>}
        <button type="button" className="secondary" disabled={Boolean(working)} onClick={() => act(template, "duplicate")}>
          {working === `${template.id}:duplicate` ? "Duplicating…" : "Duplicate"}
        </button>
        <button type="button" className={`secondary ${template.archived_at ? "" : "danger"}`} disabled={Boolean(working)}
          onClick={() => act(template, template.archived_at ? "restore" : "archive")}>
          {template.archived_at ? "Restore" : "Archive"}
        </button>
      </div>
    </article>)}</div>
    {!templates.length && <p className="card empty">No survey templates are available. Apply the latest survey migration.</p>}
  </div>;
}
