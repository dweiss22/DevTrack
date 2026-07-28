# SME debrief notifications

DevTrack stores one durable notification event for each newly submitted SME
debrief revision and one idempotent delivery for every active SME Coordinator
in the same organization. The survey transaction commits before delivery is
attempted; provider failures do not change the submitted survey.

## Email configuration

Configure these server-only variables in Vercel:

- `RESEND_API_KEY`: Resend API credential.
- `NOTIFICATION_FROM_EMAIL`: verified sender, for example
  `DevTrack <devtrack@example.com>`.
- `NOTIFICATION_REPLY_TO`: optional monitored reply address.
- `CRON_SECRET`: shared secret used by the notification retry route.

The protected `/api/cron/sme-debrief-notifications` route retries due
deliveries and removes stale private draft invoices. Vercel invokes it every
ten minutes. Admins can also retry a failed delivery from the submitted survey
detail.

External-SME invoices are read from the private `survey-invoices` bucket and
attached directly to the Resend message. If attachment preparation fails, the
message contains an authenticated DevTrack management-download route rather
than a public storage URL. Internal-SME messages never contain billing fields
or invoice data.
