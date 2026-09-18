# Batch 7: MAL metadata caching

Work is divided into four checkpoints. Stop after each checkpoint and save the result here.

## Checkpoint 1 — storage foundation, completed 2026-09-17

`backend/atlas/malMetadata.js` adds an internal, provider-independent MAL ingestion service for anime and manga. It uses the existing canonical media collection, unique provider identity indexes, and revision compare-and-swap. It does not expose a browser write endpoint or call MAL yet.

- `sources.mal.details` holds explicitly projected public fields. Nested pictures, alternative titles, genres, and studios are projected too; personal list status, tokens, notes, and arbitrary added fields are excluded.
- `sources.mal.metrics` retains MAL's native mean (0–10), rank, popularity, list-user count, and scoring-user count. It does not populate AniList's metrics or convert a MAL score into an AniList score.
- `sources.mal.groups.card/details` have separate BSON freshness dates. Releasing titles use six hours, finished/discontinued titles seven days, and unknown/other states 24 hours. Cards cannot renew details freshness. Full-detail completeness requires synopsis, genres, status, and the appropriate episode/chapter/volume counts; invalid/null/missing fields do not satisfy it.
- `groupObservedAt` records observations including partial responses, separately from completeness. Older observations cannot undo newer observations of the same group; older details can supplement detail-only fields after a newer card without overwriting that card or its metrics.
- Missing/null values preserve previous data, shorter arrays retain richer arrays, and valid zero values are preserved. MAL-only identities remain usable without an AniList ID. Canonical compatibility fields are filled only where missing in this checkpoint; overwriting stale canonical fields under AL-first fallback is checkpoint 2.
- The service never replaces the entire media document, edits personal library records, or changes `sources.anilist`. It validates type/ID/group/time and enforces a 12 MiB BSON guard. Oversized incoming public metadata is rejected before creating a new identity.

Validation passed:

1. `npm run test:atlas-mal-metadata`: source isolation, stable identities, anime/manga separation, service recreation, merge preservation, independent freshness, zero values, personal-data exclusion, concurrent ordered observations, invalid inputs, and size rejection.
2. The same suite with `--atlas`: actual Atlas persistence, BSON dates, indexes, and concurrent CAS behavior. Uses random disposable `batch1_test_...` collections and removes them on completion; no imported account/library/catalog records changed.
3. Existing `npm run test:atlas-metadata` AniList and authenticated metadata-route regression suite.

No real MAL response compatibility or request scheduling is claimed tested in checkpoint 1. No production deployment occurred.

## Checkpoint 2 — fetching and fallback, completed 2026-09-17

`mal.getPublicMediaDetails` requests anime/manga public detail fields using the configured application client ID, without account tokens. It uses one bounded transport attempt; persisted cache backoff owns retries instead of sleeping through legacy transport retries while holding a lease. The previous mapping-oriented `getAnimeDetails` helper is unchanged.

`atlas/providerCache.js` now contains the existing AniList scheduling, single-flight, query lease, and retry logic, reused by `atlas/malMetadataCache.js`. MAL keys are namespaced `mal:details:<type>:<id>`. Successful query payloads contain only the canonical media reference, avoiding raw/personal response storage and duplicate MAL detail payloads. Canonical MAL completeness determines freshness; provider failures retain saved data. Retry-After is capped at 24 hours; other failures use five minutes. MAL and AL have separate in-process request queues and persisted per-key state. Global provider budgets and durable scheduling remain batch 8.

The opt-in staging server now supplies MAL fallback to the metadata service. Fresh complete AniList details take priority. If AL cannot refresh or returns stale data, a known MAL ID enables MAL refresh; otherwise the saved AL/catalog result remains. Negative renderer IDs fetch MAL-only anime/manga details, and known AL mappings route through AL-first reads. No new ID matching or duplicate reconciliation is introduced here.

