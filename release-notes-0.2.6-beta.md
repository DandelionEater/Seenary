# Seenary 0.2.6 Beta

Tag: `v0.2.6-beta`

## New and improved

- Click a genre or tag on an Anime or Manga title to browse matching titles. Results load on demand, and Back returns to the title at the same scroll position.
- The Windows publisher name is now **Seenary Applications**.
- AniList and MyAnimeList pulls now show an animated step list in Settings, with anime and manga counts and title-processing progress as they become available. You can cancel a queued or running pull. Changes already applied stay in your library. The card shows the result briefly and then returns to its compact view.
- **Preferred title language** applies across anime and manga, including related titles, recommendations, and recent titles in the desktop tray. The preference is shared across accounts on the same installation.

## Reliability and fixes

- If an earlier Atlas edit blocks a save, the title editor now shows the queued and cloud versions and lets you choose which to keep. The provider sync cards show when the last successful pull finished.
- The hosted API now recognizes Seenary's official web app origin even when it is missing from the configured list of allowed origins.
- Windows installs and upgrades now remove Seenary's legacy startup entry to prevent duplicate entries in Task Manager.
- Fixed a retry loop that could stall the first pull from an empty MyAnimeList account. Completed pulls now clear their queued status, so you can start another update.
- AniList and MyAnimeList pulls now stop after repeated failures, and expired credentials prompt you to reconnect. MyAnimeList pulls also stop when pagination gets stuck, and long pulls renew their worker lease as they progress.
- Fresh Releases refreshes saved cards when their title aliases are missing. With English selected, Seenary uses the provider's English title when available and can fall back to a single likely English alias. If the aliases are ambiguous, Seenary keeps the usual title fallback.
