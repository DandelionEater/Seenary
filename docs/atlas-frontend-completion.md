# Atlas frontend completion plan

This document tracks the remaining consumer-facing work for the Atlas migration on the `atlas-migration` branch. A checkpoint is complete only when its acceptance checks pass in both the hosted web app and the packaged desktop app where applicable.

## Current contract

- Atlas is the source of truth for Seenary accounts, library entries, favorites, settings that roam between devices, and provider connections.
- AniList remains the preferred metadata and provider-update source. MyAnimeList supplies mapped metadata and provider updates when AniList is unavailable.
- One Seenary entry owns its Seenary ID and may gain AniList and MyAnimeList IDs over time. Refreshes merge newly available fields and do not replace the entry.
- Browser storage is an offline cache and durable change queue. Temporary API failures must never look like deleted cloud data.
- No branch is pushed or deployed until its checkpoint has been reviewed and explicitly approved.

## Checkpoint 1 — Application shell and recovery

**Status:** Complete

- Restore sessions without blocking the application shell on a full library refresh.
- Keep the last visible library during API restarts, timeouts, and partial failures.
- Distinguish loading, offline, stale, retrying, and confirmed-empty states.
- Retry safely on reconnect, focus, and explicit user action without duplicate alerts.
- Make the Cloud saves indicator describe the current state and open a useful recovery view.

**Acceptance:** A simulated backend restart cannot turn a populated library into a zero-entry screen; cached data remains usable; recovery refreshes both lists; repeated failures produce one notification.

**Completed:** Library hydration is atomic per media type, concurrent refresh triggers share one request, stale data remains visible, reconnect/focus/manual retry paths recover safely, and the shell plus Cloud saves indicator expose loading, offline, unavailable, retrying, and current states. Regression coverage verifies failed hydration cannot masquerade as a confirmed empty library.

## Checkpoint 2 — Accounts and authentication

**Status:** Complete

- Complete local login, registration, logout, session expiry, and password setup.
- Complete AniList and MyAnimeList sign-in flows, including first-time Seenary account creation.
- Give every failed login or callback an actionable error instead of a generic message.
- Verify account switching never exposes another account's cached library.

**Acceptance:** Every supported sign-in route succeeds on web and desktop, handles cancellation, and returns to the intended screen.

**Completed:** Local registration, login, logout, session restoration, expiry handling, and provider-created password setup use the Atlas account contract. AniList and MyAnimeList login now start inside a first-party API popup, return a token-free result through a verified message, support first-time Seenary username creation, report blocked/cancelled/timed-out/failed authorization clearly, and isolate cached data across account changes and in-flight refreshes.

## Checkpoint 3 — Provider connections and synchronization

**Status:** Complete

- Finish link, unlink, reauthorization, transfer, merge, and conflict-resolution screens.
- Show provider identity, last successful update, queued changes, failures, and retries.
- Complete manual inbound updates and outbound delivery controls for both providers.
- Replace placeholder progress callbacks with job progress and stop zero-change sync noise.

**Acceptance:** Users can connect either provider, understand exactly what will change, follow long jobs, and recover from a failed or expired connection.

**Completed:** AniList and MyAnimeList can be linked concurrently with independent ownership, reauthorization, unlinking, inbound refresh, and outbound delivery. AniList remains the preferred inbound source while MAL supplies fallback updates. The UI reports both targets, background pull progress, last import state, queued/completed/failed/excluded jobs, and supports excluding or restoring unfinished delivery work. Library mutations enqueue each linked provider independently without echoing inbound updates.

## Checkpoint 4 — Cloud library editing

**Status:** Complete

- Verify anime and manga create, edit, remove, progress, score, notes, repeat count, dates, and favorites.
- Integrate revision conflicts and pending changes into the normal list-entry flow.
- Make offline edits, reconnect delivery, tombstone restoration, and multi-device conflicts understandable.
- Fold the separate Cloud saves review surface into the application navigation and visual system.

**Acceptance:** Editing survives refresh, restart, lost acknowledgements, offline use, and a conflicting edit from another device without silent data loss.

**Completed:** Anime and manga editing covers status, progress, volume progress, score, notes, dates, repeat state, favorites, and deletion. Edits are durably queued before acknowledgement, pending state appears in the regular editor, deletion conflicts remain discoverable, and revision conflicts can keep cloud values or rebase the exact device patch from the normal title flow. The same queue handles offline reconnect, lost acknowledgements, tombstone restoration, and account-isolated multi-device changes.

## Checkpoint 5 — Imports, backups, and repair

**Status:** Complete

- Finish AniList, MyAnimeList, text, PDF, and portable-backup previews and review flows.
- Show background-job progress for large imports and allow safe resume after navigation or restart.
- Complete portable export/restore and cached-data repair for web and desktop.
- Preserve Seenary-only fields, especially favorites and notes, during provider imports.

**Acceptance:** Each source can be previewed, selectively applied, interrupted, resumed, and verified without deleting fields absent from that source.

**Completed:** AniList, MyAnimeList, text, and PDF imports use the existing preview and per-title selection UI, then enter the same durable Cloud saves review queue. Review decisions and queued uploads are checkpointed in IndexedDB and survive navigation, reload, restart, and interrupted delivery. Provider and file imports patch only fields present in their source, preserving Seenary favorites, notes, and other absent fields. Portable exports include the cloud snapshot, unresolved edits, import progress, app settings, and portable preferences; both legacy v1-v4 backups and current account-bound cloud backups are inspected before restore and staged for per-entry review. Preferences can be restored separately. Cached title data can be rebuilt from Atlas without clearing the library, pending edits, import candidates, settings, or provider state. Text/PDF request sizes are bounded, previews require an authenticated account, and the Atlas service loads no SQLite persistence code for preview-only work.

