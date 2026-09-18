# Atlas shared media: batch 3

Status: batch 3 completed in Atlas staging on 2026-09-13. Imported 677 anime and 2 manga records (679 total), with 2 confirmed MAL IDs and no conflicts/orphan references. All 679 canonical identities, metadata/source fields, and retained source snapshots verified successfully. A second apply imported 0 and reported all 679 unchanged. Production still uses SQLite.

The source database remained unchanged (SHA-256 `A6644640B0DE5FD3084DF46AA0430A64BAAF0CD47CBB2E0B47FDDC4D61FCF236`). Media integration tests and account-route regression tests passed. No real provider requests or personal-library imports were performed.

## Canonical records

`media` uses a permanent UUID string in `_id` as the Seenary media ID. Each record has `type` (`ANIME` or `MANGA`) and optional numeric `anilistId` and `malId`. Unique partial indexes on `(type, anilistId)` and `(type, malId)` prevent duplicate provider identities while allowing missing IDs. An anime and manga can use the same provider number without colliding.

`metadata` retains the shared legacy fields, including parsed list-valued JSON, tags, staff, and characters. It currently retains legacy field names; frontend/provider normalization is later cache work. Provider scores/popularity are stored under `sources.anilist.metrics`; rich manga provider responses are retained under `sources.anilist.details`. Legacy cached/updated timestamps are retained as source information with completeness `legacy-unknown`: importing a row is not a new provider fetch and does not establish full-detail freshness.

Every imported source row, related detail rows, and external-ID mapping is also preserved in an immutable `mediaMigrationReceipts.snapshot` with a fingerprint and target Seenary ID. Personal progress/notes and provider credentials are not part of these shared media records. Relations within saved provider payloads retain their original provider IDs; they are not silently rewritten as Seenary IDs.

The supplied snapshot has no anime external-ID mappings and lacks the optional `manga_external_ids` table. Both saved manga detail responses contain `idMal`; those IDs are imported after checking that the detail response's AniList ID and media type agree with the owning row. Missing anime MAL IDs remain absent. No provider requests or title-name matching were used to fill gaps.

## Identity operations

`createMediaService` exposes internal backend methods:

- `ensure(type, provider, id)` finds or creates an AL-only or MAL-only record. A unique-index race returns the existing identity.
- `byProvider(type, provider, id)` resolves a provider mapping.
- `resolve(seenaryId)` resolves the canonical record, including previous duplicate IDs.
- `attachVerifiedMapping(seenaryId, evidence)` attaches a backend-verified AniList `idMal` mapping in a transaction. Conflicting IDs and media types are rejected. There is no client-facing mapping-write endpoint.

The requested Seenary record remains the survivor when attaching a mapping. If another record already owns the confirmed provider ID, the operation consolidates metadata, prefers AniList metadata over a MAL-only record, updates import references, and creates a `mediaRedirects` record from the duplicate ID to the survivor. The duplicate's full record is retained inside that redirect for review. Existing redirects are shortened and reads follow redirects with cycle/length checks.

Library reads/writes resolve canonical IDs through this layer. Redirects preserve old references; they do not silently combine two personal entries or choose between conflicting progress/notes. Batch 4 now blocks consolidation of two records with existing library references until explicit personal-entry reconciliation is implemented. The media merge never deletes personal library rows.

## Staging API

The existing loopback staging server (`npm.cmd run atlas:accounts -- serve`) now supports authenticated reads:

| RPC method | Arguments |
| --- | --- |
| `getMedia` | `[seenaryId]` |
| `resolveMedia` | `["ANIME" or "MANGA", "anilist" or "mal", numericProviderId]` |

Responses contain `{ok: true, media: recordOrNull}`. Full frontend search/details integration and refresh policies remain batches 6–8.

## Migration commands

From `backend/` using Node 24:

```powershell
npm.cmd run atlas:media -- setup
npm.cmd run atlas:media -- import --sqlite "D:\Downloads\media.db" --source hostinger-main
npm.cmd run atlas:media -- import --sqlite "D:\Downloads\media.db" --source hostinger-main --apply
npm.cmd run atlas:media -- verify --sqlite "D:\Downloads\media.db" --source hostinger-main
npm.cmd run atlas:media -- import --sqlite "D:\Downloads\media.db" --source hostinger-main --apply
```

The importer reads a consistent, read-only SQLite transaction; validates source identity, JSON, provider mapping consistency, size, and orphan references; and preflights all rows before writes. Imports commit in groups of up to 40 records with their receipts. Interrupted imports resume without duplicating successful groups. Existing records are enriched only where values are missing; existing conflicting MAL identity ownership requires explicit reconciliation.

Reruns skip unchanged source fingerprints. Changed source rows are reported instead of overwriting cloud edits. Verification checks canonical IDs, provider IDs, retained snapshots, and all imported metadata/source fields; intentionally updated metadata may therefore differ in a later verification and needs review.

If this machine needs the already-observed process-local DNS workaround:

```powershell
node -e "require('node:dns').setServers(['1.1.1.1','8.8.8.8']); process.argv=['node','atlas-media','import','--sqlite','D:/Downloads/media.db','--source','hostinger-main']; require('./scripts/atlas-media');"
```

## Validation

`npm.cmd run test:atlas-media` uses synthetic SQLite data and uniquely named disposable Atlas collections. It verifies concurrent identity creation, anime/manga separation, AL/MAL-only records, evidence validation, in-place mapping, duplicate redirects/reference preservation, unique indexes, source read-only behavior, metadata preservation, missing optional tables, receipts/reruns, corrupt-field detection, conflict/orphan preflight, authenticated reads, and absence of a public mapping-write endpoint.

Account/provider state is not changed by media import. The next batch is cloud libraries; no personal list entries are migrated here.