MAL fallback promotes supported canonical fields through revision CAS, preserves missing/richer values, and leaves both providers' source records and clocks independent. Fresh AL fields are protected. MAL canonical field observation dates also prevent a new card or partial payload from promoting an old synopsis over newer AL metadata. A late MAL response cannot overwrite an AL recovery that completed while MAL was fetching. Canonical fields now drive the rendered common fields, retaining AL-only sections such as staff/characters/relations. MAL metrics are exposed separately under `providerMetrics.mal` in their native scale; `averageScore`/`meanScore` retain AL meaning.

Validation passed:

- MAL storage and fallback suites, including actual authenticated loopback HTTP requests, malformed/partial provider replies, missing IDs, persistent backoff/lease contention, provider isolation, AL recovery, and overlapping requests.
- Disposable Atlas fallback suite, including the final field-age regression; existing AniList Atlas integration after the shared-cache extraction. Test collections cleaned up; imported records untouched.
- Real public MAL anime ID 1 and manga ID 1 detail requests (`node scripts/atlas-mal-fallback-smoke.js --provider-only`), with no DB writes or user tokens. These verify transport/payload compatibility; the Atlas fallback suite uses synthetic payloads. Combined live-provider-to-Atlas validation remains checkpoint 4.
- Hidden Chromium renderer test: mapped MAL fallback, MAL-only manga details, same-ID AL recovery, plus the previous library/import/favorite regressions.
- Cloud-library tests, targeted renderer ESLint, TypeScript and both staging/normal frontend builds. Normal frontend output restored after browser verification. Existing bundle-size warning remains.

Reproduce local checks with `npm run test:atlas-mal-fallback`; add `-- --atlas` for disposable staging integration. Production was not deployed and no provider account lists were modified.

## Checkpoint 3 — matching and import, completed 2026-09-17

`atlas/malMapping.js` resolves MAL identities using AniList's exact `idMal` lookup and requires matching media type, MAL ID, and one unambiguous positive AL ID. Title similarity cannot attach IDs. Lookup results/misses are cached for 24 hours; provider failures use the shared persisted backoff/lease machinery. Requests with invalid or ambiguous evidence remain deferred. Details requests trigger asynchronous, request-driven resolution; this is not a durable background queue. Bulk resolution and persistent retry scheduling remain batch 8.

Successful mapping calls the existing transactional identity service with the original MAL Seenary ID as the survivor. Existing AL metadata is retained, and metadata-only duplicate records are redirected to that survivor. The transaction now permits the survivor to have library entries, provided the disappearing duplicate has none (including tombstones). Survivor entries, favorite flags, notes, history, and their media references are untouched. If a disappearing duplicate has personal entries, or IDs conflict, neither identity is consolidated: the resolver returns `review-required`, and the details page displays a warning. This checkpoint does not implement a manual editor that reconciles competing personal histories; those conflicts require explicit resolution before consolidation, never automatic guessing or deletion.

MAL-only detail reads remain available if matching is unavailable or no match exists. Once mapped, the same Seenary ID routes through AL-first detail reads. Anime/manga namespaces stay separate.

`atlas/malImport.js` previews public anime/manga lists through an authenticated staging route. It deduplicates each type, maps personal status/progress/volume progress/score/notes/repeats/complete dates into the user's response, and ingests only whitelisted public media fields into shared storage. It never writes personal list payloads into `metadataQueries`. Unknown AL mappings remain valid negative-MAL-ID entries. Missing/partial dates are omitted; favorites are omitted to preserve Seenary flags. Capped/incomplete lists are rejected rather than silently reported as complete; MAL transport list results now expose a `truncated` flag.

The staging renderer supports MAL preview/selection/cancellation through the existing durable review flow. Preview memory is keyed by provider and username and cleared on account changes. Selected rows preserve explicit external MAL IDs when handed to the backup/review parser. Preview and selection do not upload personal entries; users review them in Cloud saves. Matching imported MAL-only titles happens when their details are opened; bulk/background matching is not performed during preview.

Validation passed:

