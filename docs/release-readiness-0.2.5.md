# 0.2.5 rollout follow-ups

These notes were moved out of the user-facing release notes. Their removal from the release notes does not mark them resolved.

## Recovery security

The earlier review recorded response-timing differences and missing password/recovery-change notification emails. Recheck their current status before a public rollout; this release-note audit did not resolve or revalidate them.

Provider-created accounts require a local password before adding a recovery email. This requirement is implemented.

The conversation includes a successful staging verification-email test and verified sender DNS. Production delivery, full password-reset flow, and deployed security still need their own verification.

## Deployment

Recovery requires server-side Resend configuration and a verified sender domain. See [password recovery setup](password-recovery.md). Existing accounts need a verified recovery email. Older device-only SQLite profiles require migration to use cloud email recovery.

Backend changes, including recommendation lifecycle storage and community recommendations, need to be deployed along with the frontend. Local builds and isolated tests do not establish production deployment readiness.

The live Atlas library integration check could not connect to the local database during the latest recommendation work. Isolated lifecycle, inbound-provider, feedback, community recommendation, and hidden Electron tests passed.
