# Atlas linked accounts: batch 2

Status: implementation, synthetic Atlas integration tests, and the supplied snapshot's provider import completed in staging on 2026-09-13. All 4 AniList links and 1 MAL link (6 encrypted tokens) were imported under source `hostinger-main`, using the supplied source key to decrypt and the staging key to re-encrypt. All imported fields and decrypted tokens verified successfully. A second apply reported 5 unchanged and 0 inserted, with no conflicts. All 7 local/global settings were excluded. No real provider API calls or refreshes were performed; live browser OAuth testing still requires registered staging callbacks.

The source file remained byte-identical to batch 1 (SHA-256 `A6644640B0DE5FD3084DF46AA0430A64BAAF0CD47CBB2E0B47FDDC4D61FCF236`). Both keys remain in ignored local configuration under distinct names: `TOKEN_ENCRYPTION_KEY` for staging and `MIGRATION_TOKEN_ENCRYPTION_KEY` for source imports. The hosted SQLite app is unchanged.

## Storage and ownership

- `providerAccounts`: one active provider per Seenary account; unique provider + provider user ID across accounts. Stores encrypted access/refresh tokens, expiry, profile names, original names, timestamps, and a revision.
- `oauthFlows`: short-lived, one-use authorization state bound to provider and browser. Linking also records the initiating session and authentication version. MAL PKCE verifiers are encrypted. Expiry is enforced on lookup, independent of TTL cleanup.
- `accountSettings`: account-scoped sync policy. Missing policy returns auto-sync disabled with `needsDeviceReconciliation=true`; this avoids guessing device-held preferences. Updating the policy explicitly clears that flag. Device migration must reconcile existing local settings later.
- `providerMigrationReceipts`: source fingerprint and target user ID, committed atomically with each imported link or setting. Receipts survive unlink/deletion so old snapshots cannot restore revoked credentials.

Provider IDs are attached only after the backend exchanges a provider authorization code and obtains the authenticated provider's profile. A caller-supplied provider ID or profile never authorizes linking. A link already owned by another Seenary account is rejected. This batch does not automatically merge accounts or discard their libraries; an intentional merge must wait for library migration and explicit conflict reconciliation. Switching providers requires unlinking the current one first.

## Staging API

Start with `npm.cmd run atlas:accounts -- serve` from `backend/`. The existing loopback-only API on port 3001 now includes provider operations; the live `server.js` is unchanged. Configure **separate staging OAuth applications** and their exact registered callback URLs:

```env
ATLAS_ANILIST_REDIRECT_URI=http://127.0.0.1:3001/auth/anilist/callback
ATLAS_MAL_REDIRECT_URI=http://127.0.0.1:3001/auth/mal/callback
```

Set the local `ANILIST_CLIENT_ID`/`ANILIST_CLIENT_SECRET` and `MAL_CLIENT_ID`/`MAL_CLIENT_SECRET` to those staging applications as applicable. Do not change the production callbacks. Callback port and hostname must match the local server/browser being used. The browser that starts authorization must also receive the callback so its HttpOnly binding cookie is available.

Send JSON `{ "method": "...", "args": [...] }` to `POST /rpc`:

| Method | Arguments | Result |
| --- | --- | --- |
| `beginProviderLogin` | `["anilist" or "mal", optionalSeenaryUsername]` | Returns authorization URL. Existing provider identities sign into their mapped account; new ones require an available Seenary username. |
| `beginProviderLink` | `[provider]` | Requires current Seenary session; returns authorization URL bound to it. |
| `getProviderAccount` | `[]` | Returns safe linked profile and expiry information, never tokens. |
| `refreshProvider` | `[]` | Explicit MAL refresh, guarded by a persisted lease. AL returns a reauthorization message. |
| `setLocalPassword` | `[newPassword]` | Allows a provider-created account with explicitly unconfirmed local credentials to establish a password; requires re-login afterward. Legacy unknown/confirmed credentials use the existing password-change path. |
| `unlinkProvider` | `[currentSeenaryPassword]` | Revokes the link, pending linking flows, and sessions; cancels stored pending provider work. |
| `getAccountSettings` | `[]` | Reads the authenticated account's sync policy. |
| `setAccountSettings` | `[{"autoSyncEnabled": true or false}]` | Sets only the authenticated account's policy. |
| `deleteAccount` | `[exactUsername, currentSeenaryPassword]` | Deletes staging provider credentials, sessions, settings, and linking flows; cancels pending jobs and anonymizes the account as a migration tombstone. |

