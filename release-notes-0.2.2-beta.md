# Seenary 0.2.2 Beta

Tag: `v0.2.2-beta`

## New and improved

- Provider sync activity now presents completed pulls as readable summaries instead of internal operation data.
- The Personal spotlight now follows the latest activity within the current Watching or Reading list, with Planned titles used when no active title is available.
- The personalized recommendation section now grows and shrinks with its contents instead of leaving an oversized empty area or clipping its last recommendation.
- Complete Personal dashboard layouts, including widget order, size, and orientation, are now preserved in Seenary's local JSON configuration with a backup copy.

## Reliability and fixes

- Fixed AniList and MyAnimeList authorization on Windows and Linux incorrectly asking users to allow popups after the system browser had already completed authorization.
- Desktop provider authorization continues in the user's default browser and reliably returns the result to Seenary through callback polling.
- Library edits now carry their latest local and cloud activity timestamps into the interface, including while an edit is waiting to upload.
- Restored franchise-age calculation in Anime details and removed stray zeroes from media badge rows when episode or publication counts are unknown.
- Made anime theme music resilient to AnimeThemes outages: saved results remain available, uncached sections hide cleanly, and provider failures no longer appear as account-operation errors.
- Added a complete related-titles modal to the direct-connections summary on Anime and Manga details.
- Restored the hosted analytics report endpoint used by Seenary operations.