## Checkpoint 6 — Settings, privacy, and account controls

**Status:** Complete

- Classify settings as roaming, device-only, or desktop-only and label them clearly.
- Complete analytics consent and confirm it persists to the intended scope.
- Implement account data export and account deletion against Atlas.
- Require clear confirmation and password checks for destructive operations.

**Acceptance:** All visible controls work against Atlas or are deliberately hidden; destructive actions state their scope and are covered by recovery checks.

**Completed:** Settings now identify account-scoped controls, portable device preferences, desktop-only controls, and mixed sections. Portable appearance, content, navigation, and layout preferences remain device-local and backup-ready; provider links, automatic sync, analytics consent, privacy export, and account lifecycle controls use Atlas; Electron-only startup, window, update, and shortcut controls remain capability-gated. Analytics consent is written to and hydrated from the account, and opting out removes retained account-linked daily analytics rows. The privacy export downloads Atlas account, library, provider-link metadata, sync, and settings records after removing credentials, tokens, leases, legacy fingerprints, and other private operational fields. Account deletion requires the exact username and current Seenary password, rejects incorrect credentials, erases personal Atlas collections and retained daily analytics, revokes sessions and provider work, removes the deleted account's local IndexedDB and settings cache, and clearly states that external AniList/MAL accounts and installation-wide preferences are unaffected.

## Checkpoint 7 — Browse, details, and metadata fallback

**Status:** Complete

- Verify search, discovery shelves, title details, staff, characters, studios, artists, and music.
- Show when cached metadata is being used and retry cleanly when providers recover.
- Verify AniList-first refresh, MyAnimeList fallback, ID attachment, and append-only field enrichment in the UI.
- Handle missing mappings and partial metadata without broken pages.

**Acceptance:** Browse and details remain usable during a provider outage and refresh into the same Seenary entry when more identifiers or fields become available.

**Completed:** Search, discovery, paged shelves, Anime and Manga details, studio catalogs, artist catalogs, character profiles, staff profiles, and AnimeThemes music now use authenticated Atlas metadata routes. Public provider responses are cached independently with bounded retry/backoff behavior; saved searches and the canonical Seenary catalog remain available during outages. Detail, discovery, studio, artist, person, and music surfaces identify saved or fallback data instead of silently presenting it as live. AniList remains the preferred source, verified AniList/MAL IDs attach to the same Seenary record, MAL fills supported gaps during AniList outages, and AniList resumes automatically on recovery without replacing the Seenary ID or personal history. Partial responses append available fields without clearing richer cached arrays, MAL-only titles remain usable, and conflicting or missing mappings return preserved entries with review warnings instead of broken detail pages.

## Checkpoint 8 — Release polish and validation

**Status:** Implementation and automated validation complete; final manual release checks pending

- Remove staging and migration language from consumer screens.
- Audit empty, loading, success, warning, and error states across responsive layouts.
- Complete keyboard navigation, focus handling, labels, contrast, and reduced-motion checks.
- Run hosted-web and packaged-desktop journeys for fresh and migrated accounts.
- Bump to `0.2.0-beta`, build artifacts, validate update metadata, and finish release notes.

**Acceptance:** The full release check passes, manual OAuth and large-library checks are recorded, artifacts install and update correctly, and deployment requires an explicit final approval.

**Completed:** Consumer-facing staging wording has been removed, unsupported Atlas API calls now fail visibly during development, and reduced-motion preferences are honored globally. Windows and Linux release builds explicitly compile the Atlas production client against `https://api.seenary.app`. Seenary is versioned as `0.2.0-beta`; the complete automated release-readiness suite passes 20 checks with zero failures; and the Windows installer, blockmap, release notes, production bundle identity, byte size, and update-metadata hashes are verified by a repeatable artifact smoke test.

**Manual release record:** Live local AniList authorization and the migrated hosted account journey have already been exercised during the migration. Before publishing, record one production AniList callback, one production MyAnimeList callback, a reconciliation of the known 585-entry snapshot against the current roughly 606-entry AniList library, a clean install, and an upgrade from the last 0.1.x build. Deployment remains a separate step and requires explicit approval.

## Atlas adapter inventory

The existing application calls the following capability groups. Each must be implemented, intentionally delegated to a native desktop bridge, or removed from the visible UI before release.

| Group | Capabilities |
| --- | --- |
| Accounts | session, login, register, logout, local password, account deletion |
| Providers | AniList/MAL start and complete login, status, link, unlink, conflict resolution |
| Sync | status, auto-sync, manual delivery, inbound pulls, activity, progress, exclusions |
| Library | anime/manga reads, saves, removals, bulk clear, favorites, local metadata caching |
| Imports | AniList, MAL, text, PDF, portable backup preview and apply |
| Recovery | backup export/import, cached-data repair |
| Metadata | search, discovery, title details, characters, staff, studios, artists |
| Preferences | settings, tutorial state, analytics events and consent |

The adapter currently returns a generic “not available in Atlas yet” result for unimplemented calls. Each checkpoint replaces those fallbacks with real behavior or removes the unreachable control; the release gate must fail if a visible control still reaches the generic fallback.