The provider redirects to `GET /auth/anilist/callback` or `GET /auth/mal/callback`. Successful provider login sets the staging session cookie. This is a functional developer API, not yet the production frontend integration. Live browser authorization remains a manual integration check with registered staging applications; automated tests use mock provider responses and real Atlas storage.

AniList uses long-lived tokens and does not provide refresh tokens; reauthorization is required when those expire or become invalid ([AniList authentication migration documentation](https://docs.anilist.co/guide/migration/version-1/)). MAL's adapter follows the existing application's code exchange/PKCE flow and token refresh behavior. Refresh is explicit in this batch; scheduling and automatic provider-operation retries remain batch 8 work.

## Revocation and lifecycle

Multi-document changes use MongoDB transactions. Account writes serialize with deletion through a lifecycle revision. MAL refresh obtains a persisted lease and commits only against the original link ID/revision and a still-valid user session. An unlink or deletion cannot be undone by a late refresh response. Failed refresh leaves the previous encrypted credentials intact; provider authorization errors mark the link for reauthorization. If a process dies after the remote provider rotates a refresh token but before persistence, relinking may be necessary.

Unlinking/deletion cancels `jobs` belonging to the user/provider with status `pending`, `running`, `retry`, or `queued`. Batch 8 workers must additionally check link existence and revision before sending requests; cancellation cannot retract an external request already in progress. No legacy SQLite sync queue is imported in this batch.

Deletion is staging-only and covers the migrated account domains. Batch 4 extends it to personal libraries, history, snapshots, receipts, and private outbox payloads. The retained anonymized user record preserves its legacy mapping/fingerprint so batch 1 import cannot resurrect it. Later analytics and export/deletion work must cover its collections before production rollout.

## Importing the snapshot

Use Node 24 from `backend/`. Keep the original Hostinger `TOKEN_ENCRYPTION_KEY` in ignored `.env` as `MIGRATION_TOKEN_ENCRYPTION_KEY`; keep the staging `TOKEN_ENCRYPTION_KEY` unchanged. The importer decrypts with the source key and re-encrypts with the staging key. It does not merely copy unverified ciphertext.

```powershell
npm.cmd run atlas:providers -- setup
npm.cmd run atlas:providers -- import --sqlite "D:\Downloads\media.db" --source hostinger-main
npm.cmd run atlas:providers -- import --sqlite "D:\Downloads\media.db" --source hostinger-main --apply
npm.cmd run atlas:providers -- verify --sqlite "D:\Downloads\media.db" --source hostinger-main
# A second apply should report all records unchanged.
npm.cmd run atlas:providers -- import --sqlite "D:\Downloads\media.db" --source hostinger-main --apply
```

The source name must match batch 1's `hostinger-main` mapping. Preflight validates all rows and decrypts credentials before any link writes. Missing/deleted accounts, duplicate ownership, invalid fields, incorrect keys, or existing conflicting records block the apply. Conflicts print identifiers and generic reasons, never tokens or keys. The source remains read-only. After a partial interruption, receipts allow rerunning without restoring links that were subsequently revoked.

Only explicitly account-scoped `sync.autoEnabled.user.<legacyId>` settings are eligible. All 7 settings in the supplied snapshot are local/global preferences or local session state and are excluded. Unknown device-held sync policy is reconciled in batch 5.

Do not refresh the imported live MAL credentials merely to test them: a provider rotation could affect the still-running SQLite app. The import verification decrypts and compares locally; provider behavior is tested using synthetic credentials. Use an independently authorized staging account for live OAuth testing.

This machine's process-only DNS workaround, when needed:

```powershell
node -e "require('node:dns').setServers(['1.1.1.1','8.8.8.8']); process.argv=['node','atlas-providers','import','--sqlite','D:/Downloads/media.db','--source','hostinger-main']; require('./scripts/atlas-providers');"
```

## Validation

`npm.cmd run test:atlas-providers` creates uniquely named disposable staging collections and synthetic SQLite data. It covers:

- Both providers' login/signup/link flows, identity ownership, single-provider policy, browser/provider state binding, expiry, one-use state, and revoked initiating sessions.
- Token encryption/decryption across service instances, wrong-key rejection, refresh rotation, lease exclusion, and refresh completing after unlinking.
- Account settings isolation, local password establishment, session revocation, and staged deletion/job cancellation.
- Read-only SQLite import, incorrect-key preflight, transactional receipts, decrypted-field verification, repeat imports, and non-resurrection after unlink/deletion.
- HTTP callback cookies, safe profile responses, and real adapter request construction through a mock transport.

Batch 1 account regression checks also passed after the provider/lifecycle changes.
