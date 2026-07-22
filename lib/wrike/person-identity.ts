import type { createAdminClient } from "@/lib/supabase/admin";
import { logWrikeEvent, type WrikeClient } from "@/lib/wrike/client";
import { mapWithConcurrency } from "@/lib/wrike/concurrency";
import type { EnrichedTaskMetadata } from "@/lib/wrike/metadata";
import type { WrikeTask, WrikeUserProfile } from "@/lib/wrike/types";

type AdminClient = ReturnType<typeof createAdminClient>;

export type IdentityVerificationSource = "wrike_contact" | "email_match" | "task_name" | "configured_fallback" | "manual_mapping" | "unresolved";
export type IdentityVerificationStatus = "unverified" | "verified" | "ambiguous" | "not_found" | "failed";
export type TaskPersonIdentity = { displayName: string; email: string | null; sourceTaskIds: string[] };
export type WrikeContact = {
  id: string;
  firstName?: string;
  lastName?: string;
  primaryEmail?: string;
  type?: "Group" | "Asset" | "Person" | "Robot";
  active?: boolean;
  deleted?: boolean;
  avatarUrl?: string;
  profiles?: WrikeUserProfile[];
  [key: string]: unknown;
};
export type StoredPersonIdentity = {
  identity_key: string;
  display_name: string;
  normalized_name: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  wrike_contact_id: string | null;
  contact_active: boolean | null;
  contact_deleted: boolean | null;
  is_displayable: boolean;
  is_verified: boolean;
  verification_source: IdentityVerificationSource;
  verification_status: IdentityVerificationStatus;
  candidate_contacts: unknown[];
  source_task_ids: string[];
  verification_attempt_count: number;
  last_verification_attempt_at: string | null;
  next_verification_attempt_at: string | null;
  last_verified_at: string | null;
  last_error: string | null;
  raw_data?: Record<string, unknown>;
};
export type PersonIdentityMatch = {
  status: "verified" | "ambiguous" | "not_found";
  source: "email_match" | "wrike_contact" | "task_name";
  contact: WrikeContact | null;
  candidates: WrikeContact[];
};

const WRIKE_CONTACT_ID = /^[A-Z0-9]{8}$/i;
const OLD_UNRESOLVED_PREFIX = /^(?:(?:unverified|unresolved)\s+wrike\s+user|unresolved\s+user)\s+/i;
const IDENTITY_SELECT = "identity_key,display_name,normalized_name,first_name,last_name,email,wrike_contact_id,contact_active,contact_deleted,is_displayable,is_verified,verification_source,verification_status,candidate_contacts,source_task_ids,verification_attempt_count,last_verification_attempt_at,next_verification_attempt_at,last_verified_at,last_error,raw_data";
export const PERSON_IDENTITY_RETRY_MS = { ambiguous: 24 * 60 * 60 * 1000, not_found: 7 * 24 * 60 * 60 * 1000, failed: 60 * 60 * 1000 } as const;

export function normalizePersonName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function cleanPersonDisplayName(value: string) {
  return value.trim().replace(/\s+/g, " ").replace(OLD_UNRESOLVED_PREFIX, "").trim();
}

export function isReadablePersonName(value: string) {
  const name = cleanPersonDisplayName(value);
  return Boolean(name) && !WRIKE_CONTACT_ID.test(name) && !/^name unavailable$/i.test(name);
}

export function isVerifiablePersonName(value: string) {
  return isReadablePersonName(value) && normalizePersonName(value).split(" ").length >= 2;
}

export function personIdentityKey(identity: Pick<TaskPersonIdentity, "displayName" | "email">) {
  return identity.email?.trim() ? `email:${identity.email.trim().toLocaleLowerCase()}` : `name:${normalizePersonName(identity.displayName)}`;
}

export function wrikeContactName(contact: WrikeContact) {
  return [contact.firstName, contact.lastName].filter((value): value is string => typeof value === "string" && Boolean(value.trim())).join(" ").trim();
}

export function wrikeContactEmails(contact: WrikeContact) {
  return [...new Set([contact.primaryEmail, ...(contact.profiles ?? []).map((profile) => profile.email)]
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .map((value) => value.trim().toLocaleLowerCase()))];
}

function eligiblePeople(contacts: readonly WrikeContact[]) {
  return contacts.filter((contact) => contact.type == null || contact.type === "Person")
    .filter((contact) => contact.active !== false && !contact.deleted);
}

