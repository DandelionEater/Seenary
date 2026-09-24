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
- Related titles and recommendations now show four cards initially and expand or collapse with the same compact control used by streaming episodes.
- Discover now includes guided genre and browsing presets for Anime and Manga, each backed by a complete paginated AniList collection and freely positionable through the Discover layout editor.
- Added a weekly release calendar with local episode times for Anime, known upcoming publication dates for Manga, My List badges, and collapsible days that automatically close past dates while leaving today open; results are cached for 24 hours to minimize AniList traffic.
- Compact media cards now use concise, readable format labels, and Planned Picks no longer repeats a title's source in its metadata line.
- Discover loading placeholders now include the browsing presets and follow each user's saved section order.
- Full discovery collections exclude completed library entries by default, with a filter to show them again at any time.
- Restored the hosted analytics report endpoint used by Seenary operations.
