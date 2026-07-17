import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireContext } from "@/lib/auth";
import { parseAsk, type AskReferences } from "@/lib/reporting/ask";
import { reportingFiltersSchema } from "@/lib/reporting/filters";
import { loadTaskRows, loadTimeRows, loadTimeSummary } from "@/lib/reporting/data";
import { hours } from "@/lib/metrics";
import { loadCustomFieldOptions } from "@/lib/reporting/options";

const requestSchema = z.object({ conversationId: z.string().uuid().optional(), message: z.string().trim().min(1).max(2000), filters: reportingFiltersSchema.partial().optional() });

export async function POST(request: NextRequest) {
  const { user, profile, supabase } = await requireContext();
  const parsedBody = requestSchema.safeParse(await request.json());
  if (!parsedBody.success) return NextResponse.json({ error: "Enter a question no longer than 2,000 characters." }, { status: 400 });
  const { data: organization } = await supabase.from("organizations").select("timezone,ask_enabled").eq("id", profile.organization_id).single();
  if (!organization?.ask_enabled) return NextResponse.json({ error: "Ask DevTrack has not been enabled by an administrator." }, { status: 403 });
  let conversationId = parsedBody.data.conversationId;
  let previousFilters = parsedBody.data.filters ?? {};
  if (conversationId) {
    const { data: conversation } = await supabase.from("reporting_conversations").select("id,last_filters").eq("id", conversationId).eq("user_id", user.id).maybeSingle();
    if (!conversation) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    previousFilters = { ...(conversation.last_filters as object), ...previousFilters };
  }
  const [{ data: users }, { data: scopes }, { data: projects }, { data: statusRows }, customFields] = await Promise.all([
    supabase.from("wrike_users").select("id,display_name").eq("organization_id", profile.organization_id).eq("is_active", true).order("display_name"),
    supabase.from("wrike_sync_scopes").select("id,label").eq("organization_id", profile.organization_id).eq("is_active", true),
    supabase.from("wrike_projects").select("id,title").eq("organization_id", profile.organization_id).is("deleted_at", null).order("title"),
    supabase.from("wrike_workflow_statuses").select("title").eq("organization_id", profile.organization_id),
    loadCustomFieldOptions(supabase)
  ]);
  const references: AskReferences = {
    users: (users ?? []).map((row) => ({ id: row.id, name: row.display_name })),
    scopes: (scopes ?? []).map((row) => ({ id: row.id, name: row.label })),
    projects: (projects ?? []).map((row) => ({ id: row.id, name: row.title })),
    statuses: [...new Set((statusRows ?? []).map((row) => row.title))],
    customFields: customFields.map((field) => ({ id: field.id, name: field.name })),
    customOptions: customFields.flatMap((field) => field.values.map((name) => ({ fieldId: field.id, fieldName: field.name, name })))
  };
  const parsed = parseAsk(parsedBody.data.message, references, organization.timezone, previousFilters);
  if (!conversationId) {
    const { data: created, error } = await supabase.from("reporting_conversations").insert({ organization_id: profile.organization_id, user_id: user.id, title: parsedBody.data.message.slice(0, 80), last_filters: parsed.filters }).select("id").single();
    if (error || !created) return NextResponse.json({ error: "Unable to save the conversation." }, { status: 500 });
    conversationId = created.id;
  }
  await supabase.from("reporting_messages").insert({ conversation_id: conversationId, organization_id: profile.organization_id, user_id: user.id, role: "user", content: parsedBody.data.message, parsed_query: parsed });
  let answer: string; let referencesOut: { id: string; title: string; href: string }[] = [];
  if (parsed.clarification?.length) {
    answer = `I found more than one match: ${parsed.clarification.join(", ")}. Use the exact name or the report filters to narrow the question.`;
  } else if (parsed.intent === "unsupported") {
    answer = "I can answer deterministic reporting questions such as “Count overdue tasks,” “How much time last month by person?”, or “Compare planned and actual time this quarter.” Use the structured reports for forecasting or other analysis.";
    referencesOut = [{ id: "tasks-report", title: "Open task filters", href: "/tasks" }, { id: "time-report", title: "Open time filters", href: "/time-entries" }];
  } else if (parsed.intent === "time-total" || parsed.intent === "time-average" || parsed.intent === "time-breakdown") {
    const summary = await loadTimeSummary(supabase, parsed.filters, parsed.intent === "time-breakdown" ? parsed.groupBy : "total");
    if (!summary.length) answer = "No visible time entries matched that question.";
    else if (parsed.intent === "time-average") answer = `Average recorded time is ${hours(summary[0].minutes / Math.max(1, summary[0].entry_count))} hours across ${summary[0].entry_count} entries.`;
    else if (parsed.intent === "time-total") answer = `Recorded time totals ${hours(summary[0].minutes)} hours across ${summary[0].entry_count} entries.`;
    else answer = summary.slice(0, 20).map((row) => `${row.label}: ${hours(row.minutes)} hours`).join("\n");
  } else {
    const taskFilters = { ...parsed.filters, page: 1, pageSize: parsed.intent === "count" ? 10 : 50 };
    const tasks = await loadTaskRows(supabase, taskFilters);
    const total = tasks[0]?.total_count ?? 0;
    if (parsed.intent === "count") answer = `${total} visible task${total === 1 ? "" : "s"} matched.`;
    else if (!tasks.length) answer = "No visible tasks matched that question.";
    else if (parsed.intent === "compare") answer = tasks.slice(0, 20).map((task) => `${task.title}: ${task.planned_minutes == null ? "no plan" : `${hours(task.planned_minutes)} planned`} / ${hours(task.actual_minutes)} actual hours`).join("\n");
    else if (tasks.length === 1 && parsed.filters.q) {
      const entries = await loadTimeRows(supabase, { ...parsed.filters, q: undefined, taskIds: [tasks[0].task_id], page: 1, pageSize: 20 });
      const recent = entries.length ? ` Recent time: ${entries.slice(0, 10).map((entry) => `${entry.entry_date} ${hours(entry.minutes)}h by ${entry.user_name ?? "Unknown"}`).join("; ")}.` : " No visible time entries were found.";
      answer = `${tasks[0].title} is ${tasks[0].status_name}. It has ${tasks[0].planned_minutes == null ? "no planned effort" : `${hours(tasks[0].planned_minutes)} planned hours`} and ${hours(tasks[0].actual_minutes)} visible recorded hours. Due: ${tasks[0].due_date ?? "not set"}. Assignees: ${tasks[0].responsible_users.map((item) => item.fullName).join(", ") || "unassigned"}.${recent}`;
    }
    else answer = tasks.slice(0, 20).map((task) => `${task.title} — ${task.status_name}, ${hours(task.actual_minutes)} recorded hours`).join("\n");
    referencesOut = tasks.slice(0, 20).map((task) => ({ id: task.task_id, title: task.title, href: `/tasks/${task.task_id}` }));
  }
  await Promise.all([
    supabase.from("reporting_messages").insert({ conversation_id: conversationId, organization_id: profile.organization_id, user_id: user.id, role: "assistant", content: answer, parsed_query: parsed, result_references: referencesOut }),
    supabase.from("reporting_conversations").update({ last_filters: parsed.filters, updated_at: new Date().toISOString() }).eq("id", conversationId).eq("user_id", user.id)
  ]);
  return NextResponse.json({ conversationId, answer, references: referencesOut, parsed: { intent: parsed.intent, filters: parsed.filters, explanation: parsed.explanation } });
}
