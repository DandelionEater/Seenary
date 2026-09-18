# Batch 9: storage and operations

Batch 9 is divided into four checkpoints. Completion in this batch prepares staging operations; it does not authorize production cutover.

1. **Storage ownership and SQL audit:** inventory every SQLite table and direct caller, name the current authority and retirement checkpoint, and prevent the Atlas runtime from acquiring a SQLite dependency.
2. **Account portability and erasure:** export every account-owned Atlas domain, delete every private domain and active credential/worker state, and verify public canonical records remain intact.
3. **Analytics ownership:** preserve explicit consent, move hosted aggregate collection away from legacy account tables, bound retention, and keep reports anonymous.
4. **Recovery and deployment operations:** create and restore Atlas backups in isolation, validate required hosting configuration, add safe health/metrics reporting, and record the production runbook.

## Checkpoint 1 — storage ownership and SQL audit, completed 2026-09-18

`atlas/storageOwnership.js` assigns all 20 SQLite tables to a data domain, current legacy authority, cloud destination where one exists, and an explicit retirement checkpoint. It also freezes the 13 production modules that directly import `db.js` and records three runtime boundaries: installed desktop, legacy hosted server, and Atlas staging.

The audit confirms that `server.js` is still the broad SQLite-hosted runtime and must remain separate until the controlled cutover. `atlas/stagingServer.js` and every module under `backend/atlas` have no SQLite or `better-sqlite3` dependency. Migrated domains have one authority per runtime: legacy routes use SQLite, while isolated staging routes use Atlas. They are not silently dual-written.

`test:atlas-storage-ownership` fails when a SQLite table or direct caller appears without an ownership decision, or when Atlas code imports SQLite. This converts the inventory into a continuing boundary check. Checkpoint 2 will build complete Atlas account export and erasure against this manifest.

## Checkpoint 2 — account portability and erasure, completed 2026-09-18

`atlas/accountData.js` is the single manifest for portable and erasable account domains. The authenticated export contains the safe account profile, settings, provider identity without credentials, current and deleted library entries, ordered change history, mutation/import review state, pending provider operations, and inbound refresh status. Dates are portable ISO strings. Password hashes, encrypted access/refresh tokens, OAuth binding/verifier values, session hashes, source fingerprints, and worker/refresh lease owners are excluded recursively.

Account deletion now uses the same manifest to erase sessions, provider links, OAuth flows, provider and library migration receipts, settings, every library/history/snapshot/receipt record, outbound jobs, locks, and inbound refresh state in the account transaction. The user row becomes an inert anonymous tombstone. Legacy source identity is replaced by a one-way migration-block hash so rerunning an old import cannot resurrect the account without retaining its source ID or source snapshot. Shared canonical media, mappings, and public caches remain intact.

The staging RPC exposes `exportAccountData` only to an authenticated session. Deletion still requires the current Seenary username and password, revokes every session, and makes later export/login fail.

Validation passed against disposable Atlas collections: complete export coverage, private-note portability, recursive credential/lease exclusion, wrong-password rejection, deletion of every user-scoped collection, anonymous non-resurrection tombstone, and canonical-media preservation. The full provider lifecycle and cloud-library deletion regressions also pass. No real account was exported or deleted.

## Checkpoint 3 — analytics ownership, completed 2026-09-18

`atlas/analytics.js` moves the existing privacy model into isolated Atlas collections. Consent is stored on the authenticated account settings and checked by the server for every write. The client payload supplies platform and application version only; a claimed user ID is ignored. Accounts without explicit enabled consent create no analytics record.

Daily activity stores at most one row per consenting account and UTC date. Identity is a month-scoped HMAC derived on the server, so records contain no account ID, username, title, search, IP address, or event trail, and keys cannot link the same account across months. Platform and version use small validated values. Reports expose daily/monthly counts and anonymous dimensions only.

