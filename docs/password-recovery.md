Password recovery
=================

Cloud accounts can add a recovery email under Settings → Sign-in methods, or optionally during password registration. The address is usable only after its verification code is confirmed. Existing recovery addresses remain active while a replacement is pending. A local Seenary password is required before adding or changing a recovery address, and the current password must be confirmed. Provider-created accounts can set their first password without an email.

Configure these server environment variables:

* `RESEND_API_KEY`: a server-only Resend API key.
* `RECOVERY_EMAIL_FROM`: a sender on a verified Resend domain, e.g. `Seenary <accounts@your-domain>`.
* `RECOVERY_APP_URL`: the trusted HTTPS app URL, e.g. `https://seenary.app/`. Do not use the API URL. Local development also accepts HTTP localhost.

Restart the API after configuration. No credentials belong in frontend environment variables. Delivery uses the Resend email API: https://resend.com/docs/api-reference/emails/send-email . Without this configuration, email actions report that delivery is unavailable.

New email verification uses a six-digit code entered in step 2 of the same overlay. Codes expire after 10 minutes, allow five attempts, and are stored as Argon2 hashes. Resending is limited to once per minute and replaces the pending challenge; resuming a pending verification does not require the password again. Expired challenges require a new password-confirmed request. Previously issued verification links remain supported until their original expiry. Reset links expire after 30 minutes. Tokens are random, stored only as hashes, single use, and tied to the account authentication version. Resetting the password invalidates all existing sessions. URLs carry secrets in fragments, which are cleared when the recovery screen mounts and are not sent to the web host. GET navigation never consumes a token; the user confirms the action explicitly.

Requests are covered by the server authentication rate limit and a one-minute per-account email cooldown. Reset requests return the same response for unknown and registered addresses. Recovery emails are unique among accounts, included in account privacy export, and erased on account deletion. No recovery email is copied from third-party providers.

Older device-only SQLite profiles do not have cloud recovery. They must be migrated to a cloud account to use email recovery. Existing accounts without a verified recovery email cannot recover a forgotten password by email; an already linked provider can still be used to sign in.

Before release, configure a sender and test code verification, password reset, and spam-folder placement on the deployed app. Automated tests inject a mailer and do not send real email.
