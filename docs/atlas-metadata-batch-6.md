# Batch 6: AniList metadata caching checkpoint

The opt-in Atlas renderer now requests anime/manga details, media search, initial discovery, expanded discovery shelves, and studio pages from the staging API's shared metadata cache. The production backend is unchanged. Checkpoints 1–2 used synthetic providers; checkpoint 3 additionally validates public AniList detail payloads.

## Storage and refresh policy

`media` keeps the permanent Seenary ID and personal libraries remain separate. `sources.anilist.details` stores merged API-shaped metadata, `sources.anilist.metrics` stores AniList scores/popularity, and `metadata` provides renderer-compatible title/card fields. MAL source data is preserved. A card/search response never renews the full-details clock. An older details response cannot overwrite newer card fields. Revision compare-and-swap protects concurrent changes to a canonical record.

Successful full details use release-aware freshness. Releasing anime with a known next episode refresh six days after the preceding release, then at 24, 12, and 6 hours before the next release, and hourly inside the final six-hour window. Releasing manga without a reliable chapter schedule refreshes every 6 hours. Upcoming titles and titles completed within the last 30 days refresh daily; older finished titles refresh every 30 days; hiatus, cancelled, and unknown states refresh weekly. Completeness requires the expected detail sections to be present. Partial responses can enrich stored data but cannot claim full-detail freshness. Missing/null values preserve known fields, including false/zero values supplied by a successful response. Connection arrays retain richer existing data when a smaller response is received; exhaustive relation removal/reordering is not inferred from capped provider connections.

`metadataQueries` stores provider response payloads, timestamps, refresh leases, and retry state. Search/discovery responses are fresh for one hour. Detail transport responses are retained for six hours; canonical detail completeness/freshness is checked independently. Records are not TTL-deleted, because stale data is useful during outages. Documents/responses exceeding a 12 MB storage budget are rejected before MongoDB's hard limit is reached.

Identical in-process refreshes share a promise. Persisted per-query leases reduce duplicate requests between API processes, and persisted retry times survive restart. Public metadata calls are serialized within this service and started at least 1.5 seconds apart. Existing AniList transport retry behavior remains; this is not yet the global, persistent cross-provider request budget planned for batch 8.

## Failure behavior

- A provider error or rate limit retains the prior response. Retry-After is honored up to 24 hours; other failures back off for five minutes.
- Saved details remain available when the provider cannot refresh them. A mismatched returned ID cannot populate another title.
- Search first serves the cached exact query. If absent, it performs a bounded literal title search over saved canonical media. Adult-filtered fallback includes only titles explicitly marked non-adult. Fallback is identified in the result warnings.
- Discovery uses cached responses when available; otherwise an explicitly labeled Saved catalog shelf is returned. A missing expanded ranking/page returns an empty page with a warning rather than presenting unrelated cached titles as that ranking.
- Browser-submitted metadata cannot update this shared cache. Only the backend provider adapter calls ingestion. A verified `idMal` may use the existing mapping workflow; a library-bearing merge conflict does not discard the metadata refresh.

## Validation

Run `npm run test:atlas-metadata` in backend. It uses an in-memory repository and a deliberately failing/mock AniList provider, plus real loopback HTTP calls. Tests cover single-flight reuse, freshness separation, preservation of richer metadata, canonical identity, independent provider metrics, stale reads, retry after restart, saved search/adult filtering, discovery fallback, partial and mismatched IDs, and authenticated HTTP access. These tests do not establish live Atlas connectivity or real provider response compatibility.

Frontend compilation/build and targeted lint checks also pass. Existing AniList query functions are reused through `anilistMetadataProvider.js`, avoiding a second set of GraphQL queries. The staging server initializes `metadataQueries` when next started against Atlas.

## Batch 6 verification

### Checkpoint 4 — capacity and retention review, 2026-09-17

