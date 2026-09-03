import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  detectHistoricalSurveyType,
  historicalColumnMappings,
  historicalFingerprint,
  historicalRowChecksum,
  historicalSchemaChecksum,
  historicalSurveyDefinition,
  normalizeHistoricalTitle,
  parseHistoricalCsv,
  parseHistoricalRow,
  type HistoricalImportIssue,
} from "@/lib/surveys/historical-import";
import type { SurveyType } from "@/lib/surveys/domain";
import { surveyDefinitionSchema, type SurveyDefinition } from "@/lib/surveys/definition";

type StageInput = {
  organizationId: string;
  actorId: string;
  filename: string;
  bytes: Uint8Array;
  timezone: string;
  supabase: SupabaseClient;
};

type TaskRow = { id: string; wrike_id: string; title: string; status: string; custom_status_id: string | null };
type WrikeUserRow = {
  id: string; display_name: string; email: string | null; identity_verified: boolean;
  is_unresolved: boolean; is_active: boolean;
};
type PersonaRow = { application_user_id: string; wrike_user_id: string | null; operational_role: string; is_active: boolean };
type PrincipalRow = {
  id: string; display_name: string | null; state: string; historical_wrike_user_id: string | null;
  normalized_email_hash: string | null;
};
type ExistingSurvey = {
  id: string; survey_type: SurveyType; task_id: string; subject_application_user_id: string | null;
  reviewed_wrike_user_id: string | null; created_by: string; status: string;
};

export type HistoricalImportBatchSummary = {
  batchId: string;
  duplicateUpload: boolean;
  surveyType: SurveyType | null;
  totalRows: number;
  readyRows: number;
  issueRows: number;
  blockingIssues: number;
  warningIssues: number;
};

const emailHash = (value: string) => createHash("sha256").update(value.trim().toLocaleLowerCase("en-US")).digest("hex");
const normalizedName = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");

async function loadAll<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
) {
  const rows: T[] = [];
  const size = 1_000;
  for (let from = 0; ; from += size) {
    const { data, error } = await fetchPage(from, from + size - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < size) break;
  }
  return rows;
}

