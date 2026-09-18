# Batch 8: workers and provider synchronization

Work is divided into four checkpoints. Each checkpoint ends with a saved test result and handoff.

1. **Persistent worker foundation:** durable job leases, per-user/provider/title locks, bounded claiming, coalescing, exponential backoff, restart recovery, and fencing of late owners.
2. **Provider delivery:** decrypt/refresh linked credentials, translate AL/MAL library writes, respect provider budgets, revalidate link/library revisions, and cancel work after unlink.
3. **Inbound refresh and mapping:** scheduled linked-list pulls, conflict handling, bulk MAL-to-AL resolution, and ordered reconciliation without overwriting newer cloud edits.
4. **Cache maintenance and sign-off:** query access metadata, bounded dry-run cleanup, byte budgets, restart/outage integration, and batch-wide Atlas/renderer verification.

## Checkpoint 1 — persistent worker foundation, completed 2026-09-17

The existing transactional outbox remains the source of provider-library jobs. `atlas/jobWorker.js` adds the first consumer foundation without making provider requests. A unique scope lock serializes work for one user/provider/Seenary title across worker processes. Job leases and lock leases share an opaque owner token; completion, retry, renewal, and cancellation are fenced by that token. Expired running jobs are recoverable after a restart.

When several active revisions exist for one scope, only the newest is claimed and older active revisions are cancelled as superseded. Claims are bounded to 100 and scan a bounded candidate window. Retry delay starts at 30 seconds, doubles to a six-hour cap, honors Retry-After up to 24 hours, and stops after a configured attempt limit. Stored errors are enum-like codes only, not provider bodies, tokens, notes, or exception messages.

`jobLocks` is separate from provider tokens and library entries. Locks carry user/provider/media fields so unlink and account deletion remove them transactionally with queued work. It has no TTL deletion because an expired lock must be safely replaceable rather than disappearing during inspection; later maintenance may remove old unlocked state. Provider delivery and validation begin in checkpoint 2.

Validation passed:

- Local worker test: newest-revision coalescing, bounded claims, cross-worker scope exclusion, renewal, expired-lease restart recovery, fencing of late completion, persisted Retry-After, terminal attempts, cancellation, and error-message exclusion.
- The same test against random disposable Atlas collections and real indexes. All test collections were removed.
- Full disposable Atlas library regression: two-device consistency, atomic outbox creation/rollback, mapping blocks, imports, authenticated routes, and removal of private library/outbox/lock data on account deletion.
- Full disposable provider lifecycle regression: link ownership, encrypted credentials, refresh/unlink race, settings, migration reruns, and non-resurrection after unlink/deletion.
- Existing AniList metadata regression after extending its in-memory collection helper for worker tests.

Checkpoint 1 does not execute provider writes or start a background process. It establishes the persistence and ownership contract that checkpoint 2's delivery loop will use. Nothing was deployed and existing staging jobs were not claimed.

## Checkpoint 2 — provider delivery, completed 2026-09-17

`atlas/providerDelivery.js` consumes fenced claims and translates the current cloud entry at delivery time. AniList receives its 0–100 score and AniList status enum; MAL receives a 0–10 score plus anime/manga-specific progress and repeat fields. Deletes use the providers' idempotent delete helpers. Queued payloads are never trusted as current state.

Every external mutation is preceded by checks for the exact user, active provider link, auto-sync policy, Seenary media identity, current provider mapping, media type, deletion state, and exact library revision. Disabled sync, unlink, mapping changes, and newer cloud revisions cancel the claimed job without a provider call. Completion, retry, and cancellation still pass through checkpoint 1's owner fence.

MAL access tokens are decrypted only in memory. Expiring credentials use the existing persistent refresh lease; rotations are encrypted before storage and advance the link revision. Authentication rejection marks the link for reauthorization. Refresh and list mutation each reserve their own slot in `providerBudgets`, a persistent per-provider compare-and-swap clock shared by worker processes. A busy budget or Retry-After response becomes a durable retry, while stored failures contain enum-like codes only.

`scripts/atlas-worker.js` is the explicit operational entry point. `--once` runs one bounded batch and `--watch` repeats bounded batches with graceful SIGINT/SIGTERM shutdown. It prints aggregate outcome counts without identifiers, entries, provider bodies, or tokens. It has not been started against staging or production jobs during this checkpoint.

