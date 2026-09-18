# Atlas libraries and favorites: batch 4

Status: batch 4 completed in staging on 2026-09-14. All 743 anime library entries across 2 accounts were imported and verified, with 743 matching change events and valid per-user sequences. A second apply reported 743 unchanged and 0 inserted. Migration queued 0 provider jobs. The snapshot contains no manga entries and no set favorite flags; both media types and favorite preservation were tested with synthetic fixtures. Newer device libraries and favorites remain for batch 5 reconciliation; production still uses SQLite and device-local lists.

The source database remained unchanged (SHA-256 `A6644640B0DE5FD3084DF46AA0430A64BAAF0CD47CBB2E0B47FDDC4D61FCF236`). Batch 4 integration checks and batches 1–3 regression suites passed. No real provider requests were made.

## Library write contract

The loopback staging API started by `npm.cmd run atlas:accounts -- serve` supports `POST /rpc` with a Seenary session cookie. Private reads and writes derive the user from that session; callers cannot select another user ID.

```json
{
  "method": "mutateLibraryEntry",
  "args": [{
    "operationId": "a-new-uuid-for-this-edit",
    "mediaId": "permanent-seenary-media-uuid",
    "expectedRevision": 1,
    "action": "upsert",
    "patch": { "isFavorite": true }
  }]
}
```

Use revision `0` for a new entry. `patch` is partial: a favorite toggle preserves notes, progress, dates, and score. Accepted fields are `status`, `isFavorite`, `progress`, `volumeProgress`, `score`, `notes`, `startedAt`, `completedAt`, `repeatCount`, and `isRepeating`. Statuses retain the existing `planned`, `watching`, `completed`, `paused`, and `dropped` representation (manga also uses `watching` internally). Counts are nonnegative integers; scores are nullable numbers from 0 to 100 without rescaling imported values; notes allow up to 10,000 characters; dates are nullable valid `YYYY-MM-DD` values. Nonzero volume progress is manga-only.

Successful writes return the canonical entry, revision, per-user sequence, and separate provider-sync state. A reused operation ID returns its original committed result; reusing it for different contents returns `OPERATION_ID_REUSED`. A stale expected revision returns `REVISION_CONFLICT` with the current entry. The server does not silently select the largest progress or overwrite a favorite changed elsewhere.

For deletion, send `action: "delete"`, the current expected revision, and no patch. Deletion retains a revisioned tombstone. Stale edits cannot recreate it. Intentional restoration requires a new operation with the tombstone's current revision, `action: "upsert"`, and `restore: true`. No-op edits record their receipt without creating another change event.

Cloud mutations commit the entry, immutable change event, operation receipt, and any required provider outbox job in one MongoDB transaction. Library changes do not call providers. An external provider outage therefore cannot block a cloud save. A database failure while committing the outbox rolls back the whole transaction.

## Favorites and recommendations

`libraryEntries.isFavorite` belongs to the individual user/title relationship, independently for anime and manga. It is never stored as a global title preference. Partial progress edits preserve favorites, and partial favorite edits preserve progress.

`getFavoriteRecommendationSeeds` returns active, non-dropped favorites for the authenticated account. Seeds include Seenary/provider IDs, the existing recommendation-compatible `is_favorite`, `anime_id` or `manga_id`, status/score, and saved recommendation nodes. MAL-only favorites remain saved and are marked `needsAniListMapping` when an AL recommendation lookup is not yet possible.

Favorite-only edits do not create provider list jobs: this batch does not pretend ordinary AL/MAL list updates can synchronize provider favorites. The current frontend still reads device-local entries. Batch 5 will connect its list/recommendation views to these cloud records and reconcile newer device favorites explicitly. The supplied hosted snapshot's zero favorites is not evidence that the devices have none.

## Reads and cross-device consistency

| RPC | Arguments |
| --- | --- |
| `getLibraryEntry` | `[seenaryMediaId]` (returns active entry, tombstone, or null) |
| `getLibrarySnapshot` | `[{type?: "ANIME" or "MANGA", limit?: 1..200, cursor?: continuation}]` |
| `getLibraryChanges` | `[{cursor: changeCursor, limit?: 1..200}]` |
| `getFavoriteRecommendationSeeds` | `[{type?: "ANIME" or "MANGA", limit?: 1..200, after?: previousNextAfter}]` |

Start with a snapshot. Follow `nextCursor` until it is null, then use the snapshot's `changeCursor` for deltas. Snapshot pages reconstruct entries at a fixed committed sequence using immutable change events, so concurrent edits/additions/deletions cannot slip between pages. Snapshot tokens are random, user-bound, and expire after 30 minutes; continuation preserves the original type filter. Type-filtered snapshots produce correspondingly filtered deltas. Delta cursors carry a per-user library epoch and sequence, not device timestamps. Clients must treat cursors as opaque.

