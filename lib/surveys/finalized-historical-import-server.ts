import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  historicalDuplicateKey,
  inspectFinalizedHistoricalCsv,
  type HistoricalImportIssue,
  type HistoricalImportStatus,
  type HistoricalPreviewRow,
  type HistoricalSurveyImportRow,
} from "@/lib/surveys/finalized-historical-import";

type StageInput = {
  organizationId: string;
  actorId: string;
  filename: string;
  bytes: Uint8Array;
  timezone: string;
};

export type HistoricalProjectCandidate = {
  id: string;
  wrike_id: string;
  title: string;
  publication_year: number | null;
};
type TaskCandidate = HistoricalProjectCandidate;

type PrincipalCandidate = {
  id: string;
  display_name: string | null;
  normalized_email_hash: string | null;
  state: string;
  historical_wrike_user_id: string | null;
};

type WrikeUserCandidate = {
  id: string;
  display_name: string;
  email: string | null;
  identity_verified: boolean;
  is_unresolved: boolean;
};

export type FinalizedHistoricalBatchSummary = {
  batchId: string;
  duplicateUpload: boolean;
  totalRows: number;
  validRows: number;
  warningCount: number;
  errorCount: number;
  surveyType: string | null;
  surveyVersions: string[];
};

const normalizedName = (value: string) =>
  value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
const emailHash = (value: string) =>
  createHash("sha256").update(value.trim().toLocaleLowerCase("en-US")).digest("hex");
const checksum = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");

function punctuationNormalizedCourse(value: string, lowerCase = false) {
  const normalized = value.normalize("NFKC")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, "\"")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s*([:/,&()])\s*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return lowerCase ? normalized.toLocaleLowerCase("en-US") : normalized;
}

export function resolveHistoricalProjectMatch(
  source: Pick<HistoricalSurveyImportRow, "surveyType" | "wrikeTaskId" | "courseName">
    & { publicationYear?: number | null },
  tasks: HistoricalProjectCandidate[],
) {
  const exactWrike = source.wrikeTaskId
    ? tasks.filter((task) => task.wrike_id === source.wrikeTaskId)
    : [];
  let candidates = exactWrike;
  let method: HistoricalPreviewRow["match"]["method"] = exactWrike.length ? "wrike_task_id" : null;
  if (!candidates.length) {
    candidates = tasks.filter((task) =>
      punctuationNormalizedCourse(task.title) === punctuationNormalizedCourse(source.courseName));
    method = candidates.length ? "exact_course_name" : null;
  }
  if (candidates.length > 1 && source.surveyType === "ID_SME_REVIEW" && source.publicationYear) {
    const withYear = candidates.filter((task) => task.publication_year === source.publicationYear);
    if (withYear.length) {
      candidates = withYear;
      method = "course_name_year";
    }
  }
  if (!candidates.length) {
    candidates = tasks.filter((task) =>
      punctuationNormalizedCourse(task.title, true) === punctuationNormalizedCourse(source.courseName, true));
    method = candidates.length ? "case_insensitive_course_name" : null;
  }
  return { candidates, method };
}

async function loadAll<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1_000) {
    const { data, error } = await fetchPage(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < 1_000) break;
  }
  return rows;
}

function addIssue(row: HistoricalPreviewRow, issue: HistoricalImportIssue) {
  row.issues.push(issue);
}

function setStatus(row: HistoricalPreviewRow, status: HistoricalImportStatus) {
  row.status = status;
  row.selected = status !== "Blocked" && status !== "Duplicate" && status !== "Possible match";
}

function matchProject(row: HistoricalPreviewRow, tasks: TaskCandidate[]) {
  if (!row.normalized) return;
  const source = row.normalized;
  const { candidates, method } = resolveHistoricalProjectMatch(source, tasks);

  if (candidates.length === 1) {
    row.match.projectId = candidates[0].id;
    row.match.matchedWrikeTaskId = candidates[0].wrike_id;
    row.match.method = method;
    row.match.confidence = method === "wrike_task_id" ? 1 : method === "course_name_year" ? 0.98 : 0.95;
    return;
  }

  row.match.candidates = candidates.slice(0, 20).map((task) => ({
    id: task.id,
    wrikeTaskId: task.wrike_id,
    courseName: task.title,
    publicationYear: task.publication_year,
  }));
  if (candidates.length > 1) {
    addIssue(row, {
      code: "ambiguous_project",
      field: "courseName",
      message: "Multiple DevTrack projects are possible matches. Select one or explicitly import this row unmatched.",
      severity: "error",
      originalValue: source.courseName,
    });
    setStatus(row, "Possible match");
  } else {
    addIssue(row, {
      code: "missing_project",
      field: source.wrikeTaskId ? "wrikeTaskId" : "courseName",
      message: "No DevTrack project matched; this response may be imported unmatched.",
      severity: "warning",
      originalValue: source.wrikeTaskId ?? source.courseName,
    });
    if (row.status === "Ready") setStatus(row, "Ready with warnings");
  }
}

