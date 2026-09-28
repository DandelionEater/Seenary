# Seenary 0.2.4 Beta

Released: 2026-09-28.

Tag: `v0.2.4-beta`

## New and improved

- Appearance includes a remembered Background bubbles toggle that enables or disables the decorative bubbles across all pages.

- Personal overview also uses randomized background glows, with closer spacing and slower drift than other pages, including the same edge fades and bounded rendering on long pages.

- Added subtle accent-colored glows to details, Discover, and My List. Titles have distinct seeded layouts; Discover and My List retain randomized arrangements for the session. Glows maintain consistent spacing on long pages, with only nearby layers rendered. Full-width backgrounds and soft page-end fades prevent clipped edges. Reduced-motion preferences keep the slow drift still.

- Simplified the title's personal progress panel: the updated date appears in a compact pill beside Edit, and the redundant score card is removed. Personal scores remain available in the editor.

- The desktop tray offers Watching, recently opened titles, and Continue watching alongside its existing controls, without adding keyboard shortcuts.
- Added one-click diagnostic export in Import & Data with app versions, storage health, and recent error codes. Reports exclude credentials, account identities, library titles, and personal notes.

- Characters and Staff show eight entries initially, with independent Show more/Show less controls. Expanding loads additional provider pages as needed instead of stopping at the former 12 displayed or 20 fetched entries; loaded pages are cached and failed requests can be retried.

- Franchise-map and watch-order titles show their personal library status, including "Not in library." Quick actions add a title to Planned or start Watching/Reading, and saved titles have a status selector for Planned, Watching/Reading, Completed, Paused, and Dropped. Changes update both views and preserve existing progress, ratings, notes, favorites, repeat counts, and dates.

- Added Suggested watch order to anime details, with a direct button below alternate titles and a dedicated view in the franchise map.
- Watch order numbers connected anime by first release date, including seasons, movies, alternate versions, recaps, and spin-offs. A compact speculative label and information tooltip explain that this is a suggestion rather than an official or story-chronological order.
- Watch order starts loading automatically when opened and fills in real time. Progress remains visible, and numbering updates as earlier releases arrive.
- Currently releasing anime show a compact "Currently airing" badge in watch order; completed titles remain unmarked to keep the timeline clear.
- Added format filters for TV, movies, TV shorts, specials, OVAs, ONAs, music, and other or unknown formats. Selections are remembered in the browser, with quick controls for TV and movies, all formats, or none.
- Format filters remain usable during loading and immediately update the visible order. Hidden formats still connect the lookup to later seasons without appearing in the results.
- Upcoming titles and entries with unknown release dates appear separately without watch-order numbers. Incomplete dates and tied releases remain clearly described as approximate.
- Public details fetched for watch order are saved in the shared Atlas catalog for future reuse without adding titles to a user's personal list.

## Loading improvements

- My List opens from the saved library immediately and refreshes quietly in the background. Returning preserves scroll position and filters separately for Anime and Manga; pending edits remain visible if refresh fails.

- Anime and Manga discovery load independently with separate caches and provider queries. Switching restores the selected medium's saved results without waiting for the other medium or allowing late responses to replace the current view.

- Discover shows saved catalogs immediately while outdated results refresh in the background, keeping existing sections visible and quietly picking up refreshed results without restarting the loading placeholders.

- Saved complete Atlas title details now appear immediately when outdated, while provider updates run in the background and refresh the shared database.
- Recently opened titles reuse a bounded in-memory cache. Repeated requests share the same lookup, and expired cached pages remain available while they refresh.
- Title requests no longer wait for a library refresh first. Personal list data loads alongside public details, and list-edit controls wait until personal progress has loaded.
- Connected watch-order titles can load up to four at a time, allowing saved Atlas details to arrive faster while provider requests remain paced by the server.
- Background refreshes share existing cache and request protections. A pending refresh no longer displays an incorrect provider-outage warning.

## Reliability and fixes

- If Windows cannot launch Seenary after installation, the installer remains open with a retry message instead of crashing. The app launches from its installation folder.

- Collapsed descriptions fade the text itself instead of covering it with a solid background gradient, keeping the fade seamless over accent glows.

- Removed custom keyboard actions outside Search, keeping Escape to close artwork, trailers, and modals. Cards, filters, status menus, notifications, and import fields no longer intercept keys. The desktop show/hide shortcut and its settings panel remain available; the legacy DevTools shortcut is removed.

- Provider updates distinguish downloading, waiting to retry, and failure, show the next retry countdown, and offer Retry update. Provider rate-limit backoff remains respected, and waiting jobs continue being monitored instead of failing after an arbitrary timeout.

- Restored Enter's search focus toggle: submit and unfocus while editing, then restore and select the existing query from outside search without duplicate requests. Search shortcuts respect text composition, modifier keys, and backward Tab navigation.

- Provider pull status exposes safe worker error codes, retry counts, and retry times. The progress display explains retry waits instead of silently cycling back to the generic waiting message.

- Combined alternate language titles and synonyms into one deduplicated "Alternate titles" list, excluding the displayed title and its corrected variants; the full list remains available on hover or keyboard focus.

- Corrected the display of "The Angel Next Door Spoils Me Rotten2" to "The Angel Next Door Spoils Me Rotten Season 2" while preserving the original provider metadata and other language titles.

- Series-age calculations now save each resolved prequel's start date for reuse across connected seasons, including seasons that have not yet been opened. Saved dates survive restarts, and Atlas cache cleanup preserves them.
- Series age advances on the release anniversary using the saved date, with no yearly provider fetch. The display also updates while the page remains open.
- Separate branches retain their own premiere dates, and incomplete or cyclic prequel histories are not saved as completed calculations.
- Watch-order traversal checks each title once, avoids repeated links and cycles, excludes non-story connections and manga, and respects adult-content filtering.
- Unrelated, mismatched, and failed title responses are hidden rather than being inserted into the watch order. Unavailable links produce a compact partial-order notice.
- Switching franchise-map views preserves loaded watch-order results. Closing the view cancels further traversal and prevents late results from updating the closed view.
- Fixed the watch-order button flowing inline with alternate titles; it now uses a dedicated row with consistent spacing for short and long titles.
- Watch-order rows use a fixed-width library-controls column with a thin divider, keeping statuses and quick actions aligned. Narrow screens stack the controls below the title with a horizontal divider.
- Franchise library status menus now match Seenary's dark rounded dropdowns, with compact text-only options, an accent-highlighted single selection. Menus match the trigger width, stay above the scrolling timeline, and adjust near screen edges.
- Franchise status options follow the user's saved My List section order for anime or manga, and the selected option uses the user's accent color.
- Recently opened title caches clear when switching accounts or repairing cached data, and outdated personal-list responses cannot overwrite a different open title.
