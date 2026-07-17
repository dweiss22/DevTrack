import type { createAdminClient } from "@/lib/supabase/admin";
import { logWrikeEvent, WrikeApiError, type WrikeClient } from "@/lib/wrike/client";
import { mapWithConcurrency } from "@/lib/wrike/concurrency";
import {
  resolvedWrikeReference,
  unresolvedWrikeReference,
  type ResolvedWrikeReference
} from "@/lib/wrike/reference-resolution";
import { SELECTED_WRIKE_USERS, SELECTED_WRIKE_USER_BY_ID, SELECTED_WRIKE_USER_IDS } from "@/lib/wrike/selected-users";
import { SELECTED_WRIKE_WORKFLOW } from "@/lib/wrike/selected-workflow";
import type { WrikeSpace, WrikeTimelogCategory, WrikeUser, WrikeWorkflow, WrikeWorkflowStatus } from "@/lib/wrike/types";

type AdminClient = ReturnType<typeof createAdminClient>;
const USER_REFRESH_MS = 24 * 60 * 60 * 1000;

export type WrikeUserReferenceRow = {
  id?: string;
  wrike_id: string;
  display_name: string;
  email: string | null;
  avatar_url: string | null;
  synced_at?: string | null;
  is_active?: boolean;
  is_unresolved?: boolean;
  raw_data?: Record<string, unknown> | null;
};
export type WrikeCategoryReferenceRow = { wrike_id: string; title: string; synced_at?: string | null; is_unresolved?: boolean };
export type WrikeStatusReferenceRow = {
  wrike_id: string;
  title: string;
  workflow_id?: string;
  color?: string | null;
  dashboard_classification?: "active" | "completed" | "stalled_or_canceled" | null;
  synced_at?: string | null;
  is_unresolved?: boolean;
};
export type ResolvedWrikeUser = {
  wrikeUserId: string;
  fullName: string;
  email: string | null;
  avatarUrl: string | null;
  resolved: boolean;
  fallbackSource: "wrike" | "configured" | "historical" | "raw_id";
  reference: ResolvedWrikeReference<{ displayName: string; email: string | null; avatarUrl: string | null }>;
};
export type ResolvedTimelogCategory = { wrikeCategoryId: string; name: string; resolved: boolean; reference: ResolvedWrikeReference<{ name: string }> };
export type ResolvedTaskStatus = {
  wrikeCustomStatusId: string | null;
  name: string;
  color: string | null;
  workflowId: string | null;
  classification: "active" | "completed" | "stalled_or_canceled" | null;
  resolved: boolean;
  reference: ResolvedWrikeReference<{ name: string; color: string | null; workflowId: string | null }>;
};
export type ReferenceFailure = { operation: "workflow" | "space" | "user" | "timelog_categories" | "database"; wrikeId: string | null; status: number | null; message: string };
export type UserNameMismatch = { wrikeUserId: string; expectedName: string; returnedName: string };

export type ReferenceSyncDiagnostics = {
  workflow: { requests: number; selectedId: string; found: boolean; workflowsReceived: number; workflowsUpserted: number; statusesReceived: number; statusesUpserted: number; failed: boolean; durationMs: number };
  spaces: { requests: number; received: number; upserted: number; paginationObserved: boolean; failed: boolean; durationMs: number };
  users: {
    configured: number;
    encountered: number;
    requested: number;
    received: number;
    upserted: number;
    fallbackCreated: number;
    placeholderCreated: number;
    reusedFresh: number;
    failed: number;
    failedIds: string[];
    nameMismatches: UserNameMismatch[];
    durationMs: number;
  };
  categories: { requests: number; received: number; upserted: number; paginationObserved: boolean; failed: boolean; durationMs: number };
  resolution?: {
    taskResponsibleIds: number;
    taskResponsibleResolved: number;
    taskResponsibleUnresolved: number;
    timelogUsersResolved: number;
    timelogUsersUnresolved: number;
    timelogCategoriesResolved: number;
    timelogCategoriesUnresolved: number;
    taskStatusesResolved: number;
    taskStatusesUnresolved: number;
  };
  failures: ReferenceFailure[];
};

export function wrikeUserPath(userId: string) {
  if (!/^[A-Z0-9]{8}$/.test(userId)) throw new Error(`Invalid Wrike user ID: ${userId}.`);
  return `/users/${encodeURIComponent(userId)}`;
}