export function matchPersonIdentity(identity: Pick<TaskPersonIdentity, "displayName" | "email">, contacts: readonly WrikeContact[]): PersonIdentityMatch {
  const people = eligiblePeople(contacts);
  const email = identity.email?.trim().toLocaleLowerCase();
  if (email) {
    const emailMatches = people.filter((contact) => wrikeContactEmails(contact).includes(email));
    if (emailMatches.length === 1) return { status: "verified", source: "email_match", contact: emailMatches[0], candidates: emailMatches };
    if (emailMatches.length > 1) return { status: "ambiguous", source: "email_match", contact: null, candidates: emailMatches };
  }
  const normalizedName = normalizePersonName(identity.displayName);
  const nameMatches = people.filter((contact) => normalizePersonName(wrikeContactName(contact)) === normalizedName);
  if (nameMatches.length === 1) return { status: "verified", source: "wrike_contact", contact: nameMatches[0], candidates: nameMatches };
  if (nameMatches.length > 1) return { status: "ambiguous", source: "task_name", contact: null, candidates: nameMatches };
  return { status: "not_found", source: "task_name", contact: null, candidates: [] };
}

export function contactsQueryPath(filter: { name?: string; emails?: readonly string[] }) {
  const parts: string[] = [];
  if (filter.name) parts.push(`name=${encodeURIComponent(cleanPersonDisplayName(filter.name))}`);
  if (filter.emails?.length) parts.push(`emails=${encodeURIComponent(JSON.stringify([...new Set(filter.emails.map((email) => email.trim().toLocaleLowerCase()))].slice(0, 100)))}`);
  parts.push(`types=${encodeURIComponent(JSON.stringify(["Person"]))}`, "active=true");
  return `/contacts?${parts.join("&")}`;
}

export function wrikeContactNameSearchUrl(apiBaseUrl: string, fullName: string) {
  return `${apiBaseUrl.replace(/\/$/, "")}/contacts?name=${encodeURIComponent(cleanPersonDisplayName(fullName))}`;
}

export function personIdentityDue(identity: Pick<StoredPersonIdentity, "is_displayable" | "is_verified" | "verification_source" | "next_verification_attempt_at">, now = new Date()) {
  if (!identity.is_displayable || identity.is_verified || identity.verification_source === "manual_mapping") return false;
  return !identity.next_verification_attempt_at || Date.parse(identity.next_verification_attempt_at) <= now.getTime();
}

function nextAttemptAt(status: IdentityVerificationStatus, now: Date) {
  const delay = status === "ambiguous" ? PERSON_IDENTITY_RETRY_MS.ambiguous : status === "not_found" ? PERSON_IDENTITY_RETRY_MS.not_found : status === "failed" ? PERSON_IDENTITY_RETRY_MS.failed : null;
  return delay == null ? null : new Date(now.getTime() + delay).toISOString();
}

function candidateSummary(contact: WrikeContact) {
  return { id: contact.id, displayName: wrikeContactName(contact) || contact.id, emails: wrikeContactEmails(contact) };
}

export function mergePersonIdentity(existing: StoredPersonIdentity | undefined, incoming: StoredPersonIdentity): StoredPersonIdentity {
  if (!existing?.is_verified) return { ...incoming, source_task_ids: [...new Set([...(existing?.source_task_ids ?? []), ...incoming.source_task_ids])] };
  return {
    ...incoming,
    display_name: existing.display_name,
    normalized_name: existing.normalized_name,
    first_name: existing.first_name,
    last_name: existing.last_name,
    email: existing.email,
    wrike_contact_id: existing.wrike_contact_id,
    contact_active: existing.contact_active,
    contact_deleted: existing.contact_deleted,
    is_displayable: existing.is_displayable,
    is_verified: true,
    verification_source: existing.verification_source,
    verification_status: "verified",
    candidate_contacts: existing.candidate_contacts,
    source_task_ids: [...new Set([...existing.source_task_ids, ...incoming.source_task_ids])],
    verification_attempt_count: existing.verification_attempt_count,
    next_verification_attempt_at: null,
    last_verified_at: existing.last_verified_at,
    last_error: null,
    raw_data: existing.raw_data ?? incoming.raw_data
  };
}

function scalarIdentityCandidates(value: unknown): { displayName: string; email: string | null }[] {
  if (Array.isArray(value)) return value.flatMap(scalarIdentityCandidates);
  if (typeof value === "string") {
    const cleaned = cleanPersonDisplayName(value);
    return isReadablePersonName(cleaned) ? [{ displayName: cleaned, email: null }] : [];
  }
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const name = [record.displayName, record.name, [record.firstName, record.lastName].filter((item) => typeof item === "string").join(" ")]
    .find((item): item is string => typeof item === "string" && isReadablePersonName(item));
  const email = [record.email, record.primaryEmail].find((item): item is string => typeof item === "string" && item.includes("@")) ?? null;
  if (name) return [{ displayName: cleanPersonDisplayName(name), email: email?.trim().toLocaleLowerCase() ?? null }];
  return Object.values(record).flatMap(scalarIdentityCandidates);
}