function suggestionScore(source: string, candidate: string) {
  const sourceTokens = new Set(normalizeHistoricalTitle(source).split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const candidateTokens = new Set(normalizeHistoricalTitle(candidate).split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  if (!sourceTokens.size || !candidateTokens.size) return 0;
  const shared = [...sourceTokens].filter((token) => candidateTokens.has(token)).length;
  return shared / new Set([...sourceTokens, ...candidateTokens]).size;
}

function projectSuggestions(source: string, tasks: TaskRow[]) {
  return tasks.map((task) => ({ ...task, score: suggestionScore(source, task.title) }))
    .filter((task) => task.score >= 0.35)
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, 5)
    .map((task) => ({ id: task.id, wrikeId: task.wrike_id, title: task.title, score: Number(task.score.toFixed(3)) }));
}

function candidateUsers(name: string, email: string | null, users: WrikeUserRow[]) {
  const eligible = users.filter((user) => user.identity_verified && !user.is_unresolved);
  if (email) {
    const exactEmail = eligible.filter((user) => user.email?.trim().toLocaleLowerCase("en-US") === email.trim().toLocaleLowerCase("en-US"));
    if (exactEmail.length) return exactEmail;
  }
  const key = normalizedName(name);
  return key ? eligible.filter((user) => normalizedName(user.display_name) === key) : [];
}

function issue(
  issues: StagedIssue[],
  code: StagedIssue["issue_code"],
  message: string,
  options: Partial<Pick<StagedIssue, "source_field" | "raw_value" | "candidates" | "severity">> = {},
) {
  issues.push({
    id: randomUUID(), organization_id: "", batch_id: "", row_id: "",
    issue_code: code, severity: options.severity ?? "blocking",
    source_field: options.source_field ?? null, message,
    raw_value: options.raw_value ?? null, candidates: options.candidates ?? [],
  });
}

type StagedIssue = {
  id: string;
  organization_id: string;
  batch_id: string;
  row_id: string;
  issue_code:
    | "survey_type_conflict" | "missing_project" | "ambiguous_project"
    | "missing_respondent" | "ambiguous_respondent" | "missing_reviewed_sme"
    | "ambiguous_reviewed_sme" | "missing_assignment" | "question_mapping_problem"
    | "invalid_answer" | "duplicate_response" | "repeat_identity"
    | "canonical_collision" | "missing_timestamp" | "integration_failed";
  severity: "blocking" | "warning";
  source_field: string | null;
  message: string;
  raw_value: unknown;
  candidates: unknown[];
};

function parserIssue(target: StagedIssue[], source: HistoricalImportIssue) {
  issue(target, source.code, source.message, {
    source_field: source.field,
    raw_value: source.rawValue,
    severity: source.severity,
  });
}

export async function stageHistoricalSurveyFile(input: StageInput): Promise<HistoricalImportBatchSummary> {
  const admin = createAdminClient();
  if (!input.bytes.length || input.bytes.length > 10 * 1024 * 1024) throw new Error("Historical CSV files must be between 1 byte and 10 MB.");
  const fileChecksum = createHash("sha256").update(input.bytes).digest("hex");
  const { data: existingBatch, error: existingError } = await admin.from("survey_historical_import_batches")
    .select("id,survey_type,status,summary,validated_at")
    .eq("organization_id", input.organizationId).eq("file_checksum", fileChecksum).maybeSingle();
  if (existingError) throw new Error(existingError.message);
  const resumableBatch = Boolean(existingBatch && existingBatch.status === "staged" && !existingBatch.validated_at);
  if (existingBatch && !resumableBatch) {
    const { error } = await admin.from("survey_historical_import_upload_attempts").insert({
      organization_id: input.organizationId, batch_id: existingBatch.id, source_filename: input.filename,
      file_checksum: fileChecksum, duplicate_upload: true, uploaded_by: input.actorId,
    });
    if (error) throw new Error(error.message);
    const summary = existingBatch.summary as Record<string, number>;
    return {
      batchId: existingBatch.id, duplicateUpload: true,
      surveyType: existingBatch.survey_type as SurveyType | null,
      totalRows: Number(summary.totalRows ?? 0), readyRows: Number(summary.readyRows ?? 0),
      issueRows: Number(summary.issueRows ?? 0), blockingIssues: Number(summary.blockingIssues ?? 0),
      warningIssues: Number(summary.warningIssues ?? 0),
    };
  }

  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
  } catch {
    throw new Error("Historical CSV files must use UTF-8 encoding.");
  }
  const document = parseHistoricalCsv(source);
  if (document.rows.length > 10_000 || document.headers.length > 250) throw new Error("Historical CSV files may contain at most 10,000 rows and 250 columns.");
  const detection = detectHistoricalSurveyType(input.filename, document.headers, document.rows);
  const batchId = existingBatch?.id ?? randomUUID();
  const surveyType = detection.surveyType;
  const schemaChecksum = surveyType ? historicalSchemaChecksum(surveyType, document.headers) : null;
  const canonicalVersions = detection.format === "canonical"
    ? [...new Set(document.rows.map((row) => Number(row.surveyVersion)).filter((value) => Number.isInteger(value) && value > 0))]
    : [];
  const canonicalVersionConflict = detection.format === "canonical" && canonicalVersions.length !== 1;

  let versionId: string | null = null;
  let definition: SurveyDefinition | null = null;
  let publishedAt = "";
  let canonicalVersionError: string | null = null;
  if (surveyType && !detection.conflict && !canonicalVersionConflict) {
    if (detection.format === "canonical") {
      const { data, error } = await admin.from("survey_template_versions")
        .select("id,definition,published_at")
        .eq("organization_id", input.organizationId)
        .eq("survey_type", surveyType)
        .eq("version_number", canonicalVersions[0])
        .eq("version_origin", "published")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) {
        canonicalVersionError = `Published ${surveyType.replaceAll("_", " ")} version ${canonicalVersions[0]} was not found. Download a current template and verify surveyVersion.`;
      } else {
        const parsedDefinition = surveyDefinitionSchema.safeParse(data.definition);
        if (!parsedDefinition.success) throw new Error("The referenced published survey definition is invalid.");
        definition = parsedDefinition.data;
        versionId = data.id;
        publishedAt = data.published_at;
      }
    } else {
      definition = historicalSurveyDefinition(surveyType);
      const { data, error } = await input.supabase.rpc("ensure_historical_survey_version", {
        requested_type: surveyType,
        requested_schema_checksum: schemaChecksum,
        requested_definition: definition,
      });
      if (error || !data) throw new Error(error?.message ?? "Historical survey version could not be created.");
      versionId = data as string;
    }
  }

  if (resumableBatch) {
    const { error: issueCleanupError } = await admin.from("survey_historical_import_issues").delete().eq("batch_id", batchId);
    if (issueCleanupError) throw new Error(issueCleanupError.message);
    const { error: rowCleanupError } = await admin.from("survey_historical_import_rows").delete().eq("batch_id", batchId);
    if (rowCleanupError) throw new Error(rowCleanupError.message);
    const { error: mappingCleanupError } = await admin.from("survey_historical_import_column_mappings").delete().eq("batch_id", batchId);
    if (mappingCleanupError) throw new Error(mappingCleanupError.message);
    const { error: batchError } = await admin.from("survey_historical_import_batches").update({
      source_filename: input.filename, schema_checksum: schemaChecksum, survey_type: surveyType,
      source_timezone: input.timezone, headers: document.headers, status: surveyType && !canonicalVersionConflict && !canonicalVersionError ? "staged" : "invalid",
      summary: {}, validated_at: null,
    }).eq("id", batchId);
    if (batchError) throw new Error(batchError.message);
  } else {
    const { error: batchError } = await admin.from("survey_historical_import_batches").insert({
      id: batchId, organization_id: input.organizationId, source_filename: input.filename,
      file_checksum: fileChecksum, schema_checksum: schemaChecksum, survey_type: surveyType,
      source_timezone: input.timezone, headers: document.headers, status: surveyType && !canonicalVersionConflict && !canonicalVersionError ? "staged" : "invalid",
      imported_by: input.actorId,
    });
    if (batchError) throw new Error(batchError.message);
  }
  const { error: attemptError } = await admin.from("survey_historical_import_upload_attempts").insert({
    organization_id: input.organizationId, batch_id: batchId, source_filename: input.filename,
    file_checksum: fileChecksum, duplicate_upload: resumableBatch, uploaded_by: input.actorId,
  });
  if (attemptError) throw new Error(attemptError.message);

  if (!surveyType || detection.conflict || canonicalVersionConflict || canonicalVersionError) {
    const { error: issueError } = await admin.from("survey_historical_import_issues").insert({
      organization_id: input.organizationId, batch_id: batchId, row_id: null,
      issue_code: detection.conflict ? "survey_type_conflict" : "question_mapping_problem",
      severity: "blocking",
      message: detection.conflict
        ? "The filename and CSV headers identify different survey types."
        : canonicalVersionConflict
          ? "Canonical CSV rows must all reference one positive published surveyVersion."
        : canonicalVersionError
          ? canonicalVersionError
        : "The CSV headers do not match a supported historical survey.",
      raw_value: { filename: input.filename, headers: document.headers },
      candidates: [],
    });
    if (issueError) throw new Error(issueError.message);
    await admin.from("survey_historical_import_batches").update({
      status: "invalid",
      summary: { format: detection.format, totalRows: document.rows.length, readyRows: 0, issueRows: document.rows.length, blockingIssues: 1, warningIssues: 0 },
    }).eq("id", batchId);
    return { batchId, duplicateUpload: false, surveyType, totalRows: document.rows.length, readyRows: 0, issueRows: document.rows.length, blockingIssues: 1, warningIssues: 0 };
  }

  if (!definition) throw new Error("The survey definition could not be resolved.");
  const knownMappings = historicalColumnMappings(
    surveyType, detection.format, definition, canonicalVersions[0] ?? 1, publishedAt,
  );
  const mappingsByHeader = new Map(knownMappings.map((item) => [normalizeHistoricalTitle(item.heading), item]));
  const unmappedHeaders = document.headers.filter((heading) => !mappingsByHeader.has(normalizeHistoricalTitle(heading)));
  const { error: mappingError } = await admin.from("survey_historical_import_column_mappings").insert(document.headers.map((heading, index) => {
    const found = mappingsByHeader.get(normalizeHistoricalTitle(heading));
    return {
      organization_id: input.organizationId, batch_id: batchId, column_ordinal: index,
      original_heading: heading, canonical_question_id: found?.canonicalId ?? null,
      mapping_target: found?.target ?? "unmapped", normalized_conversion: found?.conversion ?? null,
      mapping_source: "automatic",
    };
  }));
  if (mappingError) throw new Error(mappingError.message);

  const [tasks, users, personas, principals, applicationUsers, existingSurveys, existingIntegrations, idAssignmentsResult, smeAssignmentsResult, reportingValues, smeProfiles] = await Promise.all([
    loadAll<TaskRow>((from, to) => admin.from("wrike_tasks").select("id,wrike_id,title,status,custom_status_id")
      .eq("organization_id", input.organizationId).eq("is_deleted", false).range(from, to) as never),
    loadAll<WrikeUserRow>((from, to) => admin.from("wrike_users").select("id,display_name,email,identity_verified,is_unresolved,is_active")
      .eq("organization_id", input.organizationId).range(from, to) as never),
    loadAll<PersonaRow>((from, to) => admin.from("application_user_operational_personas")
      .select("application_user_id,wrike_user_id,operational_role,is_active")
      .eq("organization_id", input.organizationId).range(from, to) as never),
    loadAll<PrincipalRow>((from, to) => admin.from("application_user_principals")
      .select("id,display_name,state,historical_wrike_user_id,normalized_email_hash")
      .eq("organization_id", input.organizationId).range(from, to) as never),
    loadAll<{ id: string; display_name: string | null; wrike_user_id: string | null }>((from, to) => admin.from("application_users")
      .select("id,display_name,wrike_user_id").eq("organization_id", input.organizationId).range(from, to) as never),
    loadAll<ExistingSurvey>((from, to) => admin.from("survey_submissions")
      .select("id,survey_type,task_id,subject_application_user_id,reviewed_wrike_user_id,created_by,status")
      .eq("organization_id", input.organizationId).range(from, to) as never),
    loadAll<{ fingerprint: string; submission_id: string | null }>((from, to) => admin.from("survey_historical_import_integrations")
      .select("fingerprint,submission_id").eq("organization_id", input.organizationId).is("rolled_back_at", null).range(from, to) as never),
    admin.rpc("course_development_person_assignments", { target_organization_id: input.organizationId, target_role: "id" }),
    admin.rpc("course_development_person_assignments", { target_organization_id: input.organizationId, target_role: "sme" }),
    loadAll<{ task_id: string; reporting_year: number | null }>((from, to) => admin.from("wrike_task_normalized_custom_field_values")
      .select("task_id,reporting_year,task:wrike_tasks!inner(organization_id)")
      .eq("task.organization_id", input.organizationId).not("reporting_year", "is", null).range(from, to) as never),
    loadAll<{ application_user_id: string; classification: "internal" | "external" | null }>((from, to) => admin.from("application_user_sme_profiles")
      .select("application_user_id,classification").eq("organization_id", input.organizationId).range(from, to) as never),
  ]);
  if (idAssignmentsResult.error || smeAssignmentsResult.error) throw new Error(idAssignmentsResult.error?.message ?? smeAssignmentsResult.error?.message ?? "Project assignments could not be loaded.");

  const principalByWrike = new Map<string, string>();
  for (const persona of personas) if (persona.is_active && persona.wrike_user_id) principalByWrike.set(persona.wrike_user_id, persona.application_user_id);
  for (const member of applicationUsers) if (member.wrike_user_id) principalByWrike.set(member.wrike_user_id, member.id);
  for (const principal of principals) if (principal.state === "historical" && principal.historical_wrike_user_id) principalByWrike.set(principal.historical_wrike_user_id, principal.id);
  const principalByName = new Map<string, string[]>();
  const principalByEmailHash = new Map<string, string[]>();
  for (const principal of principals) {
    if (principal.display_name) principalByName.set(normalizedName(principal.display_name), [...(principalByName.get(normalizedName(principal.display_name)) ?? []), principal.id]);
    if (principal.normalized_email_hash) principalByEmailHash.set(principal.normalized_email_hash, [...(principalByEmailHash.get(principal.normalized_email_hash) ?? []), principal.id]);
  }
  const idAssignments = new Set((idAssignmentsResult.data ?? []).map((row: { task_id: string; wrike_user_id: string }) => `${row.task_id}:${row.wrike_user_id}`));
  const smeAssignments = new Set((smeAssignmentsResult.data ?? []).map((row: { task_id: string; wrike_user_id: string }) => `${row.task_id}:${row.wrike_user_id}`));
  const reportingByTask = new Map(reportingValues.map((row) => [row.task_id, row.reporting_year]));
  const classificationByPrincipal = new Map(smeProfiles.map((row) => [row.application_user_id, row.classification]));
  const integratedFingerprints = new Set(existingIntegrations.map((row) => row.fingerprint));
  const rowsToInsert: Record<string, unknown>[] = [];
  const issuesToInsert: StagedIssue[] = [];
  const stagedByIdentity = new Map<string, { rowId: string; fingerprint: string }[]>();

  for (const [index, rawRow] of document.rows.entries()) {
    const rowId = randomUUID();
    const parsed = parseHistoricalRow(
      surveyType, rawRow, input.timezone, detection.format, definition, canonicalVersions[0],
    );
    const stagedIssues: StagedIssue[] = [];
    parsed.issues.forEach((item) => parserIssue(stagedIssues, item));
    for (const heading of unmappedHeaders) issue(stagedIssues, "question_mapping_problem", `Map or explicitly ignore the unfamiliar column "${heading}".`, { source_field: heading, raw_value: rawRow[heading] });

    const exactTasks = parsed.wrikeTaskId
      ? tasks.filter((task) => task.wrike_id === parsed.wrikeTaskId)
      : tasks.filter((task) => normalizeHistoricalTitle(task.title) === normalizeHistoricalTitle(parsed.projectTitle));
    const matchedTask = exactTasks.length === 1 ? exactTasks[0] : null;
    if (!exactTasks.length) issue(stagedIssues, "missing_project", parsed.wrikeTaskId
      ? "The supplied Wrike Task ID does not identify an eligible synchronized project."
      : "No project has one exact normalized Course Name match.", {
      source_field: parsed.wrikeTaskId ? "Wrike Task ID" : "Course Name",
      raw_value: parsed.wrikeTaskId ?? parsed.projectTitle,
      candidates: projectSuggestions(parsed.projectTitle || parsed.projectKey, tasks),
    });
    else if (exactTasks.length > 1) issue(stagedIssues, "ambiguous_project", "More than one project has this exact normalized Course Name.", {
      source_field: "Course Name", raw_value: parsed.projectTitle,
      candidates: exactTasks.map((task) => ({ id: task.id, wrikeId: task.wrike_id, title: task.title })),
    });

    const respondentCandidates = candidateUsers(parsed.respondentName, parsed.respondentEmail, users);
    const reviewedCandidates = candidateUsers(parsed.reviewedSmeName, parsed.reviewedSmeEmail, users);
    const respondentWrike = respondentCandidates.length === 1 ? respondentCandidates[0] : null;
    const reviewedWrike = reviewedCandidates.length === 1 ? reviewedCandidates[0] : null;
    let respondentPrincipalId = respondentWrike ? principalByWrike.get(respondentWrike.id) ?? null : null;
    if (!respondentPrincipalId && parsed.respondentEmail) {
      const matches = principalByEmailHash.get(emailHash(parsed.respondentEmail)) ?? [];
      if (matches.length === 1) respondentPrincipalId = matches[0];
    }
    if (!respondentPrincipalId) {
      const matches = principalByName.get(normalizedName(parsed.respondentName)) ?? [];
      if (matches.length === 1) respondentPrincipalId = matches[0];
    }
    const trustedClassification = surveyType === "course_development_debrief" && respondentPrincipalId
      ? classificationByPrincipal.get(respondentPrincipalId) ?? null
      : null;
    const historicalClassification = parsed.sourceContext.historicalClassification;
    if (trustedClassification && historicalClassification && trustedClassification !== historicalClassification) {
      issue(stagedIssues, "invalid_answer", "The legacy Internal value conflicts with the trusted SME classification. DevTrack will retain the trusted classification.", {
        source_field: "Internal",
        raw_value: { source: historicalClassification, trusted: trustedClassification },
        severity: "warning",
      });
    }
    if (surveyType === "course_development_debrief" && trustedClassification === "internal") {
      delete parsed.answers.billableHours;
      delete parsed.answers.amountBilled;
    }
    if (surveyType === "course_development_debrief" && trustedClassification) {
      parsed.answers.legacyInternalEmployee = trustedClassification === "internal";
    }
    if (respondentCandidates.length > 1) issue(stagedIssues, "ambiguous_respondent", "More than one verified Wrike identity matches the respondent.", {
      source_field: surveyType === "id_sme_review" ? "Name" : "Email",
      raw_value: { name: parsed.respondentName, email: parsed.respondentEmail },
      candidates: respondentCandidates.map((candidate) => ({ id: candidate.id, name: candidate.display_name, email: candidate.email })),
    });
    else if (!respondentPrincipalId) issue(stagedIssues, "missing_respondent", respondentWrike
      ? "The respondent has a verified Wrike identity but needs an Admin-confirmed historical principal."
      : "The respondent could not be matched to one retained DevTrack principal.", {
      source_field: surveyType === "id_sme_review" ? "Name" : "Email",
      raw_value: { name: parsed.respondentName, email: parsed.respondentEmail },
      candidates: respondentCandidates.map((candidate) => ({ id: candidate.id, name: candidate.display_name, email: candidate.email })),
    });

    if (!reviewedCandidates.length) issue(stagedIssues, "missing_reviewed_sme", "The reviewed SME could not be matched to one verified Wrike identity.", {
      source_field: surveyType === "id_sme_review" ? "SME" : "SME Name",
      raw_value: { name: parsed.reviewedSmeName, email: parsed.reviewedSmeEmail },
    });
    else if (reviewedCandidates.length > 1) issue(stagedIssues, "ambiguous_reviewed_sme", "More than one verified Wrike identity matches the reviewed SME.", {
      source_field: surveyType === "id_sme_review" ? "SME" : "SME Name",
      raw_value: { name: parsed.reviewedSmeName, email: parsed.reviewedSmeEmail },
      candidates: reviewedCandidates.map((candidate) => ({ id: candidate.id, name: candidate.display_name, email: candidate.email })),
    });

    if (matchedTask && respondentWrike && surveyType === "id_sme_review" && !idAssignments.has(`${matchedTask.id}:${respondentWrike.id}`)) {
      issue(stagedIssues, "missing_assignment", "The matched reviewer is not currently resolved in the project's Designer Assigned field.", {
        candidates: [{ taskId: matchedTask.id, wrikeUserId: respondentWrike.id, role: "id" }],
      });
    }
    if (matchedTask && reviewedWrike && !smeAssignments.has(`${matchedTask.id}:${reviewedWrike.id}`)) {
      issue(stagedIssues, "missing_assignment", "The matched SME is not currently resolved in the project's SME field.", {
        candidates: [{ taskId: matchedTask.id, wrikeUserId: reviewedWrike.id, role: "sme" }],
      });
    }

    const identityKey = historicalFingerprint({
      organizationId: input.organizationId, surveyType,
      project: matchedTask?.id ?? normalizeHistoricalTitle(parsed.projectTitle),
      respondent: respondentPrincipalId ?? normalizedName(parsed.respondentName),
      reviewed: reviewedWrike?.id ?? normalizedName(parsed.reviewedSmeName),
    });
    const fingerprint = historicalFingerprint({
      organizationId: input.organizationId, surveyType,
      sourceResponseId: parsed.sourceResponseId, project: matchedTask?.id ?? normalizeHistoricalTitle(parsed.projectTitle),
      respondent: respondentPrincipalId ?? normalizedName(parsed.respondentName),
      reviewed: reviewedWrike?.id ?? normalizedName(parsed.reviewedSmeName),
      submittedAt: parsed.submittedAt, answers: parsed.answers,
    });
    if (integratedFingerprints.has(fingerprint)) issue(stagedIssues, "duplicate_response", "This exact historical response is already integrated.", { raw_value: fingerprint });

    const canonicalCollision = matchedTask && respondentPrincipalId && reviewedWrike
      ? existingSurveys.find((survey) => survey.task_id === matchedTask.id && survey.survey_type === surveyType
        && (surveyType === "course_development_debrief"
          ? survey.subject_application_user_id === respondentPrincipalId
          : survey.created_by === respondentPrincipalId && survey.reviewed_wrike_user_id === reviewedWrike.id))
      : null;
    if (canonicalCollision) issue(stagedIssues, "canonical_collision", `A ${canonicalCollision.status} canonical survey already exists for this identity.`, {
      candidates: [{ submissionId: canonicalCollision.id, status: canonicalCollision.status }],
    });

    const context = {
      taskId: matchedTask?.id ?? null, taskWrikeId: matchedTask?.wrike_id ?? null,
      taskTitle: matchedTask?.title ?? parsed.projectTitle, status: matchedTask?.status ?? "Unavailable",
      reportingYear: matchedTask ? reportingByTask.get(matchedTask.id) ?? null : null,
      publicationYear: surveyType === "id_sme_review" ? parsed.answers.publicationYear ?? null : null,
      vertical: surveyType === "id_sme_review" ? parsed.answers.vertical ?? null : null,
      smeClassification: surveyType === "course_development_debrief"
        ? trustedClassification ?? historicalClassification ?? null : null,
      subject: {
        applicationUserId: respondentPrincipalId, wrikeUserId: reviewedWrike?.id ?? null,
        name: parsed.reviewedSmeName, email: parsed.reviewedSmeEmail,
      },
    };
    const blocking = stagedIssues.some((item) => item.severity === "blocking");
    rowsToInsert.push({
      id: rowId, organization_id: input.organizationId, batch_id: batchId, row_number: index + 2,
      row_checksum: historicalRowChecksum(rawRow, document.headers), fingerprint,
      canonical_identity_key: identityKey, survey_type: surveyType, raw_row: rawRow,
      normalized_answers: parsed.answers, context_snapshot: context,
      match_diagnostics: {
        projectTitle: parsed.projectTitle, projectKey: parsed.projectKey,
        wrikeTaskId: parsed.wrikeTaskId, sourceResponseId: parsed.sourceResponseId,
        respondentName: parsed.respondentName, respondentEmail: parsed.respondentEmail,
        reviewedSmeName: parsed.reviewedSmeName, reviewedSmeEmail: parsed.reviewedSmeEmail,
      },
      source_submitted_at: parsed.submittedAt, matched_task_id: matchedTask?.id ?? null,
      respondent_principal_id: respondentPrincipalId,
      reviewed_wrike_user_id: reviewedWrike?.id ?? null,
      survey_version_id: versionId, row_status: blocking ? "issues" : "ready",
    });
    for (const item of stagedIssues) issuesToInsert.push({ ...item, organization_id: input.organizationId, batch_id: batchId, row_id: rowId });
    stagedByIdentity.set(identityKey, [...(stagedByIdentity.get(identityKey) ?? []), { rowId, fingerprint }]);
  }

  for (const group of stagedByIdentity.values()) {
    if (group.length < 2) continue;
    const exactDuplicate = new Set(group.map((item) => item.fingerprint)).size < group.length;
    for (const item of group) {
      issuesToInsert.push({
        id: randomUUID(), organization_id: input.organizationId, batch_id: batchId, row_id: item.rowId,
        issue_code: exactDuplicate ? "duplicate_response" : "repeat_identity", severity: "blocking",
        source_field: null,
        message: exactDuplicate
          ? "This file contains the same response more than once."
          : "Another distinct row has the same project, respondent, SME, and survey type. Choose one response or order the rows as revisions.",
        raw_value: null, candidates: group.map((candidate) => ({ rowId: candidate.rowId, fingerprint: candidate.fingerprint })),
      });
      const row = rowsToInsert.find((candidate) => candidate.id === item.rowId);
      if (row) row.row_status = "issues";
    }
  }
  if (rowsToInsert.length) {
    const { error } = await admin.from("survey_historical_import_rows").insert(rowsToInsert);
    if (error) throw new Error(error.message);
  }
  if (issuesToInsert.length) {
    const { error } = await admin.from("survey_historical_import_issues").insert(issuesToInsert);
    if (error) throw new Error(error.message);
  }
  const readyRows = rowsToInsert.filter((row) => row.row_status === "ready").length;
  const issueRows = rowsToInsert.length - readyRows;
  const blockingIssues = issuesToInsert.filter((item) => item.severity === "blocking").length;
  const warningIssues = issuesToInsert.filter((item) => item.severity === "warning").length;
  const summary = { format: detection.format, surveyVersion: canonicalVersions[0] ?? null, totalRows: rowsToInsert.length, readyRows, issueRows, blockingIssues, warningIssues, integratedRows: 0 };
  const { error: summaryError } = await admin.from("survey_historical_import_batches").update({
    status: readyRows ? "ready" : "staged", summary, validated_at: new Date().toISOString(),
  }).eq("id", batchId);
  if (summaryError) throw new Error(summaryError.message);
  return { batchId, duplicateUpload: false, surveyType, ...summary };
}
