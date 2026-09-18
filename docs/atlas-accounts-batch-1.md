# Atlas accounts: batch 1

The staging account implementation is complete and has passed integration checks against Atlas. The `users` and `sessions` collections and their validators/indexes have been initialized in `seenary_staging`. On 2026-09-13, all 6 accounts from the user-supplied Hostinger snapshot at `D:/Downloads/media.db` were imported under source `hostinger-main` with zero conflicts.

Post-import verification compared every imported field against the source, including password hashes, timestamps, credential/tutorial flags, and legacy mapping. All matched, with 6 distinct Seenary IDs. A second apply imported 0 accounts and reported all 6 unchanged. The source file's SHA-256 remained `A6644640B0DE5FD3084DF46AA0430A64BAAF0CD47CBB2E0B47FDDC4D61FCF236`. SQLite integrity checks passed; completeness relative to the running host is limited to the supplied snapshot. A fresh production snapshot/reconciliation is still required before eventual cutover.

The live app still starts `backend/server.js` and uses SQLite. This batch provides a separate loopback-only account API; it is not a drop-in replacement for the full backend. Batch 2 has since added provider login/linking, account settings, and staged deletion; see the [provider runbook](atlas-providers-batch-2.md). Libraries remain outside this endpoint. Do not configure Hostinger to start this staging server.

## Commands

Run from `backend/` with Node 24. Use the existing ignored `.env` containing `MONGODB_URI`, `MONGODB_DATABASE=seenary_staging`, `MONGODB_USERNAME`, and `MONGODB_PASSWORD`.

```powershell
# Create or verify the staging collections, validators, and indexes.
npm.cmd run atlas:accounts -- setup

# Local account API on 127.0.0.1:3001. Ctrl+C closes server and database connections.
npm.cmd run atlas:accounts -- serve

# Disposable integration checks against staging, including real SQLite fixtures.
npm.cmd run test:atlas-accounts
```

`ATLAS_STAGING_PORT` can override port 3001. The API rejects foreign browser origins and non-loopback hostnames. It uses a distinct HttpOnly/SameSite=Strict cookie, bounded JSON bodies, and a conservative process-wide authentication limit suitable for this local staging endpoint. A publicly deployed server will need the existing production transport/security integration in a later batch.

### Create a test account

With the staging server running, send `POST /rpc` with `Content-Type: application/json`:

```json
{"method":"register","args":["staging_tester","use-a-unique-test-password"]}
```

Alternatively, put temporary `ATLAS_ACCOUNT_USERNAME` and `ATLAS_ACCOUNT_PASSWORD` values in the ignored local `.env` and run:

```powershell
npm.cmd run atlas:accounts -- create
```

Remove those two temporary values afterward. The creation command prints only the resulting Seenary ID and revokes its temporary session. It never accepts a password as a command-line argument.

### Supported RPC methods

| Method | Arguments | Behavior |
| --- | --- | --- |
| `register` | `[username, password]` | Creates an account, sets session cookie, returns safe user fields. |
| `login` | `[username, password]` | Verifies Argon2 password, sets session cookie. |
| `getSession` | `[]` | Returns only the cookie's authenticated account. |
| `logout` | `[]` | Revokes this session and clears the cookie. |
| `changePassword` | `[currentPassword, newPassword]` | Requires an authenticated session and current password; revokes all old sessions and requires re-login. |

Cloud user IDs are stable UUID strings. Imported numeric IDs are retained in `legacy.source` and `legacy.userId`, with a unique `legacyKey`. Do not pass the UUIDs through existing numeric-ID SQLite code. Batch 2 and later must adapt their own consumers explicitly.

Sessions store only SHA-256 token hashes, expire after seven days, and check expiry on every read independently of TTL cleanup. An account authentication version invalidates existing sessions atomically on password changes, including concurrent old-password logins. Batch 1 deliberately does not carry over SQLite sessions: imported users sign in again.

## Import hosted accounts

Obtain a consistent SQLite online backup from Hostinger. Do not copy only an actively written `media.db` while ignoring its WAL. Use the same stable source name for every rehearsal/rerun from that hosted database; do not change it for each filename or backup date.

```powershell
# Read-only preflight. Counts and conflict IDs only; no account writes.
npm.cmd run atlas:accounts -- import --sqlite "D:\path\hostinger-backup.db" --source hostinger-main

# Apply only after reviewing the dry-run report.
npm.cmd run atlas:accounts -- import --sqlite "D:\path\hostinger-backup.db" --source hostinger-main --apply

# Repeat the dry run: imported rows should now be reported as unchanged.
npm.cmd run atlas:accounts -- import --sqlite "D:\path\hostinger-backup.db" --source hostinger-main
```

The importer opens SQLite read-only and uses a read transaction. It preserves password hashes, credential-confirmation state (including unknown/null), tutorial state, and account timestamps. SQLite timestamp strings without a timezone are interpreted as UTC.

Preflight conflicts prevent account writes for that run. Unchanged previously imported rows are skipped, even if their cloud account has since changed its password. Changed source rows and usernames already owned by another cloud identity are reported for review; nothing is silently overwritten. Inserts use unique indexes, and interrupted imports can resume. A concurrent conflict during apply may leave earlier successful inserts in place; rerun to reconcile. Keep the source backup until migration verification is complete.

The import is accounts only: provider credentials, lists, sessions, and settings beyond the account fields are not included. Provider-only accounts preserve their credential state but need batch 2 before provider login becomes available.

## Validation recorded

- Real Atlas schemas, unique username/legacy indexes, session TTL index, and repeatable schema setup.
- Concurrent case-insensitive registrations, password verification, safe user responses, hashed tokens, logout, expiry before TTL deletion, password change/revocation, and service restart.
- Synthetic SQLite source stays byte-identical; missing input fails; dry run makes no writes; hashes/timestamps/flags are preserved; repeat imports and interrupted-run continuation do not duplicate accounts; conflicts do not overwrite accounts or changed cloud passwords.
- HTTP registration/session/logout, cookie isolation, unsupported-method rejection, origin checks, malformed/oversized requests, and authentication throttling.
- Local development `backend/media.db` dry run: 2 accounts ready, 0 conflicts, 0 imported. This is not the authoritative hosted snapshot.

Tests create unique `batch1_test_<random>_users` and `batch1_test_<random>_sessions` collections and remove only those collections afterward. They do not import real users.

## Local DNS note

On this machine, Node's configured resolver refused Atlas SRV queries. Tests and setup succeeded with public DNS configured only inside their Node process; no system DNS or production application defaults were changed. If necessary, the equivalent one-off test command is:

```powershell
node -e "require('node:dns').setServers(['1.1.1.1','8.8.8.8']); require('./scripts/atlas-accounts-smoke');"
```

For the CLI, insert the intended arguments explicitly, for example:

```powershell
node -e "require('node:dns').setServers(['1.1.1.1','8.8.8.8']); process.argv=['node','atlas-accounts','serve']; require('./scripts/atlas-accounts');"
```

Diagnose Hostinger connectivity independently. Environment variables alone do not prove its outbound IP and DNS can reach Atlas.