- Local MAL import and authenticated HTTP tests; existing MAL fallback and AniList metadata regressions.
- Disposable Atlas mapping/import tests: original ID preservation, duplicate redirects, survivor library preservation, library-bearing/conflicting duplicate deferral, cached misses, invalid-evidence backoff, anime/manga isolation, and on-demand AL details.
- Existing Atlas media identity/import/authentication regression after adjusting the transaction guard.
- Real AniList exact-MAL-ID probes for anime and manga, without DB writes.
- Hidden Chromium MAL import selection, cancellation, account/provider preview isolation, explicit MAL identity, private notes/zero scores, and review-only staging. The initial browser run caught a missing external MAL ID in the review handoff; the fixed rerun passed.
- Cloud-library tests, targeted renderer lint, and staging/normal builds. Normal output restored after browser checks.

Commands: `npm run test:atlas-mal-mapping`, add `-- --atlas` for disposable staging tests or `-- --provider-only` for public exact-ID lookup probes. No production deployment or provider list mutations.

## Checkpoint 4 — integration and review, completed 2026-09-17

`backend/scripts/atlas-mal-live-integration.js` closes the gap between the earlier provider-only and synthetic Atlas checks. In random disposable collections it fetched real MAL anime/manga ID 1 details, persisted them, resolved their exact AniList IDs through real AniList responses, and retained the original MAL-created Seenary IDs. It then fetched real AniList details, simulated AniList failure and refreshed from real MAL, recovered AniList on the same record, and simulated both providers failing to verify stale availability. Anime and manga with the same provider ID remained distinct.

The integration verified BSON freshness dates, independent source clocks, separate native metrics, provider priority, restart-safe retry state, and privacy. MAL detail cache rows held only canonical media references; mapping rows held only IDs. No MAL account token, list status, raw detail payload, or personal field entered the query cache. The two fully dual-sourced sample documents remained below the checkpoint's conservative 256 KiB planning assumption. The run created two media and six cache records, then removed all temporary collections.

The read-only staging capacity report was rerun. The imported baseline remains 679 media records using 2,985,685 logical BSON bytes (mean 4,397; p95 29,877; maximum 101,822). `metadataQueries` remains empty outside disposable tests. Real raw payload samples were 1,859 bytes for MAL anime ID 1 and 1,733 bytes for MAL manga ID 1, compared with roughly 40–49 KiB for sampled AniList details. MAL therefore does not require increasing the existing provisional 256 KiB warmed-title or 64 KiB query-record planning assumptions. The sample is small and does not replace production workload measurement.

Retention decisions:

- Canonical MAL metadata follows the same permanent identity rule as AL metadata and is never removed independently from the media record.
- MAL detail transport responses are not retained in `metadataQueries`; their tiny canonical references become eligible under the existing seven-day duplicate-details policy once canonical completeness is verified.
- Exact MAL-to-AL mapping hits and misses use the existing 24-hour query freshness. Retain mapping results for 30 days since last use for outage resistance, then allow bounded oldest-first eviction under the batch 8 maintenance policy. Active leases and unexpired retries remain protected.
- Metrics and source freshness remain embedded in canonical records. Cache cleanup cannot merge clocks, convert score scales, remove mappings/redirects, or touch personal libraries.
- Batch 8 must add query kind/created/last-access fields, byte-budget reporting, bounded cleanup, and persistent bulk mapping/synchronization. Batch 9 owns production alerts and restore rehearsal; batch 10 owns representative workload and Hostinger connectivity validation.

Final validation passed: all MAL storage/fallback/mapping/import suites; AniList metadata regression; cloud-library regression; existing Atlas media identity regression; real MAL and AniList provider probes; combined live-provider Atlas integration; authenticated HTTP routes; hidden Chromium fallback/recovery/MAL-only/import review flows; targeted lint; TypeScript and staging/normal builds. The browser test uses synthetic providers and an isolated in-memory browser profile. Existing bundle-size warnings remain unrelated.

Batch 7 checkpoints 1–4 are complete for staging implementation and review. Production was not deployed, imported staging data was not changed, and provider account lists were not mutated. Persistent workers, automatic cleanup, bulk resolution, manual reconciliation of conflicting personal histories, operational monitoring, and cutover remain in their assigned later batches.