Completed the read-only Atlas sizing report and sampled five real public AniList responses. The 679 canonical records total 2.85 MiB; no production query-cache workload exists yet. Documented warmed-catalog planning assumptions, query-cardinality growth, retention rules, storage thresholds, and explicit maintenance/monitoring rollout gates. See [capacity and retention review](atlas-metadata-capacity.md). Automatic cleanup belongs to batch 8 and is not claimed implemented here.

### Checkpoint 3 — verification, 2026-09-16

The hidden Chromium test now routes renderer metadata calls through the actual metadata cache service with an in-memory repository. It warms detail/search/discovery responses, expires their clocks, disables the provider, and verifies stable Seenary identity, stale responses, saved-catalog search, and suppressed retry requests. This browser test passed alongside the existing list/import checks.

Public AniList payload verification passed for anime ID 1 and manga ID 30002, checking the full-details fields used by completeness tracking. The initial probe incorrectly used anime-range ID 1 for manga; the corrected fixture passed. No account credentials or provider tokens are used for these public requests.

`scripts/atlas-metadata-integration.js` passed against Atlas with both synthetic and real public AniList payloads. Coverage includes BSON dates, service restart persistence, concurrent CAS updates, lost acknowledgement after commit (synthetic mode), stale fallback and persistent retry state. A subsequent synthetic run also passed contention between independent services sharing a persisted MongoDB refresh lease. All runs used disposable collections and completed cleanup. Run with `--live-provider` for real public details, or `--provider-only` without database writes.

Atlas initially failed TLS negotiation on all three hosts, and Compass also failed. Adding the current IP restored connection, authentication, and database reads, followed by the integration tests above. Subsequent Activity Feed screenshots showed different public IPs at cluster creation and reconnection; deletion or temporary expiry of the original entry was not established.

`scripts/atlas-tls-check.js` remains available for credential-free diagnostics. No TLS verification was disabled and no credential change was needed.

### Checkpoint 2 — 2026-09-16

Artist pages now cache AnimeThemes associations separately from AniList cards. Only cards fetched through the AniList adapter enter `sources.anilist`; artist/song/theme payloads cannot populate canonical title metadata. Cached associations can be combined with saved AniList titles when either provider is unavailable. Adult filtering remains explicit.

Authenticated AniList import preview fetches anime and manga collections and ingests only whitelisted public `entry.media` fields. Personal collection responses are never stored in `metadataQueries`. The requesting renderer receives personal fields for review, removes duplicate custom-list entries, and stages the user's selected statuses/media keys through the durable import review flow. No library write occurs until review is accepted. Seenary favorites are omitted from import patches, and partial dates are omitted instead of inventing a month/day. Preview memory is limited to the last preview for the active account and cleared on account changes.

Backend tests cover artist provenance and outage fallback, private note/score exclusion from shared storage, anime/manga deduplication, date handling, and authenticated preview/artist HTTP routes. Renderer browser coverage adds selection by media type/key, preservation of favorites, review-only staging, and cancellation.

Checkpoint 2 validation passed: `test:atlas-metadata`, `test:cloud-library`, targeted ESLint, frontend builds, and the hidden Chromium import/review regression. The initial browser attempt preceded completion of the staging build and timed out; the rerun after the build completed passed. No real provider calls, Atlas data mutations, or production deployment were performed in this checkpoint. Remaining live verification is not claimed complete.

- Actual Atlas persistence, real AniList detail payloads, independent-service lease contention, and interrupted acknowledgement recovery are verified above.
- MAL import ingestion remains with the MAL metadata work in batch 7. Artist pages and public AniList import previews are connected in checkpoint 2; background linked-account pulls still await their worker integration.
- Renderer outage checks passed. Checkpoint 4 completed the sizing/retention review; warmed production workload validation remains a cutover gate.

Checkpoints 1–4 are complete for staging implementation and review. Production rollout requires the maintenance, monitoring, and workload validation gates recorded in the capacity review. MAL metadata refresh/fallback remains batch 7; persistent refresh/outbox and cache maintenance workers remain batch 8.
