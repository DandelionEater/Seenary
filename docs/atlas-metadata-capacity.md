# Batch 6 checkpoint 4: capacity and retention review

Reviewed 2026-09-17 against `seenary_staging`. This is a measured storage review and growth model, not a production load test. No database records were written or removed.

## Measured baseline

The read-only `backend/scripts/atlas-metadata-capacity.js` reports byte counts only. It does not output titles, queries, credentials, or personal records. Run `npm run atlas:metadata-capacity` from backend; add `-- --sample-provider` to fetch five representative public responses. Use the existing process-only DNS workaround if local SRV resolution requires it.

| Measurement | Result |
| --- | ---: |
| Canonical media | 679 records |
| Canonical logical BSON size | 2,985,685 bytes (2.85 MiB) |
| Mean / p95 / maximum canonical record | 4,397 / 29,877 / 101,822 bytes |
| Persisted metadata queries | 0 |
| Entire database logical data | 7,346,815 bytes (7.01 MiB) |
| Database allocated storage | 6,729,728 bytes |
| Database indexes | 1,265,664 bytes |

Logical BSON, allocated storage, and index bytes are different measures; these figures do not establish the Atlas plan's remaining quota. The configured plan and its actual storage limit must be recorded during deployment preparation.

Public samples (measured as BSON `{ payload }`, excluding query bookkeeping): anime details for IDs 1 and 16498 were 44,217 and 49,107 bytes; manga details for 30002 were 40,846 bytes; `naruto` search was 19,502 bytes; discovery was 57,060 bytes. These responses fit comfortably below the existing 12 MiB per-document guard, but five samples cannot establish a worst-case bound. Canonical ingestion duplicates some provider fields into renderer-compatible metadata, and query payloads can duplicate media again.

Batch 7 reran the report with MAL samples: anime ID 1 was 1,859 bytes and manga ID 1 was 1,733 bytes. Combined real-provider Atlas integration kept the two dual-sourced canonical documents below the provisional 256 KiB warmed-title assumption. MAL detail query records store canonical references instead of raw responses. Exact mapping results add small ID-only records; their distinct requested IDs still contribute to query cardinality.

The imported catalog is mostly lightly populated metadata. Its 4.3 KiB mean must not be extrapolated as the cost of fully cached details. The empty query collection also means there is no observed production query-volume distribution yet; previous integration checks used temporary collections and cleaned them up.

## Growth model and decisions

- Use a provisional **256 KiB per fully warmed canonical title** and **64 KiB per query response** for planning, including duplicated fields but excluding indexes, replication, backups, and operational headroom. These are conservative planning assumptions relative to this sample, not enforced record limits. Recalculate using warmed-catalog measurements before cutover.
- At those assumptions, 1,000 warmed titles plus 1,000 query records consume about **312.5 MiB logical data**; 10,000 of each consume about **3.05 GiB**. Size the plan from the intended working set rather than the current imported baseline.
- Query cardinality is the main unbounded growth path. At the measured search response size, 1,000 distinct searches per day retained for 30 days would consume about **558 MiB of payloads alone**. Failed distinct requests also leave retry-only records. A per-document guard does not bound either total.
- Details, query pages, and canonical records have different retention needs. Freshness expiry must continue to trigger refresh rather than immediately destroy outage fallback.

## Retention policy for the batch 8 maintenance worker

This review defines the policy; automatic eviction is **not enabled** by this checkpoint. Scheduling, lease coordination, and maintenance implementation belong to batch 8. Do not introduce a blanket TTL on canonical media or query freshness.

| Data | Policy |
| --- | --- |
| Canonical media, IDs, mappings, and redirects | Keep permanently under existing identity rules; cache maintenance must never delete them or personal libraries. |
| Duplicate details transport payloads | Eligible after seven days without use, once canonical detail completeness is verified. Preserve canonical details and freshness. |
| MAL-to-AniList mapping hits/misses | Retain for 30 days since last use, then evict oldest eligible records. Preserve canonical mappings and redirects permanently. |
| Search, discovery, shelf, studio, artist associations/cards | Retain for 30 days since last use, including stale responses for outage fallback. Under storage pressure, evict oldest eligible responses first. Evicting associations/pages may remove that exact offline view; saved-catalog fallback cannot recreate every page. |
| Failure-only query records | Eligible after 24 hours without use, only after retry and lease deadlines have passed. |
| Active leases and unexpired retry state | Never remove while active, including under capacity pressure. |

Implementation requirements for batch 8: record query kind, creation time, and a throttled last-access time without storing raw search terms; add the corresponding maintenance index; use bounded batches and conditional deletes that recheck access/lease/retry state. Protect legacy records lacking timestamps until classified/backfilled. Support a dry run and report counts/bytes, never payloads. Tests must cover a concurrent refresh/access, service restart, retry protection, and canonical/library preservation.

## Operational checks carried into batches 8–10

Set an explicit query-cache byte budget and a total storage budget from the chosen Atlas plan. Check daily; alert at 60% of the storage allowance, act at 75%, and block rollout/expansion at 85% until capacity is restored or increased. Monitor logical query bytes, database storage/indexes, unique query growth, hit/stale/fallback rates, retry-only records, and provider throttling. These thresholds are deployment policy, not currently installed alerts.

Before production: implement and verify the maintenance policy in batch 8; configure alerts and rehearse backup/restore in batch 9; warm a representative working set, measure again, and verify Hostinger application connectivity during batch 10. Inspect saved-catalog search latency as the catalog grows: its case-insensitive substring fallback is bounded in returned rows, not necessarily in scanned records.

## Sign-off

Checkpoint 4's storage measurement and retention review are complete. Together with checkpoints 1–3, batch 6 is complete **for staging implementation and review**. This is not approval for production cutover or a claim that automatic cleanup, production monitoring, or sustained-load testing already exists. Batch 7 can proceed; the explicit worker/operations requirements above remain rollout gates in their assigned batches.