function findPrincipal(person: { name: string; email: string | null }, principals: PrincipalCandidate[]) {
  if (person.email) {
    const byEmail = principals.filter((principal) =>
      principal.normalized_email_hash === emailHash(person.email as string));
    if (byEmail.length === 1) return { id: byEmail[0].id, method: "email" as const };
  }
  const key = normalizedName(person.name);
  const byName = key
    ? principals.filter((principal) => principal.display_name && normalizedName(principal.display_name) === key)
    : [];
  return byName.length === 1 ? { id: byName[0].id, method: "name" as const } : null;
}

export function resolveHistoricalPersonAssociation(
  person: { name: string; email: string | null },
  candidates: Array<{ id: string; name: string; email: string | null }>,
) {
  if (person.email) {
    const email = person.email.trim().toLocaleLowerCase("en-US");
    const byEmail = candidates.filter((candidate) =>
      candidate.email?.trim().toLocaleLowerCase("en-US") === email);
    if (byEmail.length === 1) return { id: byEmail[0].id, method: "email" as const };
    if (byEmail.length > 1) return null;
  }
  const key = normalizedName(person.name);
  const byName = key ? candidates.filter((candidate) => normalizedName(candidate.name) === key) : [];
  return byName.length === 1 ? { id: byName[0].id, method: "name" as const } : null;
}

function findWrikeUser(person: { name: string; email: string | null }, users: WrikeUserCandidate[]) {
  const eligible = users.filter((user) => user.identity_verified && !user.is_unresolved);
  return resolveHistoricalPersonAssociation(person, eligible.map((user) => ({
    id: user.id, name: user.display_name, email: user.email,
  })));
}

function matchPeople(
  row: HistoricalPreviewRow,
  principals: PrincipalCandidate[],
  users: WrikeUserCandidate[],
) {
  if (!row.normalized) return;
  const respondent = row.normalized.surveyType === "SME_DEBRIEF"
    ? row.normalized.sme : row.normalized.reviewer;
  const reviewed = row.normalized.surveyType === "SME_DEBRIEF"
    ? row.normalized.sme : row.normalized.reviewedSme;
  const principal = findPrincipal(respondent, principals);
  const reviewedUser = findWrikeUser(reviewed, users);
  if (principal) {
    respondent.matchedPrincipalId = principal.id;
    respondent.matchMethod = principal.method;
  } else {
    addIssue(row, {
      code: "missing_respondent",
      field: row.normalized.surveyType === "SME_DEBRIEF" ? "smeName" : "reviewerName",
      message: "The respondent was not associated with an existing DevTrack person.",
      severity: "warning",
      originalValue: respondent,
    });
  }
  if (reviewedUser) {
    reviewed.matchedWrikeUserId = reviewedUser.id;
    reviewed.matchMethod = reviewedUser.method;
  } else {
    addIssue(row, {
      code: "missing_reviewed_sme",
      field: row.normalized.surveyType === "SME_DEBRIEF" ? "smeName" : "reviewedSmeName",
      message: "The SME was not associated with an existing verified contact.",
      severity: "warning",
      originalValue: reviewed,
    });
  }
  if (row.status === "Ready" && row.issues.some((issue) => issue.severity === "warning")) {
    setStatus(row, "Ready with warnings");
  }
}

function issueCode(issue: HistoricalImportIssue) {
  if (issue.code === "ambiguous_project") return "ambiguous_project";
  if (issue.code === "missing_project") return "missing_project";
  if (issue.code === "missing_respondent") return "missing_respondent";
  if (issue.code === "missing_reviewed_sme") return "missing_reviewed_sme";
  if (issue.code === "duplicate_response") return "duplicate_response";
  if (issue.code.includes("timestamp")) return "missing_timestamp";
  if (issue.code.includes("type") || issue.code.includes("header")) return "question_mapping_problem";
  return "invalid_answer";
}

