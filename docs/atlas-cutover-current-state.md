# Atlas cutover continuation state

Updated: 2026-09-18 during Batch 10 checkpoint 4.

The production Atlas backend is live at `https://api.seenary.app`. Commit `de223ab` is deployed with Hostinger configured to use `backend/atlas-server.js`. The public `/health` endpoint returned HTTP 200 with `ok: true`, healthy storage, and `worker.running: true`.

## Completed and verified

- Legacy SQLite writes are frozen with `LEGACY_WRITE_FREEZE=true`.
- Final server snapshot: `/home/u145628270/domains/api.seenary.app/data/media-final-cutover.db`.
- Local copy: `D:\Downloads\media-final-cutover.db`.
- Final SHA-256: `7a0acd4763cc833eba9ded27319cb4984209d2049649b02294b9a8a0c6af44a9`.
- Final production import into Atlas database `seenary`: 6 accounts, 5 provider links, 695 media records, and 743 library entries, with zero conflicts.
- Strict production reconciliation passed, including decrypted provider credential equivalence.
- Encrypted post-import backup: `backend/.cutover-backups/production-post-import-2026-09-18.seenary-atlas`.
- Backup contains 22 collections and 3,637 documents. Restore rehearsal passed and its disposable namespaces were removed.
- Local recovery keys are retained in the ignored `backend/.cutover-backups/` directory.
- Production preflight passed all 17 checks.
- Hostinger has the production MongoDB, encryption, budget, origin, proxy, and client-gate environment values.
- `ATLAS_CLIENT_GATE_MODE=observe`; compatible clients are observed but older clients are not blocked.
- The Hostinger wrapper startup issue was fixed in commit `de223ab`. Syntax and hosted production HTTP smoke tests passed before deployment.
- Live backend health at 2026-09-18T20:26:29Z: HTTP 200, Atlas storage 9,191,424 bytes of a 536,870,912-byte budget, query cache within budget, no overdue leases, worker running.

## Remaining cutover work

The frontend domain switch from commit `aca22ef` is deployed. `web.seenary.app` serves the matching production bundle, the API preflight accepts that origin with credentials, and a live read-only `getSession` request returned HTTP 200 with the expected unauthenticated result.

1. Run a small live cohort check: login, library read, one reversible library write, provider status/refresh, and analytics consent behavior.
2. Inspect API health and worker queues after that write.
3. Keep the client gate in `observe` through the recovery window. Enable `enforce` only after compatible-client adoption is confirmed.
4. Retain the frozen SQLite snapshot, previous deployment, encrypted backups, and recovery keys until the recovery window closes.

Rollback before any post-cutover Atlas-only writes: set Hostinger's backend entry file back to `server.js` and redeploy; legacy SQLite will remain read-only. Rollback after Atlas-only writes requires exporting and replaying those writes first. Never restore SQLite as writable authority silently.

## Security follow-up

The analytics report password was visible in a setup screenshot shared in the conversation. Rotate that password in Hostinger after the service and frontend are stable.

## Live cohort findings

- Password login and the migrated cloud library load successfully for the first production cohort account.
- Its first manual AniList reconciliation completed on 2026-09-18 with 373 entries added or updated, 256 already current, and zero mapping reviews. The resulting active library contains 607 anime and 23 manga. AniList reported 606 anime, so the extra Seenary anime was preserved under the append-without-delete policy.
- The first reconciliation took about 2 minutes 46 seconds. The follow-up UI change returns immediately while reconciliation continues, refreshes the cloud library after completion, and deduplicates clicks made while a request is active.