export function parseWrikeUserResponse(value: unknown, requestedId: string): WrikeUser {
  if (!value || typeof value !== "object") throw new Error(`Wrike user ${requestedId} returned an invalid response.`);
  const data = (value as { data?: unknown }).data;
  if (!Array.isArray(data)) throw new Error(`Wrike user ${requestedId} response did not contain a data array.`);
  const user = data.find((item): item is WrikeUser => Boolean(item && typeof item === "object" && (item as { id?: unknown }).id === requestedId));
  if (!user) throw new Error(`Wrike user response did not contain requested ID ${requestedId}.`);
  return user;
}

export function parseTimelogCategoryResponse(value: unknown): { data: WrikeTimelogCategory[]; nextPageToken?: string } {
  if (!value || typeof value !== "object" || !Array.isArray((value as { data?: unknown }).data)) throw new Error("Wrike timelog categories returned an invalid response.");
  const response = value as { data: unknown[]; nextPageToken?: unknown };
  const data = response.data.filter((item): item is WrikeTimelogCategory => Boolean(item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string"));
  if (data.length !== response.data.length) throw new Error("Wrike timelog categories contained an invalid record.");
  return { data, nextPageToken: typeof response.nextPageToken === "string" && response.nextPageToken ? response.nextPageToken : undefined };
}

export function parseWrikeWorkflowsResponse(value: unknown): WrikeWorkflow[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { data?: unknown }).data)) throw new Error("Wrike workflows returned an invalid response.");
  const workflows = (value as { data: unknown[] }).data.filter((item): item is WrikeWorkflow => Boolean(item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string"));
  if (workflows.length !== (value as { data: unknown[] }).data.length) throw new Error("Wrike workflows contained an invalid record.");
  for (const workflow of workflows) if (workflow.customStatuses != null && !Array.isArray(workflow.customStatuses)) throw new Error(`Wrike workflow ${workflow.id} returned invalid custom statuses.`);
  return workflows;
}

export function parseWrikeSpacesResponse(value: unknown): { data: WrikeSpace[]; nextPageToken?: string } {
  if (!value || typeof value !== "object" || !Array.isArray((value as { data?: unknown }).data)) throw new Error("Wrike spaces returned an invalid response.");
  const response = value as { data: unknown[]; nextPageToken?: unknown };
  const data = response.data.filter((item): item is WrikeSpace => Boolean(item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string" && typeof (item as { title?: unknown }).title === "string"));
  if (data.length !== response.data.length) throw new Error("Wrike spaces contained an invalid record.");
  return { data, nextPageToken: typeof response.nextPageToken === "string" && response.nextPageToken ? response.nextPageToken : undefined };
}

export function selectConfiguredWorkflow(value: unknown): WrikeWorkflow {
  const workflow = parseWrikeWorkflowsResponse(value).find((item) => item.id === SELECTED_WRIKE_WORKFLOW.wrikeWorkflowId);
  if (!workflow) throw new Error(`Wrike workflow ${SELECTED_WRIKE_WORKFLOW.wrikeWorkflowId} (${SELECTED_WRIKE_WORKFLOW.expectedName}) was not present in the account workflow response.`);
  return workflow;
}

const normalizedName = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
const fullName = (user: WrikeUser) => [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
const failureFor = (operation: ReferenceFailure["operation"], wrikeId: string | null, error: unknown): ReferenceFailure => ({
  operation,
  wrikeId,
  status: error instanceof WrikeApiError ? error.status : null,
  message: (error instanceof Error ? error.message : "Unknown Wrike reference-data error").slice(0, 500)
});

export function automaticStatusClassification(status: Pick<WrikeWorkflowStatus, "name" | "group">) {
  const group = (status.group ?? "").toLocaleLowerCase();
  if (group === "cancelled" || group === "canceled") return "stalled_or_canceled" as const;
  if (group === "completed") return "completed" as const;
  if (group === "active" || group === "deferred") return "active" as const;
  return null;
}

export function shouldRefreshWrikeUser(row: Pick<WrikeUserReferenceRow, "is_unresolved" | "synced_at"> | undefined, now = new Date()) {
  if (!row || row.is_unresolved || !row.synced_at) return true;
  return new Date(row.synced_at).getTime() < now.getTime() - USER_REFRESH_MS;
}

export function resolveResponsibleUsers(ids: readonly string[], users: readonly WrikeUserReferenceRow[]): ResolvedWrikeUser[] {
  const byId = new Map(users.map((user) => [user.wrike_id, user]));
  return ids.map((wrikeUserId) => {
    const user = byId.get(wrikeUserId);
    const configured = SELECTED_WRIKE_USER_BY_ID.get(wrikeUserId);
    if (user && !user.is_unresolved && user.display_name !== wrikeUserId) {
      const fallbackSource = user.is_active === false ? "historical" as const : user.synced_at ? "wrike" as const : "configured" as const;
      const source = fallbackSource === "historical" ? "historical" as const : fallbackSource === "configured" ? "configured_fallback" as const : "database" as const;
      const value = { displayName: user.display_name, email: user.email, avatarUrl: user.avatar_url };
      return { wrikeUserId, fullName: user.display_name, email: user.email, avatarUrl: user.avatar_url, resolved: true, fallbackSource, reference: resolvedWrikeReference(wrikeUserId, value, { source, lastResolvedAt: user.synced_at }) };
    }
    if (configured) {
      const value = { displayName: configured.expectedName, email: null, avatarUrl: null };
      return { wrikeUserId, fullName: configured.expectedName, email: null, avatarUrl: null, resolved: true, fallbackSource: "configured", reference: resolvedWrikeReference(wrikeUserId, value, { source: "configured_fallback" }) };
    }
    return { wrikeUserId, fullName: wrikeUserId, email: null, avatarUrl: null, resolved: false, fallbackSource: "raw_id", reference: unresolvedWrikeReference(wrikeUserId) };
  });
}

export function resolveTimelogCategory(wrikeCategoryId: string | null | undefined, categories: readonly WrikeCategoryReferenceRow[]): ResolvedTimelogCategory | null {
  if (!wrikeCategoryId) return null;
  const category = categories.find((item) => item.wrike_id === wrikeCategoryId && !item.is_unresolved);
  const reference = category
    ? resolvedWrikeReference(wrikeCategoryId, { name: category.title }, { lastResolvedAt: category.synced_at })
    : unresolvedWrikeReference<{ name: string }>(wrikeCategoryId);
  return { wrikeCategoryId, name: category?.title ?? wrikeCategoryId, resolved: Boolean(category), reference };
}

export function resolveTaskStatus(customStatusId: string | null | undefined, baseStatus: string, statuses: readonly WrikeStatusReferenceRow[]): ResolvedTaskStatus {
  if (!customStatusId) {
    const value = { name: baseStatus, color: null, workflowId: null };
    return { wrikeCustomStatusId: null, name: baseStatus, color: null, workflowId: null, classification: null, resolved: true, reference: resolvedWrikeReference(baseStatus, value, { source: "database" }) };
  }
  const status = statuses.find((item) => item.wrike_id === customStatusId && !item.is_unresolved);
  const value = status ? { name: status.title, color: status.color ?? null, workflowId: status.workflow_id ?? null } : null;
  const reference = value ? resolvedWrikeReference(customStatusId, value, { lastResolvedAt: status?.synced_at }) : unresolvedWrikeReference<typeof value extends null ? never : NonNullable<typeof value>>(customStatusId);
  return {
    wrikeCustomStatusId: customStatusId,
    name: status?.title ?? customStatusId,
    color: status?.color ?? null,
    workflowId: status?.workflow_id ?? null,
    classification: status?.dashboard_classification ?? null,
    resolved: Boolean(status),
    reference: reference as ResolvedWrikeReference<{ name: string; color: string | null; workflowId: string | null }>
  };
}

export async function fetchWrikeUsers(client: WrikeClient, userIds: readonly string[]) {
  const failures: ReferenceFailure[] = [];
  const fetched = await mapWithConcurrency([...new Set(userIds)], 4, async (userId) => {
    try {
      const response = await client.request<unknown>(wrikeUserPath(userId));
      return { userId, user: parseWrikeUserResponse(response, userId) };
    } catch (error) {
      const failure = failureFor("user", userId, error);
      failures.push(failure);
      logWrikeEvent("warn", "wrike_user_reference_failed", failure);
      return null;
    }
  });
  return { retrieved: fetched.filter((item): item is NonNullable<typeof item> => Boolean(item)), failures };
}

export async function fetchSelectedWrikeUsers(client: WrikeClient) {
  const result = await fetchWrikeUsers(client, SELECTED_WRIKE_USER_IDS);
  return {
    retrieved: result.retrieved.map(({ userId, user }) => ({ configured: SELECTED_WRIKE_USER_BY_ID.get(userId)!, user })),
    failures: result.failures
  };
}

export async function fetchWrikeTimelogCategories(client: WrikeClient) {
  const failures: ReferenceFailure[] = [];
  const categories: WrikeTimelogCategory[] = [];
  const seenTokens = new Set<string>();
  let nextPageToken: string | undefined;
  let requests = 0;
  let paginationObserved = false;
  let failed = false;
  do {
    try {
      const path = nextPageToken ? `/timelog_categories?nextPageToken=${encodeURIComponent(nextPageToken)}` : "/timelog_categories";
      requests++;
      const page = parseTimelogCategoryResponse(await client.request<unknown>(path));
      categories.push(...page.data);
      nextPageToken = page.nextPageToken;
      if (nextPageToken) paginationObserved = true;
      if (nextPageToken && seenTokens.has(nextPageToken)) throw new Error("Wrike timelog category pagination repeated a token.");
      if (nextPageToken) seenTokens.add(nextPageToken);
    } catch (error) {
      const failure = failureFor("timelog_categories", null, error);
      failures.push(failure);
      logWrikeEvent("warn", "wrike_timelog_categories_failed", failure);
      failed = true;
      nextPageToken = undefined;
    }
  } while (nextPageToken && seenTokens.size < 100);
  return { categories: [...new Map(categories.map((category) => [category.id, category])).values()], requests, paginationObserved, failed, failures };
}

export async function fetchWrikeSpaces(client: WrikeClient) {
  const failures: ReferenceFailure[] = [];
  const spaces: WrikeSpace[] = [];
  const seenTokens = new Set<string>();
  let nextPageToken: string | undefined;
  let requests = 0;
  let paginationObserved = false;
  let failed = false;
  do {
    try {
      const params = new URLSearchParams({ withArchived: "true" });
      if (nextPageToken) params.set("nextPageToken", nextPageToken);
      requests++;
      const page = parseWrikeSpacesResponse(await client.request<unknown>(`/spaces?${params}`));
      spaces.push(...page.data);
      nextPageToken = page.nextPageToken;
      if (nextPageToken) paginationObserved = true;
      if (nextPageToken && seenTokens.has(nextPageToken)) throw new Error("Wrike space pagination repeated a token.");
      if (nextPageToken) seenTokens.add(nextPageToken);
    } catch (error) {
      const failure = failureFor("space", null, error);
      failures.push(failure);
      logWrikeEvent("warn", "wrike_spaces_failed", failure);
      failed = true;
      nextPageToken = undefined;
    }
  } while (nextPageToken && seenTokens.size < 100);
  return { spaces: [...new Map(spaces.map((space) => [space.id, space])).values()], requests, paginationObserved, failed, failures };
}

export async function syncEncounteredWrikeUsers(
  db: AdminClient,
  organizationId: string,
  accountId: string | null,
  client: WrikeClient,
  encounteredIds: readonly string[],
  now = new Date()
) {
  const startedAt = Date.now();
  const failures: ReferenceFailure[] = [];
  const nameMismatches: UserNameMismatch[] = [];
  const ids = [...new Set([...SELECTED_WRIKE_USER_IDS, ...encounteredIds])];
  const nowIso = now.toISOString();
  const { data: existing, error: existingError } = ids.length
    ? await db.from("wrike_users").select("id,wrike_id,display_name,email,avatar_url,synced_at,is_active,is_unresolved,raw_data").eq("organization_id", organizationId).in("wrike_id", ids)
    : { data: [], error: null };
  if (existingError) failures.push(failureFor("database", null, existingError));
  const existingById = new Map((existing ?? []).map((row) => [row.wrike_id, row as WrikeUserReferenceRow]));

  const fallbackRows = SELECTED_WRIKE_USERS.filter((configured) => !existingById.has(configured.wrikeUserId)).map((configured) => ({
    organization_id: organizationId,
    wrike_id: configured.wrikeUserId,
    display_name: configured.expectedName,
    raw_data: { referenceSource: "configured_fallback" },
    is_active: true,
    is_unresolved: false,
    updated_at: nowIso
  }));
  let fallbackCreated = 0;
  if (fallbackRows.length) {
    const { error } = await db.from("wrike_users").upsert(fallbackRows, { onConflict: "organization_id,wrike_id", ignoreDuplicates: true });
    if (error) failures.push(failureFor("database", null, error));
    else fallbackCreated = fallbackRows.length;
  }

  const requestedIds = ids.filter((id) => shouldRefreshWrikeUser(existingById.get(id), now));
  const fetchResult = await fetchWrikeUsers(client, requestedIds);
  failures.push(...fetchResult.failures);
  let upserted = 0;
  if (fetchResult.retrieved.length) {
    const rows = fetchResult.retrieved.map(({ userId, user }) => {
      const configured = SELECTED_WRIKE_USER_BY_ID.get(userId);
      const accountProfile = user.profiles?.find((profile) => profile.accountId === accountId) ?? user.profiles?.[0];
      const returnedName = fullName(user);
      if (configured && returnedName && normalizedName(returnedName) !== normalizedName(configured.expectedName)) {
        const mismatch = { wrikeUserId: userId, expectedName: configured.expectedName, returnedName };
        nameMismatches.push(mismatch);
        logWrikeEvent("warn", "wrike_user_name_mismatch", mismatch);
      }
      return {
        organization_id: organizationId,
        wrike_id: user.id,
        first_name: user.firstName ?? null,
        last_name: user.lastName ?? null,
        display_name: returnedName || configured?.expectedName || user.id,
        email: user.primaryEmail ?? accountProfile?.email ?? null,
        title: user.title ?? null,
        user_type: accountProfile?.role ?? null,
        avatar_url: user.avatarUrl ?? null,
        timezone: user.timezone ?? null,
        locale: user.locale ?? null,
        profiles: user.profiles ?? [],
        raw_data: user,
        is_active: accountProfile?.active ?? !user.deleted,
        is_unresolved: false,
        deleted_at: user.deleted ? nowIso : null,
        synced_at: nowIso,
        last_resolution_attempt_at: nowIso,
        last_resolution_error: null,
        updated_at: nowIso
      };
    });
    const { error } = await db.from("wrike_users").upsert(rows, { onConflict: "organization_id,wrike_id" });
    if (error) failures.push(failureFor("database", null, error));
    else upserted = rows.length;
  }

  let placeholderCreated = 0;
  for (const failure of fetchResult.failures) {
    if (!failure.wrikeId) continue;
    const existingRow = existingById.get(failure.wrikeId);
    if (existingRow || SELECTED_WRIKE_USER_BY_ID.has(failure.wrikeId)) {
      await db.from("wrike_users").update({ last_resolution_attempt_at: nowIso, last_resolution_error: failure.message, updated_at: nowIso }).eq("organization_id", organizationId).eq("wrike_id", failure.wrikeId);
      continue;
    }
    const { error } = await db.from("wrike_users").upsert({
      organization_id: organizationId,
      wrike_id: failure.wrikeId,
      display_name: failure.wrikeId,
      raw_data: { referenceSource: "unresolved_placeholder" },
      is_active: true,
      is_unresolved: true,
      last_resolution_attempt_at: nowIso,
      last_resolution_error: failure.message,
      updated_at: nowIso
    }, { onConflict: "organization_id,wrike_id", ignoreDuplicates: true });
    if (error) failures.push(failureFor("database", failure.wrikeId, error));
    else placeholderCreated++;
  }

  const { data: userRows, error: rowsError } = await db.from("wrike_users").select("id,wrike_id,display_name,email,avatar_url,synced_at,is_active,is_unresolved,raw_data").eq("organization_id", organizationId);
  if (rowsError) failures.push(failureFor("database", null, rowsError));
  return {
    rows: (userRows ?? []) as WrikeUserReferenceRow[],
    diagnostics: {
      configured: SELECTED_WRIKE_USERS.length,
      encountered: ids.length,
      requested: requestedIds.length,
      received: fetchResult.retrieved.length,
      upserted,
      fallbackCreated,
      placeholderCreated,
      reusedFresh: ids.length - requestedIds.length,
      failed: fetchResult.failures.length,
      failedIds: fetchResult.failures.flatMap((failure) => failure.wrikeId ? [failure.wrikeId] : []),
      nameMismatches,
      durationMs: Date.now() - startedAt
    },
    failures
  };
}

export async function syncWrikeReferenceData(db: AdminClient, organizationId: string, accountId: string | null, client: WrikeClient): Promise<{
  diagnostics: ReferenceSyncDiagnostics;
  userRows: WrikeUserReferenceRow[];
  categoryRows: WrikeCategoryReferenceRow[];
  statusRows: WrikeStatusReferenceRow[];
  spaces: WrikeSpace[];
}> {
  const failures: ReferenceFailure[] = [];
  const now = new Date();
  const nowIso = now.toISOString();

  let workflowFound = false;
  let workflowsReceived = 0;
  let workflowsUpserted = 0;
  let statusesReceived = 0;
  let statusesUpserted = 0;
  let workflowFailed = false;
  const workflowStartedAt = Date.now();
  try {
    const workflows = parseWrikeWorkflowsResponse(await client.request<unknown>("/workflows"));
    workflowsReceived = workflows.length;
    workflowFound = workflows.some((workflow) => workflow.id === SELECTED_WRIKE_WORKFLOW.wrikeWorkflowId);
    const workflowRows = workflows.map((workflow) => ({
      organization_id: organizationId,
      wrike_id: workflow.id,
      name: workflow.name ?? workflow.id,
      description: workflow.description ?? null,
      hidden: workflow.hidden ?? false,
      workflow_type: typeof workflow.type === "string" ? workflow.type : null,
      workflow_status: typeof workflow.status === "string" ? workflow.status : null,
      is_unresolved: false,
      last_resolution_error: null,
      raw_data: workflow,
      synced_at: nowIso,
      updated_at: nowIso
    }));
    if (workflowRows.length) {
      const { error } = await db.from("wrike_workflows").upsert(workflowRows, { onConflict: "organization_id,wrike_id" });
      if (error) failures.push(failureFor("database", null, error)); else workflowsUpserted = workflowRows.length;
    }
    const { data: savedWorkflows, error: savedWorkflowError } = await db.from("wrike_workflows").select("id,wrike_id").eq("organization_id", organizationId);
    if (savedWorkflowError) failures.push(failureFor("database", null, savedWorkflowError));
    const workflowRecordIdByWrikeId = new Map((savedWorkflows ?? []).map((workflow) => [workflow.wrike_id, workflow.id]));
    const statusDefinitions = workflows.flatMap((workflow) => (workflow.customStatuses ?? []).map((status, index) => ({ workflow, status, index })));
    statusesReceived = statusDefinitions.length;
    const { data: existingStatuses } = statusDefinitions.length
      ? await db.from("wrike_workflow_statuses").select("wrike_id,dashboard_classification,classification_source,classification_updated_by,classification_updated_at").eq("organization_id", organizationId).in("wrike_id", statusDefinitions.map(({ status }) => status.id))
      : { data: [] };
    const existingById = new Map((existingStatuses ?? []).map((status) => [status.wrike_id, status]));
    const statusRows = statusDefinitions.map(({ workflow, status, index }) => {
      const existing = existingById.get(status.id);
      const manual = existing?.classification_source === "manual";
      return {
        organization_id: organizationId,
        wrike_id: status.id,
        workflow_id: workflow.id,
        workflow_record_id: workflowRecordIdByWrikeId.get(workflow.id) ?? null,
        title: status.name,
        status_group: status.group ?? null,
        standard: status.standard ?? null,
        hidden: status.hidden ?? null,
        color: status.color ?? null,
        display_order: typeof status.order === "number" ? status.order : index,
        dashboard_classification: manual ? existing.dashboard_classification : automaticStatusClassification(status),
        classification_source: manual ? "manual" : automaticStatusClassification(status) ? "automatic" : null,
        classification_updated_by: manual ? existing.classification_updated_by : null,
        classification_updated_at: manual ? existing.classification_updated_at : nowIso,
        is_unresolved: false,
        last_resolution_error: null,
        raw_data: status,
        synced_at: nowIso,
        updated_at: nowIso
      };
    });
    if (statusRows.length) {
      const { error } = await db.from("wrike_workflow_statuses").upsert(statusRows, { onConflict: "organization_id,wrike_id" });
      if (error) failures.push(failureFor("database", null, error)); else statusesUpserted = statusRows.length;
    }
    if (!workflowFound) {
      const missing = new Error(`Wrike workflow ${SELECTED_WRIKE_WORKFLOW.wrikeWorkflowId} (${SELECTED_WRIKE_WORKFLOW.expectedName}) was not present in the account workflow response.`);
      failures.push(failureFor("workflow", SELECTED_WRIKE_WORKFLOW.wrikeWorkflowId, missing));
    }
  } catch (error) {
    const failure = failureFor("workflow", SELECTED_WRIKE_WORKFLOW.wrikeWorkflowId, error);
    failures.push(failure);
    workflowFailed = true;
    logWrikeEvent("warn", "wrike_workflow_reference_failed", failure);
  }
  const workflowDurationMs = Date.now() - workflowStartedAt;

  const spaceStartedAt = Date.now();
  const spaceFetch = await fetchWrikeSpaces(client);
  failures.push(...spaceFetch.failures);
  let spacesUpserted = 0;
  if (spaceFetch.spaces.length) {
    const { error } = await db.from("wrike_spaces").upsert(spaceFetch.spaces.map((space) => ({
      organization_id: organizationId,
      wrike_id: space.id,
      title: space.title,
      raw_data: space,
      is_unresolved: false,
      synced_at: nowIso,
      last_resolution_error: null,
      updated_at: nowIso
    })), { onConflict: "organization_id,wrike_id" });
    if (error) failures.push(failureFor("database", null, error)); else spacesUpserted = spaceFetch.spaces.length;
  }
  const spaceDurationMs = Date.now() - spaceStartedAt;

  const userSync = await syncEncounteredWrikeUsers(db, organizationId, accountId, client, SELECTED_WRIKE_USER_IDS, now);
  failures.push(...userSync.failures);

  const categoriesStartedAt = Date.now();
  const categoryFetch = await fetchWrikeTimelogCategories(client);
  failures.push(...categoryFetch.failures);
  let categoriesUpserted = 0;
  if (categoryFetch.categories.length) {
    const { error } = await db.from("wrike_timelog_categories").upsert(categoryFetch.categories.map((category) => ({
      organization_id: organizationId,
      wrike_id: category.id,
      title: category.name ?? category.title ?? category.id,
      hidden: category.hidden ?? false,
      sort_order: category.order ?? null,
      raw_data: category,
      is_unresolved: false,
      last_resolution_error: null,
      synced_at: nowIso,
      updated_at: nowIso
    })), { onConflict: "organization_id,wrike_id" });
    if (error) failures.push(failureFor("database", null, error)); else categoriesUpserted = categoryFetch.categories.length;
  }
  const categoriesDurationMs = Date.now() - categoriesStartedAt;

  const [{ data: categoryRows, error: categoryRowsError }, { data: statusRows, error: statusRowsError }] = await Promise.all([
    db.from("wrike_timelog_categories").select("wrike_id,title,synced_at,is_unresolved").eq("organization_id", organizationId),
    db.from("wrike_workflow_statuses").select("wrike_id,title,workflow_id,color,dashboard_classification,synced_at,is_unresolved").eq("organization_id", organizationId)
  ]);
  if (categoryRowsError) failures.push(failureFor("database", null, categoryRowsError));
  if (statusRowsError) failures.push(failureFor("database", null, statusRowsError));
  return {
    diagnostics: {
      workflow: { requests: 1, selectedId: SELECTED_WRIKE_WORKFLOW.wrikeWorkflowId, found: workflowFound, workflowsReceived, workflowsUpserted, statusesReceived, statusesUpserted, failed: workflowFailed, durationMs: workflowDurationMs },
      spaces: { requests: spaceFetch.requests, received: spaceFetch.spaces.length, upserted: spacesUpserted, paginationObserved: spaceFetch.paginationObserved, failed: spaceFetch.failed, durationMs: spaceDurationMs },
      users: userSync.diagnostics,
      categories: { requests: categoryFetch.requests, received: categoryFetch.categories.length, upserted: categoriesUpserted, paginationObserved: categoryFetch.paginationObserved, failed: categoryFetch.failed, durationMs: categoriesDurationMs },
      failures
    },
    userRows: userSync.rows,
    categoryRows: (categoryRows ?? []) as WrikeCategoryReferenceRow[],
    statusRows: (statusRows ?? []) as WrikeStatusReferenceRow[],
    spaces: spaceFetch.spaces
  };
}