Expired snapshot tokens, wrong-user/epoch cursors, malformed cursors, or cursors outside the retained sequence window return `FULL_SNAPSHOT_REQUIRED`. Clients must reconcile a new snapshot before replaying queued edits; they must not substitute revision 0 for stale entries. Every delta includes the canonical entry/tombstone and sequence. Paginate while `hasMore` is true, then keep the returned `nextCursor` for the next poll.

Snapshot cursor documents have a TTL index. Change events, operation receipts, and tombstones intentionally have **no retention cleanup in this staging batch**. Before adding history pruning, implement a materialized snapshot baseline and agree an offline/idempotency retention window; deleting history directly would break the frozen snapshot protocol. This remains a production readiness decision.

## Storage and provider jobs

- `libraryEntries`: unique user + canonical media ID, full personal fields, revision, sequence, and deletion flag.
- `libraryState`: each user's ordered sequence and library epoch.
- `libraryChanges`: immutable full entry versions; unique user + epoch + sequence.
- `librarySnapshots`: temporary user-bound snapshot watermarks.
- `mutationReceipts`: repeat-safe operation fingerprints and committed responses.
- `libraryMigrationReceipts`: immutable source rows/fingerprints, user/media mappings, and import receipts.
- `jobs`: transactional provider-library outbox, including link ID, media ID, library revision, operation, and provider-supported list fields.

Jobs are created only when account auto-sync is explicitly enabled and a provider is linked. Missing provider title IDs produce `blocked_mapping`; otherwise the job is `pending`. Jobs contain no OAuth tokens. The import never creates provider jobs. Worker execution, ordering/coalescing, mapping resolution, and automatic retries are batch 8. A worker must check current link identity and library revision before sending; a captured token-refresh revision is not a reason to discard legitimate pending list work.

Account deletion now removes personal library entries, all history/snapshot/receipt documents, and private job payloads in its account transaction. Unlinking also cancels blocked-mapping jobs. No library history or notes are retained in a deleted account's outbox.

Media mapping resolves redirects before writes and serializes against identity reconciliation. Consolidating two media records that already have any library references (including tombstones) is rejected until an explicit personal-entry reconciliation is implemented. This prevents duplicate user/media rows or silently choosing between conflicting notes and progress.

## Import and verification

From `backend/`, using Node 24:

```powershell
npm.cmd run atlas:library -- setup
npm.cmd run atlas:library -- import --sqlite "D:\Downloads\media.db" --source hostinger-main
npm.cmd run atlas:library -- import --sqlite "D:\Downloads\media.db" --source hostinger-main --apply
npm.cmd run atlas:library -- verify --sqlite "D:\Downloads\media.db" --source hostinger-main
npm.cmd run atlas:library -- import --sqlite "D:\Downloads\media.db" --source hostinger-main --apply
```

The importer uses a read-only SQLite transaction and the account/media mappings from batches 1 and 3. Preflight checks fields, flags, timestamps, missing/deleted accounts, media identities, and duplicate entries mapping to the same title. It never overwrites an existing cloud entry without a matching prior import receipt. Imports commit groups of at most 40 entries for one user, including their change-feed events and receipts, while preserving original creation/update/local-activity timestamps.

Repeat imports skip unchanged fingerprints and preserve subsequent cloud edits, including favorite toggles. A changed source row or collision is reported for review. Verification compares all imported personal fields and dates; later intentional cloud changes appropriately cause differences. Deleting an account prevents its old entries from being imported again. A fresh hosted snapshot and explicit device reconciliation are still needed before production cutover.

The known local DNS workaround can be applied only to the current process:

```powershell
node -e "require('node:dns').setServers(['1.1.1.1','8.8.8.8']); process.argv=['node','atlas-library','import','--sqlite','D:/Downloads/media.db','--source','hostinger-main']; require('./scripts/atlas-library');"
```

## Tests

`npm.cmd run test:atlas-library` uses disposable Atlas collections and synthetic SQLite fixtures. It covers two-device favorite persistence, account isolation, repeated/concurrent operations, revision conflicts, partial updates, no-op edits, date/type validation, frozen and type-filtered pagination during writes, deltas, expired/wrong-user cursors, deletion/restoration, AL/MAL-only recommendation seeds, atomic outbox rollback, favorite-only no-job behavior, import/rerun preservation, long-note HTTP requests, and complete private-library deletion.

Batch 1 account, batch 2 provider, and batch 3 media regression suites also passed after the cross-batch changes. No real provider APIs were contacted.
