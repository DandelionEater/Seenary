# Batch 10: rehearsal and controlled cutover

Batch 10 has four checkpoints. A checkpoint may prepare production behavior without activating it.

1. **Cutover rehearsal and client gate:** one read-only command evaluates every SQLite import domain against Atlas, fingerprints the immutable source, and reports conflicts; compatible-client enforcement is present but off by default.
2. **Production Atlas API:** extract the Atlas application server from its loopback staging shell, apply hosted CORS/cookie/rate-limit/security behavior, and validate it without switching DNS or traffic.
3. **Fresh-data reconciliation:** obtain a fresh Hostinger SQLite snapshot, rehearse all imports, compare counts and meaningful fields, and stage any current device backups for explicit review.
4. **Controlled cutover:** freeze legacy writes, take the final snapshot, run and verify idempotent imports, rehearse an encrypted Atlas backup, validate health, switch traffic by cohort, and retain the old runtime and data for rollback.

## Checkpoint 1 — cutover rehearsal and compatible-client gate

`npm run atlas:cutover -- rehearse --sqlite <snapshot> --source <stable-name>` opens the snapshot read-only, hashes it before and after the rehearsal, and runs the account, provider, media, and library importers in dry-run mode against staging Atlas. It returns aggregate reports and conflict counts. It never applies an import.

Every web RPC now sends the compile-time Seenary version. `ATLAS_CLIENT_GATE_MODE` defaults to `off`; `observe` classifies clients without blocking them, and `enforce` returns HTTP 426 for a missing, invalid, or older version. `ATLAS_MIN_CLIENT_VERSION` is required in observe/enforce modes. Enforcement must remain off until checkpoint 4 confirms the compatible release is available and the rollback build can still reach its intended authority.

Checkpoint 1 is complete when the local gate/build tests pass and the command produces a conflict-free report against the fresh checkpoint-3 snapshot. Code readiness alone does not satisfy the fresh-data condition and does not authorize cutover.

The implementation and orchestration checks passed on 2026-09-18. A read-only rehearsal against the existing Hostinger snapshot (`a6644640…fcf236`) found 6 unchanged accounts, 5 unchanged provider links, 679 unchanged canonical media records, 743 unchanged library entries, and zero conflicts in every domain. The snapshot is useful proof that the combined command is repeat-safe, but it is not the fresh checkpoint-3 export. Client-gate unit checks, the production frontend build, and the disposable Atlas account/HTTP regression also passed.

## Checkpoint 2 — production Atlas API, completed 2026-09-18

`atlas-server.js` is the production-only Atlas entry point. Startup first validates production configuration, connects specifically to the `seenary` database, checks aggregate health/capacity, installs every Atlas schema/service, and only then listens. `npm start` still launches the legacy SQLite server; the new path requires the explicit `npm run start:atlas` command and therefore cannot activate through a normal code deployment.

The shared HTTP shell retains loopback-only defaults for staging. Production configuration disables that restriction while allowing only explicit HTTPS web origins, emits secure HttpOnly cookies, HSTS and browser security headers, strips session tokens from responses, supports trusted-proxy client addresses, maintains per-client request/authentication limits, and exposes an aggregate `/health` response. It accepts the production OAuth callbacks only from the configured API origin. The provider adapter selects staging callback variables only for the staging database and production callback variables only for `seenary`, preventing a retained localhost variable from redirecting live authorization.

Production preflight requires `https://` API and web origins with no path/query fragments and exact `/auth/anilist/callback` and `/auth/mal/callback` paths on the API origin. The hosted shell test passed origin rejection, CORS preflight, client gating, secure-cookie/token handling, security headers, and health behavior. The existing disposable staging Atlas account/HTTP suite and production frontend build also pass.

No Hostinger start command, environment variable, database name, DNS record, or live traffic was changed in this checkpoint. Checkpoint 3 requires a fresh hosted snapshot and reconciliation before this entry point can be activated.

## Checkpoint 3 — fresh-data reconciliation

`npm run atlas:cutover -- reconcile --sqlite <snapshot> --source hostinger-main` is the strict counterpart to the dry-run rehearsal. It verifies every imported account field including the password hash, every provider identity/field and decrypted token, every canonical media identity and source field, and every personal library field against its migration receipt. It succeeds only when verified totals exactly equal source totals and every domain has zero conflicts. Output contains counts plus sanitized legacy IDs and reasons for conflicts, never passwords, hashes, tokens, notes, or title payloads.

The snapshot is hashed before and after all readers and checks, and SQLite is always opened read-only. If live SQLite changed since the earlier import, rehearsal reports the changed source records instead of overwriting Atlas. Those differences must be reconciled deliberately after the write freeze; changing the source name to bypass the conflict is prohibited.

`npm run atlas:cutover-diff -- diff --sqlite <snapshot> --source hostinger-main` classifies changed records by field path while suppressing every field value. This is used to distinguish expected live timestamps, refreshed credentials, and cache enrichment from identity or ownership changes before the final import policy is selected.

The fresh live snapshot downloaded on 2026-09-18 has SHA-256 `7e0275bf1238e4551e7e66cadd6aaca1fb2ed0133ff17c8c2799b64bfdfd505c`. Compared with the earlier snapshot, one account had login/update timestamp changes, its AniList link had a rotated access token and lifecycle timestamps, twelve existing anime had normal cache/airing/statistics enrichment, and nine canonical media records were new. There were no identity, ownership, password, library, progress, score, note, or favorite changes.

An encrypted 22-collection, 3,605-document staging backup was created before applying the delta. The explicit `stage` mode then refreshed the account and provider records with compare-and-swap migration fingerprints, preserved their Seenary ownership, refreshed twelve media records in place while retaining Atlas-only fields, and added nine media records. It did not create provider jobs or alter the 743 personal library entries. Ordinary import mode still rejects changed sources; only the explicit staging/final-refresh path accepts reviewed deltas.

Strict post-stage reconciliation verified 6/6 accounts, 5/5 provider links including decrypted credential equivalence, 688/688 canonical media records (685 anime and 3 manga), and 743/743 library entries with zero conflicts. Account, provider, media, and library disposable Atlas regressions all pass. Historical device-only favorites remain the previously accepted exception: this snapshot contains zero favorites and users may set them once more after cutover.

Checkpoint 3 is complete for staging. Because SQLite remains live until checkpoint 4, the final freeze must take another snapshot and rerun `rehearse`, the reviewed `stage` refresh, and `reconcile` before traffic switches.
