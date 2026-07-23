# Course-development surveys

DevTrack manages a **Course Development Debrief** for assigned SMEs and an internal **Review of Subject Matter Expert** for IDs.

## Architecture and authorization

Survey URLs are task-scoped and route-backed. Client navigation uses a Next.js intercepted route so the project or SME Dashboard remains under a native modal dialog. Direct URLs render trusted project context behind the same dialog.

The existing role/capability model remains authoritative. IDs may view all ID reviews in their organization but edit only their own drafts or an unlocked review assigned to them. SMEs may view and edit only their own debrief. Admins and SuperAdmins may manage both types, create on behalf of an assigned mapped SME, unlock with a reason, relock, reassign an ID reviser, correct context while unlocked, view invoices, and inspect revision/audit history.

Pages, APIs, caller-aware database functions, RLS, and Storage policies independently enforce these boundaries. Unauthorized identifiers return a uniform unavailable response.

## Trusted context

Context comes from authenticated membership, the Online Learning workflow, synchronized tasks/projects, normalized Reporting and Vertical fields, verified Wrike assignments, and the existing SME-to-Wrike-user mapping. The browser cannot set organization, actor, subject identity, project metadata, lifecycle state, revision, or audit attribution.

`wrike_tasks.original_due_date` is initialized from the due date first observed by DevTrack and is immutable. Existing tasks are baselined from their current due date; earlier Wrike history cannot be reconstructed. Publication dates are accepted only from an explicit normalized Publication/Publication Date/Publish Date field. When absent, a four-digit publication year is required and no date is inferred.

## Persistence, audit, and retention

Migration `202607230004_course_development_surveys.sql` adds shared submissions, typed response tables, private attachment metadata, immutable revisions, and an append-only audit log. Drafts resume through unique survey identities. Submission and resubmission preserve the original timestamp, snapshot context/responses, and lock the record.

Unlocking requires a reason. Relocking without resubmission restores the last immutable response. Submitted revision snapshots are retained. Draft invoice replacement/removal deletes the superseded object and retains inactive metadata plus a filename-only audit event. Audit APIs never expose object keys or signed URLs.

## Private invoice storage

The migration creates the private `survey-invoices` bucket with a 10 MB limit and policies. Uploads validate extension, declared MIME, and PDF/PNG/JPEG/ZIP-OOXML/OLE signatures. Accepted extensions are PDF, DOC, DOCX, XLS, XLSX, PNG, JPG, and JPEG. Randomized object keys are omitted from authenticated grants and ordinary APIs. Downloads are reauthorized and use a 60-second signed URL.

DevTrack has no integrated malware scanner. Production operations should scan invoices through an approved storage-event or quarantine workflow before treating them as trusted documents.

## Deployment

Apply all forward-only Supabase migrations. The migration creates the tables, bucket, policies, and schema-reload notification. Confirm the existing server-only `SUPABASE_SERVICE_ROLE_KEY` is configured. No public bucket or manual URL configuration is required.