export function taskPersonIdentityObservations(tasks: readonly WrikeTask[], enrichedByTaskId: ReadonlyMap<string, EnrichedTaskMetadata>) {
  const grouped = new Map<string, TaskPersonIdentity>();
  for (const task of tasks) {
    const contactFields = (enrichedByTaskId.get(task.id)?.customFields ?? []).filter((field) => field.type?.trim().toLocaleLowerCase() === "contacts");
    for (const identity of contactFields.flatMap((field) => scalarIdentityCandidates(field.rawValue))) {
      const key = personIdentityKey(identity);
      const existing = grouped.get(key);
      if (existing) existing.sourceTaskIds = [...new Set([...existing.sourceTaskIds, task.id])];
      else grouped.set(key, { ...identity, sourceTaskIds: [task.id] });
    }
  }
  return [...grouped.values()];
}

export async function processPendingPersonIdentities(db: AdminClient, organizationId: string, client: WrikeClient, observations: readonly TaskPersonIdentity[] = [], now = new Date(), batchSize = 100) {
  const nowIso = now.toISOString();
  const observedByKey = new Map<string, TaskPersonIdentity>();
  for (const identity of observations) {
    const cleaned = { ...identity, displayName: cleanPersonDisplayName(identity.displayName) };
    const key = personIdentityKey(cleaned);
    const existing = observedByKey.get(key);
    if (existing) existing.sourceTaskIds = [...new Set([...existing.sourceTaskIds, ...cleaned.sourceTaskIds])];
    else observedByKey.set(key, cleaned);
  }
  const keys = [...observedByKey.keys()];
  const observedRequest = keys.length
    ? db.from("wrike_person_identities").select(IDENTITY_SELECT).eq("organization_id", organizationId).in("identity_key", keys)
    : Promise.resolve({ data: [], error: null });
  const pendingRequest = db.from("wrike_person_identities").select(IDENTITY_SELECT).eq("organization_id", organizationId)
    .eq("is_displayable", true).eq("is_verified", false)
    .order("next_verification_attempt_at", { ascending: true, nullsFirst: true }).limit(Math.max(batchSize * 5, batchSize));
  const [{ data: storedObserved, error: observedLoadError }, { data: storedPending, error: pendingLoadError }] = await Promise.all([observedRequest, pendingRequest]);
  const loadError = observedLoadError ?? pendingLoadError;
  if (loadError) throw new Error(`Supabase could not load person identities: ${loadError.message}`);
  const existingByKey = new Map([...(storedPending ?? []), ...(storedObserved ?? [])].map((identity) => [identity.identity_key, identity as StoredPersonIdentity]));
  const candidates = new Map(observedByKey);
  for (const stored of (storedPending ?? []) as StoredPersonIdentity[]) {
    if (!candidates.has(stored.identity_key) && isReadablePersonName(stored.display_name)) {
      candidates.set(stored.identity_key, { displayName: stored.display_name, email: stored.email, sourceTaskIds: stored.source_task_ids });
    }
  }
  const due = [...candidates.entries()].filter(([key, identity]) => {
    const existing = existingByKey.get(key);
    return isVerifiablePersonName(identity.displayName) && (!existing || personIdentityDue(existing, now));
  });
  const pending = due.slice(0, batchSize);
  const resultByKey = new Map<string, PersonIdentityMatch>();
  const failures = new Map<string, string>();

  const emails = [...new Set(pending.flatMap(([, identity]) => identity.email ? [identity.email] : []))];
  for (let offset = 0; offset < emails.length; offset += 100) {
    const batch = emails.slice(offset, offset + 100);
    const batchIdentities = pending.filter(([, identity]) => identity.email && batch.includes(identity.email));
    try {
      const contacts = await client.all<WrikeContact>(contactsQueryPath({ emails: batch }));
      for (const [key, identity] of batchIdentities) {
        const match = matchPersonIdentity(identity, contacts);
        if (match.status !== "not_found") resultByKey.set(key, match);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Wrike contact email lookup failed.";
      for (const [key] of batchIdentities) failures.set(key, message);
      logWrikeEvent("warn", "wrike_person_email_verification_failed", { identityCount: batch.length, message });
    }
  }

  const nameLookups = pending.filter(([key]) => !resultByKey.has(key));
  await mapWithConcurrency(nameLookups, 4, async ([key, identity]) => {
    try {
      const contacts = await client.all<WrikeContact>(contactsQueryPath({ name: identity.displayName }));
      resultByKey.set(key, matchPersonIdentity({ ...identity, email: null }, contacts));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Wrike contact name lookup failed.";
      failures.set(key, message);
      logWrikeEvent("warn", "wrike_person_name_verification_failed", { identityKey: key, message });
    }
  });

  const rows = pending.map(([key, identity]) => {
    const existing = existingByKey.get(key);
    const match = resultByKey.get(key);
    const failed = failures.get(key);
    const contact = match?.status === "verified" ? match.contact : null;
    const incoming: StoredPersonIdentity = {
      identity_key: key,
      display_name: contact ? wrikeContactName(contact) || identity.displayName : identity.displayName,
      normalized_name: normalizePersonName(contact ? wrikeContactName(contact) || identity.displayName : identity.displayName),
      first_name: contact?.firstName?.trim() || null,
      last_name: contact?.lastName?.trim() || null,
      email: contact ? wrikeContactEmails(contact)[0] ?? identity.email : identity.email,
      wrike_contact_id: contact?.id ?? null,
      contact_active: contact?.active ?? null,
      contact_deleted: contact?.deleted ?? null,
      is_displayable: true,
      is_verified: Boolean(contact),
      verification_source: contact ? match!.source : "task_name",
      verification_status: contact ? "verified" : failed ? "failed" : match?.status ?? "unverified",
      candidate_contacts: (match?.candidates ?? []).map(candidateSummary),
      source_task_ids: identity.sourceTaskIds,
      verification_attempt_count: (existing?.verification_attempt_count ?? 0) + 1,
      last_verification_attempt_at: existing?.is_verified ? existing.last_verification_attempt_at : nowIso,
      next_verification_attempt_at: contact ? null : nextAttemptAt(failed ? "failed" : match?.status ?? "unverified", now),
      last_verified_at: contact ? nowIso : null,
      last_error: contact ? null : failed
        ?? (match?.status === "ambiguous" ? "Multiple exact Wrike contacts matched this identity; administrator review is required."
          : match?.status === "not_found" ? "No exact Wrike contact matched this identity."
            : "Wrike contact verification remains pending."),
      raw_data: contact ?? {}
    };
    return { organization_id: organizationId, ...mergePersonIdentity(existing, incoming), updated_at: nowIso };
  });
  if (rows.length) {
    const { error } = await db.from("wrike_person_identities").upsert(rows, { onConflict: "organization_id,identity_key" });
    if (error) throw new Error(`Supabase could not save person identities: ${error.message}`);
  }

  const verifiedContacts = rows.filter((row) => row.is_verified && row.wrike_contact_id).map((row) => {
    const raw = row.raw_data as WrikeContact;
    return {
      organization_id: organizationId,
      wrike_id: row.wrike_contact_id!,
      first_name: raw.firstName ?? null,
      last_name: raw.lastName ?? null,
      display_name: row.display_name,
      email: row.email,
      avatar_url: raw.avatarUrl ?? null,
      raw_data: raw,
      is_active: row.contact_active ?? !row.contact_deleted,
      is_unresolved: false,
      identity_verified: true,
      identity_verification_source: row.verification_source,
      identity_verified_at: row.last_verified_at,
      deleted_at: row.contact_deleted ? nowIso : null,
      synced_at: nowIso,
      last_resolution_attempt_at: nowIso,
      last_resolution_error: null,
      updated_at: nowIso
    };
  });
  if (verifiedContacts.length) {
    const { error } = await db.from("wrike_users").upsert(verifiedContacts, { onConflict: "organization_id,wrike_id" });
    if (error) throw new Error(`Supabase could not cache verified Wrike contacts: ${error.message}`);
  }
  const diagnostics = {
    observed: observations.length,
    deduplicated: observedByKey.size,
    attempted: pending.length,
    skipped: candidates.size - pending.length,
    cached: [...candidates.keys()].filter((key) => existingByKey.get(key)?.is_verified).length,
    verified: rows.filter((row) => row.is_verified && !existingByKey.get(row.identity_key)?.is_verified).length,
    ambiguous: rows.filter((row) => row.verification_status === "ambiguous").length,
    notFound: rows.filter((row) => row.verification_status === "not_found").length,
    failed: rows.filter((row) => row.verification_status === "failed").length
  };
  logWrikeEvent("info", "wrike_person_verification_completed", diagnostics);
  return { identities: rows, diagnostics };
}

export async function syncTaskPersonIdentities(db: AdminClient, organizationId: string, client: WrikeClient, observations: readonly TaskPersonIdentity[], now = new Date()) {
  return processPendingPersonIdentities(db, organizationId, client, observations, now);
}
