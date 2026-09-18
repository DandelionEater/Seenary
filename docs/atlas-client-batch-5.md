# Batch 5: staging library client

This batch connects the existing renderer at `http://127.0.0.1:5173` to a reusable UUID-based library adapter when Atlas staging is enabled. Anime/manga lists, personal fields, favorites, recommendation inputs, bulk deletion, account-isolated preferences, backups, and durable pending edits now use the adapter. **Cloud saves** opens `?atlasReview=1` for conflict/restore decisions and resumable backup review. The installed production app keeps its existing data source until cutover.

## Run

Start the Atlas server in a backend terminal using `npm run atlas:accounts -- serve`. On this machine, the previously diagnosed DNS issue may require the same process-only DNS override used for earlier batches:

```powershell
node -e "require('node:dns').setServers(['1.1.1.1','8.8.8.8']); process.argv=['node','atlas-accounts','serve']; require('./scripts/atlas-accounts');"
```

In a frontend terminal run `npm run dev:atlas`, then open `http://127.0.0.1:5173`. Use an existing staging account. The client uses the same hostname on port 3001 so SameSite cookies work. Port 5173 is fixed; startup fails if occupied. Browser CORS is restricted to localhost/127.0.0.1 on that port, plus the API's own origin. Production origins cannot enable the staging screen even if its build flag is accidentally set.

## Device reconciliation

Decision on 2026-09-15: the owner accepts starting with empty favorites at migration. Historical device-only favorites do not need recovery or a mandatory backup upload; users will mark them again, and new favorite edits will persist in Atlas. This waiver applies to favorite history, not progress, notes, or other personal library data. The optional importer remains available for those values.

1. In the installed Seenary app, export a local backup for the account being migrated. Keep that file. This is separate from the earlier Hostinger SQLite snapshot, which had no favorites.
2. Sign into the same account in the staging screen. Open **Import a device library or restore a backup**, select the JSON, and check account ownership. Legacy backups contain a username, not an authenticated account UUID; ownership must be checked by the person importing.
3. Compare device and cloud values. Choose **Use device values**, **Keep cloud / skip**, or the explicitly labeled delete/restore action. Omitted legacy fields are not set to defaults over existing cloud data. Preferences and the original file are preserved, not written into the cloud account's library.
4. **Sync with cloud** sends queued decisions. Reconnect, initial login, and a one-minute timer also attempt delivery. A conflicting revision stays visible until resolved. Reopening the page resumes the queue and review checkpoints.

All imported records require a decision, in pages of 20, including new entries. Imports are additive unless a supplied deletion is explicitly accepted. No absence-based deletion occurs. Negative device media IDs require a saved MAL identity; an ambiguous/unmapped entry rejects the import instead of guessing. Only a single provider identity can create an empty canonical media record; browser data cannot assert AL/MAL mappings or overwrite shared metadata. New title metadata ingestion remains batches 6–7.

The original import is downloadable from the screen. Cloud backups contain confirmed entries, pending edits, cached media, review checkpoints, and the complete import source. Cloud backup restores require the same account UUID and pass through review rather than replaying old revisions blindly. Unreviewed imported candidates are also restored. Keep the original device backup for preferences and any source metadata.

## Durability and account boundaries

- IndexedDB database `seenary-cloud-staging`, store `accounts`, keyed by API origin plus authenticated UUID. No changes to the legacy `seenary-local` database. No localStorage fallback for accepted library edits.
- Each operation holds a Web Lock scoped to API origin/account, so multiple renderer tabs cannot overwrite each other's saved queue. Storage writes complete before success is reported. One pending edit per title is allowed; further edits wait for acknowledgement or conflict resolution.
- Every authenticated adapter request includes `expectedUserId` outside `args`. The server checks it against the cookie session before dispatch. A different account cannot receive an old account's mutations. Offline-cache selection never authenticates to the API.
- Mutation retries retain the exact operation ID/payload/revision after a network failure. Successful receipts remove the pending edit. Conflicts keep the intended patch and show current cloud fields. Editor saves retain the revision displayed when opened. A cloud entry that changes again during conflict review requires another review.
- Snapshot pages commit as one local state replacement with their change cursor. Interrupted pagination leaves the old durable cache and queue intact. Full-snapshot-required responses restart snapshot acquisition. Pending edits remain separate from confirmed entries.
- The staging client requests `includeDeleted: true` for snapshots, preserving explicit restore choices even after a cache reset. The server freezes this option across pagination. Existing callers retain active-only snapshots by default.
- Favorites-only edits preserve progress/notes and use the batch 4 cloud-only favorite behavior. The existing HomePage receives cloud favorites and cached recommendation nodes through its established list interface, including manga recommendation nodes saved in AniList source details.
- Provider delivery remains separate. Cloud save acknowledgement does not mean an AniList/MAL update has run; workers arrive in batch 8.

