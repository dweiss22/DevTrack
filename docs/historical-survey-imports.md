# Historical survey CSV imports

DevTrack accepts two administrator-managed historical CSV schemas:
`SME_DEBRIEF` and `ID_SME_REVIEW`. The Data page links to the dedicated
four-stage import workflow. The former legacy/canonical mapper is no longer
presented to administrators; its existing batches and previously integrated
submissions remain available for audit and reporting.

## Persistence and retention

Inspection and reconciliation write staged, organization-scoped rows but do
not create survey responses. Finalized imports create normalized
`historical_survey_responses` records with type-specific detail records. These
records deliberately allow project and person associations to remain null, so
native survey-submission assignment and ownership constraints stay unchanged.

The uploaded file is never stored as an object. Full staged cell values are
available during preview. When the batch is finalized, DevTrack removes
nonessential raw cells and retains the original survey type/version, source
response ID, course name, optional source Wrike ID, submitted names/emails,
vertical, normalized response, normalization deltas, resolutions, issues, and
audit history.

## Authorization and idempotency

The existing `manage_data` capability is required to inspect, reconcile,
import, view audit history, or later associate a response with a project.
Replacing an existing historical response additionally requires
`manage_surveys`. API handlers and database functions both enforce these
checks.

The effective uniqueness key is organization, survey type, and source response
ID. Duplicate imports default to Skip. Importing separately creates a visible
derived source identifier while retaining the original. Replacement archives
an immutable prior snapshot before updating the response. Batch finalization
uses an idempotency key and row-level database savepoints.

## Deployment

Apply migrations through
`202607290008_finalized_historical_survey_import.sql`, reload the PostgREST
schema cache, deploy the application, and verify one preview-only upload before
running a production import.
