# Seenary 0.2.0 Beta

Tag: `v0.2.0-beta`

## New and improved

### Your library is now backed by the cloud

Seenary has moved its account and library system to a new cloud foundation. Your Anime and Manga lists now belong to your Seenary account and can remain consistent across supported devices.

- Anime and Manga entries, progress, scores, notes, dates, repeat counts, and favorites are stored with your Seenary account.
- Each title now has a stable Seenary identity that can safely connect AniList and MyAnimeList IDs without replacing the entry.
- Library updates merge into the existing entry instead of deleting and recreating it.
- Cloud changes use revisions and durable operation records to prevent retries, stale devices, or interrupted requests from silently overwriting newer edits.
- Deleted entries use recoverable change history so an offline device cannot accidentally restore an old copy.
- Local caches keep the interface responsive while cloud updates and metadata refreshes finish in the background.

### Favorites and recommendations

- Favorites now persist as part of your cloud library.
- Favorite Anime and Manga can be used as recommendation seeds.
- Provider imports preserve your Seenary favorites instead of clearing them when the provider does not supply a matching favorite field.

Existing favorites that were stored only on one device before this migration may need to be selected once more.

### AniList and MyAnimeList synchronization

- Desktop authorization now opens in your normal web browser, where existing sessions and saved passwords remain available.
- Signing in with a provider now checks for an existing Seenary account first and asks for a Seenary username only when a new account is required.
- AniList and MyAnimeList connections, imports, pulls, and progress are shown independently when both services are linked.
- Existing AniList and MyAnimeList connections were carried into the new account system.
- Manual provider updates now run safely in the background, including large first-time reconciliations.
- Provider updates show live fetching, matching, metadata, and reconciliation progress instead of an indefinite loading state.
- Repeated update requests reuse work already in progress instead of starting duplicate pulls.
- Incoming provider entries are appended or merged without deleting Seenary-only titles.
- Imported provider titles now receive their names, artwork, and other available public information instead of remaining as numeric placeholders.
- Newer Seenary edits are protected from older provider data.
- AniList remains the preferred source when both AniList and MyAnimeList information is available.
- Provider delivery uses durable background jobs with retry handling, ordering, deduplication, and protection against older retries overwriting newer progress.
- Personal scores now use one decimal 0-to-10 scale throughout Seenary, AniList, and MyAnimeList synchronization.
- Queued edits wait for 10 quiet seconds before uploading; another edit restarts that timer so related changes can travel together.
- Idle automatic-sync checks stay silent and do not report meaningless “0 changes synced” notifications.
- Provider update notifications now distinguish between an update starting and actually completing.

### More resilient title information

- Shared Anime and Manga information is cached so frequently used pages need fewer repeated provider requests.
- Saved title information can remain available during temporary provider outages.
- Saved search, discovery, studio, artist, character, staff, and theme-music information can remain available when its provider is temporarily unreachable.
- Pages clearly identify saved information and MyAnimeList fallback data while live providers recover.
- AniList information is preferred, while MyAnimeList can fill supported gaps or provide a fallback when a matching ID is available.
- Partial provider responses update only the information they contain and no longer erase richer saved fields.
- AniList and MyAnimeList freshness is tracked independently, allowing AniList to resume as the preferred source after an outage.
- Verified provider mappings preserve the original Seenary entry and its personal history.
- Conflicting mappings or competing personal histories are kept for review instead of being merged destructively.

### Offline and multi-device safety

- Local edits are saved durably before being queued for the cloud.
- Interrupted uploads resume without duplicating completed changes.
- Conflicting edits can be reviewed against the latest cloud copy.
- Account data and pending changes remain isolated when multiple accounts use the same device.
- Full snapshots and incremental updates keep large libraries synchronized without replacing the entire local database on every refresh.
- Bulk clearing, backup imports, and restores use the same cloud conflict protections as normal edits.
- Provider username imports prepare selected entries for review in Cloud saves before anything is uploaded to the active account.

### Interface improvements

- Synchronization controls use compact rows with clear actions, contextual icons, visible progress, and loading feedback for slower account changes.
- Discover loading now mirrors the finished page with a full-width trending carousel and responsive shelf placeholders.
- Provider completion messages clear correctly and distinguish updated entries from titles that were already current.

### Privacy, account controls, and recovery

- Analytics requires an explicit choice and records only eligible, pseudonymous usage totals.
- Opting out removes retained account-linked analytics records.
- Analytics consent follows your Seenary account across devices.
- You can download a privacy-safe archive of the data stored with your Seenary account.
- Permanent account deletion now requires both your exact username and current Seenary password, and removes cloud library data, provider credentials, sessions, sync history, and retained account-linked analytics.
- Settings show whether a control belongs to your account, is portable through backups, or applies only to the installed desktop app.
- Portable backups preserve personal library data and preferences without including sign-in sessions or provider credentials.
- Cloud backup imports are staged for review before they can change the active library.
- AniList, MyAnimeList, text files, PDFs, and Seenary backups can be previewed and selectively imported.
- Import review progress survives navigation and restarts, so large restores can be continued later.
- Cached title data can be repaired without deleting your library, pending changes, preferences, or unfinished imports.

## Reliability and fixes

- Sign-in sessions use secure hosted cookies and remain separate between accounts.
- Cloud requests enforce trusted web origins, request limits, and compatible client-version checks.
- Background workers recover queued synchronization work after restarts and avoid overlapping work for the same account and title.
- Provider outages no longer block saving changes to your Seenary library.
- Cache cleanup is bounded so it cannot remove personal libraries, active work, or canonical title identities.
- The hosted app now selects the production cloud service automatically without relying on unavailable static-host environment controls.
- Fixed a hosted login failure caused by the cloud renderer selecting a local development endpoint.
- Fixed empty and misleading background-import notifications after cloud refreshes.
- Fixed repeated zero-change automatic-sync notifications.
- Fixed desktop provider authorization closing before Seenary received the successful browser callback.
- Fixed desktop provider login opening an isolated window instead of the user's default browser.
- Fixed linked-provider libraries showing numeric AniList or MyAnimeList placeholders after an update.
- Fixed imported scores appearing as values such as 80 out of 10.
- Fixed local edits sometimes waiting for the next one-minute polling interval before entering the provider queue.
- Fixed noisy idle worker output during local desktop use.

## Migration notes

- Existing Seenary accounts, linked providers, title identities, and personal library fields were migrated in place.
- The migration preserves Seenary-only entries when a connected provider has fewer titles.
- A protected recovery copy of pre-migration data is being retained during the beta transition.
- The first provider reconciliation after updating may take several minutes for a large library; it continues in the background.
- Existing cloud scores are converted automatically to the normalized 0-to-10 scale.
