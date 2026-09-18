# Seenary 0.1.11 Beta

Tag: `v0.1.11-beta`

## New and improved

This release focuses on making Seenary's loading, account-linking, synchronization, search, and recovery behavior match what the interface promises.

- AniList and MyAnimeList sign-in now finishes as soon as authorization succeeds. Seenary becomes usable immediately while the linked library continues loading in the background.
- MyAnimeList imports batch exact ID lookups, remember successful mappings, temporarily remember failed mappings, and use limited parallelism for the remaining work.
- MyAnimeList preview results are reused during import instead of downloading and matching the same library twice.
- Large MyAnimeList previews render in manageable groups with lazy-loaded artwork, keeping selection responsive even for large Anime and Manga libraries.
- Settings now includes **Check for updates**, with a compatibility fallback for installations whose older desktop shell does not yet provide the native check command.
- Settings now includes a guarded **Repair cached data** action. It clears only rebuildable web and media-detail caches, preserves accounts, lists, preferences, and sync state, and offers to restart Seenary afterward.

## Reliability and fixes

- Seasonal Picks no longer restores stale expanded-page state that could leave the page permanently loading until all user data was deleted.
- Search submission now reads the input's current value directly, cancels pending debounce work, and follows one request path whether focus came from a click or the global Enter shortcut.
- Sync actions with an unknown total show an indeterminate **Working...** state instead of remaining at **0%** and suddenly completing.
- MyAnimeList previews and pulls now run as deduplicated background jobs with real progress, cooperative cancellation, and no fixed two-minute client cutoff.
- Cancelling a MyAnimeList operation now requests cancellation from the server instead of only hiding the client-side loading state.
- MyAnimeList access-token refreshes are coalesced so concurrent operations do not race to replace the same credentials.
- Outbound MyAnimeList changes use bounded concurrency to improve throughput without sending an uncontrolled request burst.
- Manual update checks share an already-running startup check, visibly enter a checking state, and show useful errors instead of failing immediately with a generic message.
- Full local media-detail payloads expire after 30 days, and expired provider-mapping misses are pruned automatically without periodically wiping user storage.

## Data safety

- Cache repair does not clear cookies, Local Storage, IndexedDB, OAuth credentials, local Anime or Manga entries, settings, sync queues, or activity history.
- Existing installations and legacy databases are migrated in place; deleting Seenary user data is not required for these fixes.
