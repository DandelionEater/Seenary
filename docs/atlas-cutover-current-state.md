# Atlas cutover continuation state

Updated: 2026-09-18 after Batch 10 checkpoint 3.

## Completed and verified

- Batches 1–9 are complete in staging.
- Batch 10 checkpoints 1–3 are complete.
- Latest live SQLite snapshot: `D:\Downloads\media (1).db`.
- Snapshot SHA-256: `7e0275bf1238e4551e7e66cadd6aaca1fb2ed0133ff17c8c2799b64bfdfd505c`.
- Strict staging reconciliation: 6 accounts, 5 provider links, 688 media records, 743 library entries, zero conflicts.
- The reviewed delta refreshed one account, one AniList link, and 12 media records; it inserted 9 media records. Seenary IDs and all 743 library entries were preserved.
- Encrypted pre-refresh staging backup: `backend/.cutover-backups/pre-fresh-stage-2026-09-18.seenary-atlas`.
- Its one-time local key is `backend/.cutover-backups/rollback-key.txt`. Both are ignored by Git. Do not delete them until the cutover recovery window closes.
- Account, provider, media, library, operations, client-gate, hosted-HTTP, cloud-library, analytics, storage-ownership, and frontend build checks passed during Batches 9–10.

## Production state — do not infer completion

- Hostinger still starts the legacy SQLite `server.js` through `npm start`.
- SQLite writes have not been frozen.
- Production traffic has not switched.
- The compatible-client gate is not enabled.
- No final-freeze snapshot has been taken.
- The `seenary` production Atlas database has not been populated or verified by the Batch 10 final sequence.
- `ATLAS_BACKUP_ENCRYPTION_KEY` is not configured in the local `.env`; the checkpoint-3 backup used the one-time ignored key above. Production needs a persistent key in Hostinger's secret store and a separately retained recovery copy.

## Final checkpoint order

1. Finish production-target support and test it without writing production.
2. Prepare exact Hostinger environment/start-command changes and rollback commands. Keep `npm start` active.
3. At the approved maintenance window, freeze legacy writes and download a new final `media.db`.
4. Hash and read-only rehearse the final snapshot using stable source `hostinger-main`.
5. Take an encrypted backup of the target Atlas database.
6. Run the explicit final refresh/import, then strict reconciliation. Stop on any conflict or count difference.
7. Run production deployment validation, aggregate health, provider/worker smoke checks, and backup restore rehearsal.
8. Deploy a compatible client, start the Atlas API and worker, initially use client-gate `observe`, then switch traffic.
9. Verify login, library read/write, provider link/refresh, metadata fallback, analytics consent, health, and worker queues with a small cohort.
10. Enable client-gate `enforce` only after compatible-client adoption is confirmed. Retain the SQLite snapshot, previous deployment, and both backup keys through the recovery window.

Rollback before any post-cutover Atlas-only writes: switch Hostinger back to `npm start` and restore the previous deployment. Rollback after Atlas-only writes requires exporting/replaying those writes first; never switch SQLite back to authority silently.