Validation passed:

- Local provider-delivery test: AL/MAL translations, manga fields, encrypted MAL refresh rotation, disabled/unlinked/superseded/remapped cancellation, terminal authentication handling, error-body exclusion, bounded batches, and shared provider budgets.
- The same synthetic-provider test against random disposable Atlas collections and strict validators. It made no AniList or MAL requests and removed all test collections.
- Checkpoint 1 worker regression locally and against disposable Atlas collections.
- Full disposable Atlas library and provider lifecycle regressions, including atomic outbox behavior, account deletion, refresh/unlink races, and safe adapter construction.

No real provider list was changed, no existing staging job was claimed, and no worker was deployed. Checkpoint 3 adds inbound linked-list refresh, bulk MAL-to-AL mapping, and conflict reconciliation.

## Checkpoint 3 — inbound refresh and mapping, completed 2026-09-18

`atlas/providerInbound.js` adds persistent per-link refresh schedules with leases, retries, shared provider budgets, encrypted MAL credential refresh, and bounded list pulls. AniList and MAL anime/manga list fields are normalized into the 0–100 Seenary score model. Provider list absence is not interpreted as deletion: an incomplete, stale, or temporarily filtered response cannot erase a cloud entry.

Each pull records its observation start. Reconciliation preserves favorites, does not enqueue an outbound echo, and only commits if the cloud entry has not changed since that observation and its exact revision still matches. Remote update timestamps prevent old provider results from replaying. AniList observations take precedence over older MAL observations. Every accepted change receives a library sequence and normal change-feed event, so devices observe inbound edits in the same ordered stream as cloud edits.

MAL IDs are resolved through exact AniList `idMal` queries in batches of at most 50. Verified pairs attach to the existing Seenary identity. Missing results remain valid MAL-only records; ambiguous mappings and library-bearing duplicates remain preserved for review. Unlink, account deletion, disabled sync, expired leases, restart recovery, and provider backoff are represented in persistent state rather than process memory.

Validation passed locally and against disposable Atlas transactions with synthetic providers: scheduled AL/MAL pulls, field normalization, exact bulk mappings, manga progress, cloud-edit-during-pull conflict fencing, favorite preservation, ordered change events, and absence of outbound echo jobs. No real provider list was fetched or changed.

## Checkpoint 4 — cache maintenance and Batch 8 sign-off, completed 2026-09-18

Shared query records now store a coarse query kind, creation time, throttled last-access time, and an access revision. Raw search terms remain represented only by the existing SHA-256 record key. The maintenance index supports kind/access ordering without TTL deletion. Legacy unclassified records remain protected.

`atlas/cacheMaintenance.js` implements the Batch 6 retention policy in bounded batches: canonicalized duplicate detail payloads after seven unused days, mapping results and query pages after 30 unused days, and failure-only records after 24 unused hours. Active leases and unexpired retry state are always protected. Conditional deletion rechecks the access revision, so a refresh or read that races cleanup wins. Reports contain counts and BSON byte totals only. Dry run is the default in `atlas:cache-maintenance`; applying cleanup requires `--apply`.

The operational worker now runs bounded outbound delivery and inbound refresh cycles. `--maintenance` enables a daily bounded maintenance pass and requires `ATLAS_QUERY_CACHE_BYTE_BUDGET`; deployment remains an explicit later step. `--once` and `--watch` remain explicit, and SIGINT/SIGTERM close Atlas cleanly.

Final validation passed:

- Local and disposable-Atlas inbound refresh and cache-maintenance suites, including restart continuation, dry run, byte accounting, retention classes, and concurrent access/lease/retry fencing.
- All checkpoint 1 and 2 worker/delivery tests plus the AniList metadata cache regression.
- Full disposable-Atlas library, provider lifecycle, and metadata outage/restart regressions.
- Renderer cloud-library durability test, staging production build, and hidden Chromium test covering IndexedDB restart recovery, favorites, account isolation, provider fallback/recovery, and import review.

All four Batch 8 checkpoints are complete in code and synthetic/disposable staging verification. No worker was deployed, no existing staging job was claimed, no real linked list was pulled, and no real AL/MAL entry was written. Production configuration, monitoring, deployment, and controlled cutover remain in batches 9 and 10.
