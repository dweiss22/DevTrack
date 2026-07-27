# DevTrack authentication email templates

DevTrack sends only the Supabase **Reset password** email for both first-time
access and forgotten passwords. Paste `recovery.html` into that template when
template editing is available. It deliberately uses `{{ .ConfirmationURL }}` so
Supabase can verify the one-time token before returning the browser to
`/auth/recovery`.

The application does not call `inviteUserByEmail`. `invite-user.html` is a
defensive replacement for the legacy **Invite user** template: it contains no
invitation token and directs the recipient to the same password page.

Set the email subjects to:

- Reset password: `Set up or reset your DevTrack password`
- Invite user (retired fallback): `Your DevTrack account is ready`

Existing messages already delivered to a mailbox cannot be recalled or
rewritten. Cancel legacy pending invitations in User Management. New users are
provisioned directly and receive a fresh recovery link.

Required Supabase URL configuration:

- Site URL: the exact production `NEXT_PUBLIC_APP_URL`
- Allowed redirect: `<NEXT_PUBLIC_APP_URL>/auth/recovery`
- Allowed redirect: `<NEXT_PUBLIC_APP_URL>/auth/callback` for Microsoft/PKCE

These files are deployable configuration artifacts; changing them in the
repository does not automatically update the hosted Supabase project.
