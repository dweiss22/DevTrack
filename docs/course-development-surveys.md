# Course-development surveys

DevTrack manages a **Course Development Debrief** for assigned SMEs and an internal **Review of Subject Matter Expert** for IDs.

Administrators design and publish these surveys at `/admin/surveys`. SME and ID
users use `/surveys`, which separates current incomplete requirements from their
own completed, read-only submissions.

## Versioned definitions

Migration `202607270001_versioned_survey_management.sql` adds organization-scoped
templates, optimistic draft revisions, immutable published versions, and
template audit history. Publishing any non-archived template creates the next
version for that audience. New responses use the newest version; an existing
draft remains pinned to the version on which it began.

Each submission and submitted revision stores both the definition and normalized
answer snapshot. The original typed response tables and response snapshots are
retained for compatibility. Version 1 is seeded from the original SME and ID
forms and existing responses are backfilled without deleting their typed data.

The designer supports bounded DevTrack components only: text, number/currency,
date, yes/no, choice, rating, matrix, and private file questions. Conditional
rules use an allowlisted operator model and may refer only to earlier questions.
Administrator copy is rendered as text; scripts, rendered HTML, and custom CSS
are not supported.

## Architecture and authorization

Survey URLs are task-scoped and route-backed. Client navigation uses a Next.js intercepted route so the project or SME Dashboard remains under a native modal dialog. Direct URLs render trusted project context behind the same dialog.

The existing role/capability model remains authoritative. IDs may edit only
their own current drafts and review only their own submitted responses. SMEs may
view and edit only their own current debrief drafts. Submitted responses are
permanently read-only to SME and ID users. Admins and SuperAdmins may unlock with
a reason, relock, correct context, resubmit an administrator revision, view
private files, and inspect revision/audit history. Revision access is no longer
reassigned to an SME or ID.

Pages, APIs, caller-aware database functions, RLS, and Storage policies independently enforce these boundaries. Unauthorized identifiers return a uniform unavailable response.

## Trusted context

Context comes from authenticated membership, the Online Learning workflow, synchronized tasks/projects, normalized Reporting and Vertical fields, verified Wrike assignments, and the existing SME-to-Wrike-user mapping. The browser cannot set organization, actor, subject identity, project metadata, lifecycle state, revision, or audit attribution.

Personal requirements use the verified `application_users.wrike_user_id` and
`course_development_person_assignments`. The normalized ID/owner field remains
authoritative, with mapped assignees used only when it is empty. Each assigned
course/SME pair creates a separate ID review. SME actions are available only at
Testing, Testing Revisions, Ready for Loading, Published, or Completed; the
database enforces the same rule as the page.

`wrike_tasks.original_due_date` is initialized from the due date first observed by DevTrack and is immutable. Existing tasks are baselined from their current due date; earlier Wrike history cannot be reconstructed. Publication dates are accepted only from an explicit normalized Publication/Publication Date/Publish Date field. When absent, a four-digit publication year is required and no date is inferred.

## Persistence, audit, and retention

Migration `202607230004_course_development_surveys.sql` adds shared submissions, typed response tables, private attachment metadata, immutable revisions, and an append-only audit log. Drafts resume through unique survey identities. Submission and resubmission preserve the original timestamp, snapshot context/responses, and lock the record.

Unlocking requires a reason and is administrator-only. Relocking without
resubmission restores the last immutable normalized answer snapshot. Submitted
definition, answer, and attachment snapshots are retained. Draft file
replacement/removal deletes the superseded object; an object referenced by a
submitted revision is never deleted. Audit APIs never expose object keys or
signed URLs.

## Private survey-file storage

The existing private `survey-invoices` bucket now stores every private
file-question upload while preserving all legacy invoice keys. Uploads validate
the question's extension allowlist and size limit, the declared MIME, and
PDF/PNG/JPEG/ZIP-OOXML/OLE signatures. Accepted extensions are PDF, DOC, DOCX,
XLS, XLSX, PNG, JPG, and JPEG. Randomized object keys are omitted from
authenticated grants and ordinary APIs. Downloads are reauthorized and use a
60-second signed URL.

DevTrack has no integrated malware scanner. Production operations should scan invoices through an approved storage-event or quarantine workflow before treating them as trusted documents.

## Deployment

Deploy `202607270001_versioned_survey_management.sql` before deploying the
application. It is additive and retains the old typed tables, compatibility
functions, history, invitations, and private object keys for application
rollback.

Before the application rollout, verify:

- every organization has two primary templates, two drafts, and two version-1
  records;
- every existing submission and revision has a non-null version, definition
  snapshot, and normalized answer snapshot;
- the newest non-archived published version is selected for each audience;
- authenticated roles cannot directly mutate definitions, answers,
  attachments, revisions, or audit rows;
- the `survey-invoices` bucket remains private and signed download checks still
  succeed.

After application deployment, smoke-test one SME draft, one ID requirement for
each assigned SME, an administrator publish/archive/restore cycle, and an
unlock/correct/resubmit/relock cycle. Watch failed RPCs, storage errors, and
authorization denials during the rollout.

Do not remove the compatibility tables, functions, legacy invitation records,
or historical revision columns in this release. Any cleanup belongs in a
separately reviewed future migration after the rollback window closes.