## Android contract

The portable adapter is `frontend/src/cloud/libraryClient.ts`; its `Storage` and `Rpc` interfaces are injected. An Android implementation must use transactional durable storage and an account-scoped mutex in place of IndexedDB/Web Locks. Preserve UUIDs, operation IDs, integer revisions, explicit nulls, numeric score without rescaling, and the snapshot/change cursors as opaque values. Never convert Seenary UUIDs into legacy numeric IDs. See batch 4 for the server RPC contract. The two new authenticated helpers are `getLibraryMedia [[uuid, ...]]` (maximum 50) and `ensureLibraryMedia [type, provider, positiveIntegerId]` (one provider only).

## Verification and remaining rollout work

Checkpoint 2026-09-15: client regression tests, targeted ESLint, normal/staging builds, and the hidden Chromium browser checks passed. Two additional fixes preserve deleted entries in fresh snapshots and retain unresolved device alternatives when restoring a cloud backup. The updated Atlas integration suite could not reach a server (`MongoServerSelectionError`) even with network escalation; rerun it after Atlas connectivity is restored. The previous 2026-09-14 library integration run passed, but that does not validate the new snapshot option against Atlas.

Full-renderer follow-up on 2026-09-15: the browser suite also passed existing-renderer library reads/writes, favorite acknowledgement, backup export, cached recommendation inputs, preference isolation, and bulk deletion. Device-only clearing is rejected rather than silently translated into cloud/provider deletion. The renderer exposes pending/review counts through Cloud saves. Login session metadata permits offline cache reopening; all cloud operations still require a matching live server session. Logout clears the offline-reopen identity in both screens while retaining the durable account-isolated queue for a future authenticated session.

- `npm run test:cloud-library` in frontend tests persistence failure, lost acknowledgement/restart, partial updates, stale editors, conflict rebase, tombstones, account isolation, resumable imports, MAL identity and failed snapshot pagination.
- `test:atlas-library` adds real Atlas HTTP checks for allowed/denied origins, wrong-account rejection, unauthenticated identity creation, and bounded metadata reads. Existing library transaction/import tests still run against disposable synthetic collections.
- Both normal and staging frontend builds and targeted ESLint checks run separately.
- `backend/scripts/atlas-client-browser-smoke.cjs` runs with Electron against a staging build and synthetic local servers on 3001/5173. It uses an in-memory browser partition, tests actual IndexedDB persistence/reload, favorites and switching accounts, and records results in `backend/node_modules/.cache/atlas-client-browser-result.json`. Stop local dev servers before running it. No real provider or Atlas data is used.

The full renderer library integration is implemented in `rendererAdapter.ts`. Cloud authorization/storage use UUIDs throughout. A persistent, negative numeric alias is allocated under a Web Lock solely for the existing renderer's device preferences; it never authorizes requests or opens a positive legacy user key. AniList IDs remain positive renderer media references; MAL-only references use negative MAL IDs and retain the canonical Seenary UUID alongside them.

Existing public discovery routes remain read-only calls to the configured metadata service; title details fall back to Atlas metadata. Shared ingestion/caching is batch 6. Provider link/settings reads use Atlas. Provider delivery still awaits batch 8. Unported account/provider operations return an explicit staging-unavailable result and cannot fall through to legacy account writes; live OAuth callback registration/testing remains the documented batch 2 follow-up. This staging boundary is not a claim that every production feature is ready for cutover.

The real device export has not been imported in this batch. Historical favorites are explicitly waived and do not block migration. Any remaining device-only progress/notes need reconciliation before their local authority is retired. No Hostinger environment changes or production deployment are needed for these staging checks.
