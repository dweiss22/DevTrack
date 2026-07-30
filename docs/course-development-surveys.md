# Course-development surveys

DevTrack manages the **Lexipol Course Development Debrief** for assigned SMEs
and the **ID Review of SME** for assigned Instructional Designers.

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
retained for compatibility. Migration
`202607300001_complete_survey_management.sql` publishes one new standard version
per survey type and organization when that exact definition has not already
been published. It updates only the primary working draft, increments its
optimistic lock, and records a system-authored audit event. Customized and
historical versions, existing drafts, submissions, revisions, compatibility
rows, and attachments are not moved or changed.

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

Personal requirements use durable SME dashboard identities, verified
application-user links, and normalized assignment resolvers. The normalized
ID/owner field remains authoritative. Each assigned course/SME identity pair
creates a separate ID review.

An SME debrief is available only when the synchronized status has the
authoritative `completed` dashboard classification and `wrike_tasks.completed_at`
is present. The completion instant is converted to the organization's timezone.
The debrief remains editable through the entire local calendar date six months
after completion. Calendar-month arithmetic controls month-end and leap-day
cases. Pending and expired requirements remain visible but disabled. Expired
drafts cannot be reopened, while the owning SME may always read a submitted
response. ID reviews do not have an additional time limit.

Trusted SME name, email, classification, and Reporting Year and trusted ID name,
course, reviewed SME, Vertical, and Reporting Year are recalculated on the
server. Browser copies are stripped before persistence. Context is frozen at
submission. Currency values are normalized to two-decimal JSON strings and cast
to PostgreSQL `numeric` only for typed compatibility storage.

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

Apply these pending migrations in filename order before deploying the
application:

1. `202607290007_canonical_historical_survey_csv.sql`
2. `202607290008_finalized_historical_survey_import.sql`
3. `202607300001_complete_survey_management.sql`

Then reload PostgREST's schema cache and deploy the application. The survey
migration is additive and retains typed compatibility tables, immutable
history, historical definitions, invitations, and private object keys.

Before the application rollout, verify:

- every organization has two active primary templates and one newly published
  standard version for each type;
- rerunning the standard seed creates no additional versions or audit events;
- every existing submission and revision has a non-null version, definition
  snapshot, and normalized answer snapshot;
- historical row counts and pinned version IDs are unchanged;
- the newest non-archived published version is selected for each audience;
- authenticated roles cannot directly mutate definitions, answers,
  attachments, revisions, or audit rows;
- the `survey-invoices` bucket remains private and signed download checks still
  succeed.

After application deployment, smoke-test internal and external SME drafts, the
exact SME cutoff transition in an organization timezone, one ID requirement for
each assigned SME, an administrator publish/archive/restore cycle, and an
unlock/correct/resubmit/relock cycle. Confirm an expired SME draft is disabled,
an expired submitted response remains readable, external invoice download is
signed, and internal billing fields are absent.

Do not remove the compatibility tables, functions, legacy invitation records,
or historical revision columns in this release. Any cleanup belongs in a
separately reviewed future migration after the rollback window closes.