function internalType(row: HistoricalSurveyImportRow) {
  return row.surveyType === "SME_DEBRIEF" ? "course_development_debrief" : "id_sme_review";
}

export async function stageFinalizedHistoricalSurveyFile(input: StageInput): Promise<FinalizedHistoricalBatchSummary> {
  if (!input.filename.toLocaleLowerCase("en-US").endsWith(".csv")) throw new Error("Select a .csv file.");
  if (!input.bytes.length || input.bytes.length > 10 * 1024 * 1024) {
    throw new Error("Historical CSV files must be between 1 byte and 10 MB.");
  }
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
  } catch {
    throw new Error("Historical CSV files must use UTF-8 encoding.");
  }
  const inspection = inspectFinalizedHistoricalCsv(source, input.timezone);
  const admin = createAdminClient();
  const fileChecksum = checksum(input.bytes);
  const { data: existing, error: existingError } = await admin.from("survey_historical_import_batches")
    .select("id,summary,external_survey_type,survey_versions")
    .eq("organization_id", input.organizationId).eq("file_checksum", fileChecksum).maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) {
    await admin.from("survey_historical_import_upload_attempts").insert({
      organization_id: input.organizationId,
      batch_id: existing.id,
      source_filename: input.filename,
      file_checksum: fileChecksum,
      duplicate_upload: true,
      uploaded_by: input.actorId,
    });
    const summary = existing.summary as Record<string, number>;
    return {
      batchId: existing.id,
      duplicateUpload: true,
      totalRows: Number(summary.totalRows ?? 0),
      validRows: Number(summary.validRows ?? summary.readyRows ?? 0),
      warningCount: Number(summary.warningCount ?? summary.warningIssues ?? 0),
      errorCount: Number(summary.errorCount ?? summary.blockingIssues ?? 0),
      surveyType: existing.external_survey_type,
      surveyVersions: existing.survey_versions ?? [],
    };
  }

  const batchId = randomUUID();
  const fileBlocking = inspection.errorCount > 0 && inspection.rows.length === 0;
  const { error: batchError } = await admin.from("survey_historical_import_batches").insert({
    id: batchId,
    organization_id: input.organizationId,
    source_filename: input.filename,
    file_checksum: fileChecksum,
    schema_checksum: checksum(inspection.headers.join("\u001f")),
    survey_type: inspection.internalSurveyType,
    external_survey_type: inspection.detectedSurveyType,
    survey_versions: inspection.surveyVersions,
    source_timezone: input.timezone,
    headers: inspection.headers,
    status: fileBlocking ? "invalid" : "staged",
    summary: {
      totalRows: inspection.totalRows,
      validRows: inspection.validRows,
      warningCount: inspection.warningCount,
      errorCount: inspection.errorCount,
      fileIssues: inspection.issues,
    },
    imported_by: input.actorId,
    validated_at: new Date().toISOString(),
  });
  if (batchError) throw new Error(batchError.message);
  await admin.from("survey_historical_import_upload_attempts").insert({
    organization_id: input.organizationId,
    batch_id: batchId,
    source_filename: input.filename,
    file_checksum: fileChecksum,
    duplicate_upload: false,
    uploaded_by: input.actorId,
  });

  if (fileBlocking || !inspection.detectedSurveyType) {
    if (inspection.issues.length) {
      await admin.from("survey_historical_import_issues").insert(inspection.issues.map((issue) => ({
        organization_id: input.organizationId,
        batch_id: batchId,
        row_id: null,
        issue_code: issueCode(issue),
        severity: "blocking",
        source_field: issue.field,
        message: issue.message,
        raw_value: issue.originalValue ?? null,
        candidates: [],
      })));
    }
    return {
      batchId,
      duplicateUpload: false,
      totalRows: inspection.totalRows,
      validRows: inspection.validRows,
      warningCount: inspection.warningCount,
      errorCount: inspection.errorCount,
      surveyType: inspection.detectedSurveyType,
      surveyVersions: inspection.surveyVersions,
    };
  }

  const [tasks, reportingYears, principals, users, persisted, legacyRows] = await Promise.all([
    loadAll<Omit<TaskCandidate, "publication_year">>((from, to) => admin.from("wrike_tasks")
      .select("id,wrike_id,title").eq("organization_id", input.organizationId)
      .eq("is_deleted", false).range(from, to) as never),
    loadAll<{ task_id: string; display_values: string[] }>((from, to) => admin.from("wrike_task_normalized_custom_field_values")
      .select("task_id,display_values,field:wrike_normalized_custom_fields!inner(normalized_key,organization_id)")
      .eq("field.organization_id", input.organizationId)
      .in("field.normalized_key", ["publication", "publication date", "publish date"])
      .eq("has_conflict", false).range(from, to) as never),
    loadAll<PrincipalCandidate>((from, to) => admin.from("application_user_principals")
      .select("id,display_name,normalized_email_hash,state,historical_wrike_user_id")
      .eq("organization_id", input.organizationId).range(from, to) as never),
    loadAll<WrikeUserCandidate>((from, to) => admin.from("wrike_users")
      .select("id,display_name,email,identity_verified,is_unresolved")
      .eq("organization_id", input.organizationId).range(from, to) as never),
    loadAll<{ id: string; survey_type: string; source_response_id: string; original_source_response_id: string }>((from, to) => admin.from("historical_survey_responses")
      .select("id,survey_type,source_response_id,original_source_response_id")
      .eq("organization_id", input.organizationId).range(from, to) as never),
    loadAll<{
      id: string;
      survey_type: string;
      external_survey_type: string | null;
      source_response_id: string | null;
      match_diagnostics: Record<string, unknown>;
      row_status: string;
    }>((from, to) => admin.from("survey_historical_import_rows")
      .select("id,survey_type,external_survey_type,source_response_id,match_diagnostics,row_status")
      .eq("organization_id", input.organizationId).in("row_status", ["integrated", "duplicate"])
      .range(from, to) as never),
  ]);
  const yearByTask = new Map(reportingYears.flatMap((row) => {
    const date = row.display_values.find((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
    return date ? [[row.task_id, Number(date.slice(0, 4))] as const] : [];
  }));
  const taskCandidates: TaskCandidate[] = tasks.map((task) => ({
    ...task,
    publication_year: yearByTask.get(task.id) ?? null,
  }));
  const persistedByKey = new Map<string, string>();
  for (const row of persisted) {
    persistedByKey.set(
      historicalDuplicateKey(input.organizationId, row.survey_type as never, row.source_response_id),
      row.id,
    );
    persistedByKey.set(
      historicalDuplicateKey(input.organizationId, row.survey_type as never, row.original_source_response_id),
      row.id,
    );
  }
  const legacyKeys = new Set(legacyRows.map((row) => {
    const externalType = row.external_survey_type
      ?? (row.survey_type === "course_development_debrief" ? "SME_DEBRIEF"
        : row.survey_type === "id_sme_review" ? "ID_SME_REVIEW" : null);
    const sourceId = row.source_response_id
      ?? (typeof row.match_diagnostics?.sourceResponseId === "string"
        ? row.match_diagnostics.sourceResponseId : null);
    return externalType && sourceId
      ? historicalDuplicateKey(input.organizationId, externalType as never, sourceId)
      : null;
  }).filter(Boolean));
  const withinFile = new Set<string>();

  for (const row of inspection.rows) {
    matchProject(row, taskCandidates);
    matchPeople(row, principals, users);
    if (!row.normalized) continue;
    const duplicateKey = historicalDuplicateKey(input.organizationId, row.normalized.surveyType, row.normalized.sourceResponseId);
    const targetId = persistedByKey.get(duplicateKey) ?? null;
    if (targetId || legacyKeys.has(duplicateKey) || withinFile.has(duplicateKey)) {
      addIssue(row, {
        code: "duplicate_response",
        field: "sourceResponseId",
        message: targetId
          ? "A historical response with this survey type and source response ID already exists."
          : withinFile.has(duplicateKey)
            ? "This file repeats the same survey type and source response ID."
            : "A previous import already staged or integrated this source response ID.",
        severity: "error",
        originalValue: row.normalized.sourceResponseId,
      });
      row.duplicateAction = "skip";
      row.selected = false;
      row.status = "Duplicate";
      row.effectiveSourceResponseId = row.normalized.sourceResponseId;
      (row as HistoricalPreviewRow & { duplicateTargetId?: string | null }).duplicateTargetId = targetId;
    } else withinFile.add(duplicateKey);
  }

  const rowsToInsert = inspection.rows.map((row) => {
    const normalized = row.normalized as HistoricalSurveyImportRow;
    const respondent = normalized.surveyType === "SME_DEBRIEF" ? normalized.sme : normalized.reviewer;
    const reviewed = normalized.surveyType === "SME_DEBRIEF" ? normalized.sme : normalized.reviewedSme;
    const duplicateTargetId = (row as HistoricalPreviewRow & { duplicateTargetId?: string | null }).duplicateTargetId ?? null;
    return {
      id: randomUUID(),
      organization_id: input.organizationId,
      batch_id: batchId,
      row_number: row.rowNumber,
      row_checksum: checksum(JSON.stringify(row.original)),
      fingerprint: checksum(`${normalized.surveyType}:${normalized.sourceResponseId}:${JSON.stringify(normalized)}`),
      canonical_identity_key: checksum(`${normalized.surveyType}:${normalized.sourceResponseId}`),
      survey_type: internalType(normalized),
      external_survey_type: normalized.surveyType,
      survey_version: normalized.surveyVersion,
      source_response_id: normalized.sourceResponseId,
      effective_source_response_id: row.effectiveSourceResponseId,
      raw_row: row.original,
      normalized_answers: normalized,
      context_snapshot: {
        matchedWrikeTaskId: row.match.matchedWrikeTaskId,
        matchMethod: row.match.method,
        matchConfidence: row.match.confidence,
      },
      match_diagnostics: {
        status: row.status,
        candidates: row.match.candidates,
        issues: row.issues,
        explicitlyUnmatched: row.match.explicitlyUnmatched,
      },
      normalization_deltas: row.normalizations,
      source_submitted_at: normalized.submittedAt,
      matched_task_id: row.match.projectId,
      respondent_principal_id: respondent.matchedPrincipalId ?? null,
      reviewed_wrike_user_id: reviewed.matchedWrikeUserId ?? null,
      selected_for_import: row.selected,
      duplicate_action: row.duplicateAction,
      duplicate_target_response_id: duplicateTargetId,
      row_status: row.status === "Duplicate" ? "duplicate"
        : row.status === "Blocked" || row.status === "Possible match" ? "issues" : "ready",
    };
  });
  const rowIds = new Map(rowsToInsert.map((row) => [row.row_number, row.id]));
  const issuesToInsert = inspection.rows.flatMap((row) => row.issues.map((issue) => ({
    organization_id: input.organizationId,
    batch_id: batchId,
    row_id: rowIds.get(row.rowNumber),
    issue_code: issueCode(issue),
    severity: issue.severity === "error" ? "blocking" : "warning",
    source_field: issue.field,
    message: issue.message,
    raw_value: issue.originalValue ?? null,
    candidates: row.match.candidates,
  })));
  if (rowsToInsert.length) {
    const { error } = await admin.from("survey_historical_import_rows").insert(rowsToInsert);
    if (error) throw new Error(error.message);
  }
  if (issuesToInsert.length) {
    const { error } = await admin.from("survey_historical_import_issues").insert(issuesToInsert);
    if (error) throw new Error(error.message);
  }
  const summary = {
    totalRows: inspection.totalRows,
    validRows: inspection.validRows,
    warningCount: issuesToInsert.filter((issue) => issue.severity === "warning").length,
    errorCount: issuesToInsert.filter((issue) => issue.severity === "blocking").length,
    readyRows: rowsToInsert.filter((row) => row.row_status === "ready").length,
    duplicateRows: rowsToInsert.filter((row) => row.row_status === "duplicate").length,
    blockedRows: rowsToInsert.filter((row) => row.row_status === "issues").length,
  };
  const { error: summaryError } = await admin.from("survey_historical_import_batches").update({
    status: summary.readyRows || summary.duplicateRows ? "ready" : "staged",
    summary,
  }).eq("id", batchId);
  if (summaryError) throw new Error(summaryError.message);
  return {
    batchId,
    duplicateUpload: false,
    totalRows: summary.totalRows,
    validRows: summary.validRows,
    warningCount: summary.warningCount,
    errorCount: summary.errorCount,
    surveyType: inspection.detectedSurveyType,
    surveyVersions: inspection.surveyVersions,
  };
}

export async function markBatchFailed(
  supabase: SupabaseClient,
  organizationId: string,
  batchId: string,
  message: string,
) {
  const admin = createAdminClient();
  await admin.from("survey_historical_import_batches").update({
    status: "partially_integrated",
    summary: { batchFailure: message },
  }).eq("id", batchId).eq("organization_id", organizationId);
  await supabase.rpc("finalized_historical_import_summary", { target_batch_id: batchId });
}

export function separateSourceIdForRow(sourceResponseId: string, batchId: string, rowId: string) {
  return `${sourceResponseId}#duplicate-${createHash("sha256").update(`${batchId}:${rowId}`).digest("hex").slice(0, 16)}`;
}
