"use client";

import { useState } from "react";

export function HistoricalSurveyProjectMatch({ responseId, currentTaskId, projects }: {
  responseId: string;
  currentTaskId: string | null;
  projects: Array<{ id: string; title: string; wrikeId: string }>;
}) {
  const [taskId, setTaskId] = useState(currentTaskId ?? "");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");

  async function save() {
    setWorking(true); setMessage("");
    const response = await fetch(`/api/admin/historical-surveys/${responseId}/project`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ matchedTaskId: taskId || null }),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) {
      setMessage(payload.error ?? "The project match could not be updated.");
      setWorking(false);
      return;
    }
    location.reload();
  }

  return <div>
    <label>Matched DevTrack project<select value={taskId} onChange={(event) => setTaskId(event.target.value)}>
      <option value="">Keep unmatched</option>
      {projects.map((project) => <option key={project.id} value={project.id}>{project.title} · {project.wrikeId}</option>)}
    </select></label>
    <div className="filter-bar"><button onClick={save} disabled={working}>{working ? "Saving…" : "Save project association"}</button></div>
    {message && <p className="notice error" role="alert">{message}</p>}
  </div>;
}