Opting out removes every retained daily pseudonymous row for that account. Account deletion performs the same removal inside the erasure transaction. Closed months are finalized into count-only documents; finalized aggregates have no monthly keys and therefore no removable or recoverable account identity. Raw daily rows are retained for at most 45 days after their month is finalized. The HMAC secret remains required and must be stable through the raw-retention window.

The staging server now provides authenticated `setAnalyticsConsent` and `recordEngagement` operations. `atlas:analytics setup`, `finalize`, and `report` provide explicit operational commands. The Atlas account server initializes the schemas and service, while the legacy hosted runtime remains on its existing SQLite analytics path until Batch 10 cutover.

Disposable Atlas validation passed for consent gating, server-owned identity, daily deduplication, month-key rotation, normalization, anonymous reporting, opt-out erasure, account-deletion erasure, finalization, and 45-day pruning. The existing SQLite analytics/report regression also still passes. No real analytics record was read, written, or removed.

## Checkpoint 4 — recovery and deployment operations, completed 2026-09-18

`atlas/backup.js` creates a logical backup of every Atlas account, provider, canonical media, library, worker, cache, and analytics collection. It serializes BSON values with canonical Extended JSON, records a SHA-256 digest and document count per collection, compresses the payload, and encrypts it with AES-256-GCM. `ATLAS_BACKUP_ENCRYPTION_KEY` must be a separate 32-byte key kept outside Atlas and outside the backup files.

Restore is deliberately restricted to a random disposable `batch1_test_*` namespace. It creates the current validators and indexes, refuses a nonempty target, verifies every encrypted source collection before insertion, and recalculates its count and checksum from Atlas afterward. The rehearsal command always drops that namespace. This tests whether a backup is readable without exposing or overwriting staging or production collections.

`atlas:operations validate --mode staging|production` checks the required database, provider, encryption, analytics, and capacity settings before startup. Production mode additionally requires the `seenary` database and HTTPS API, callback, and web origins. `atlas:operations health` emits aggregate counts only: worker/refresh state, overdue leases, query-cache size, and database storage against the configured budget. It never emits account IDs, usernames, media titles, job payloads, or credentials. Storage thresholds are alert at 60%, action at 75%, and block at 85%.

The staging renderer now sends explicit analytics consent and daily engagement through the authenticated Atlas RPC. Consent is saved remotely before the local preference is accepted, so a failed server update cannot make the UI claim that collection is enabled.

### Operations runbook

1. Before each deployment, run `npm run atlas:operations -- validate --mode staging` or `--mode production`. Stop on any error.
2. Run the Atlas worker as one supervised process. Run `npm run atlas:analytics -- finalize` and `npm run atlas:cache-maintenance` daily. Run `npm run atlas:operations -- health` on the monitoring interval and alert on a nonzero exit or a reported capacity/lease issue.
3. Create a daily encrypted backup with `npm run atlas:operations -- backup --output <private-path>`. Keep the encryption key in the host secret store, keep backup files outside the application/web roots, copy them to separate storage, and apply the chosen retention policy there.
4. After every backup-format or schema change, and periodically thereafter, run `npm run atlas:operations -- restore-rehearsal --input <backup-path>`. A successful result must report all collection counts; failure leaves live names untouched and cleanup removes the disposable namespace.
5. At Batch 10 cutover, take a final SQLite snapshot, pause legacy writes, run the final idempotent imports and their verify commands, take and rehearse an Atlas backup, run deployment validation and health, then switch traffic. Keep the SQLite snapshot and previous deployment available for rollback until the observation window closes.

The disposable Atlas recovery rehearsal passed encryption-at-rest inspection, wrong-key rejection, prefix enforcement, nonempty-target refusal, and full checksum/count verification. Deployment preflight, aggregate-only health reporting, the storage ownership guard, legacy analytics regression, and the production frontend build also pass. No real Atlas document was changed by the rehearsal.

Batch 9 is complete. Production traffic remains on the legacy runtime until the controlled Batch 10 cutover.
