# Seenary 0.2.0-beta release validation

Validation date: 2026-09-22

## Automated evidence

- Release readiness: 20 passed, 0 failed, with the expected dirty-working-tree warning before commit.
- Frontend: TypeScript production build and ESLint passed.
- Data: fresh account/authentication and legacy SQLite migration smokes passed.
- Reliability: updater configuration, AnimeThemes mapping, MyAnimeList pipeline, cache maintenance, cached-detail fallback, analytics, and security smokes passed.
- Atlas client: the hidden Chromium journey previously passed session recovery, account isolation, offline queue recovery, favorites, conflict resolution, imports, metadata fallbacks, privacy export, and password-confirmed deletion.
- Packaging: `Seenary-Setup-0.2.0-beta.exe`, its blockmap, `latest.yml`, and embedded release notes were generated successfully.
- Artifact integrity: update-metadata filename, version, byte size, and SHA-512 match the installer; the packaged frontend contains the production API endpoint and production Atlas identity and contains no staging label.

## Manual evidence already recorded

- Local AniList connection completed successfully during Atlas cutover testing.
- Local MyAnimeList authorization completed successfully through the system browser.
- AniList and MyAnimeList username previews loaded the expected public Anime and Manga lists.
- AniList and MyAnimeList account pulls completed and hydrated titles that previously appeared as numeric placeholders.
- The migrated account authenticated and restored its cloud library after the Atlas migration.
- The hosted production frontend selected the Atlas API after deployment of the updated static bundle.

## Final checks before publishing

- [ ] Complete an AniList OAuth callback from the production web app and confirm the intended Seenary account remains active.
- [ ] Complete a MyAnimeList OAuth callback from the production web app and confirm both provider links appear independently.
- [ ] Verify one automatic AniList push and one automatic MyAnimeList push, including status, progress, score, dates, repeat state, and delivery time.
- [ ] Verify add, edit, status change, completion, repeat, and deletion behavior survives restart and reconciles without duplicates.
- [ ] Install `Seenary-Setup-0.2.0-beta.exe` on a clean profile and complete login, library edit, offline/reconnect, and restart checks.
- [ ] Upgrade an existing 0.1.x installation and confirm settings, local recovery data, account session, and updater restart behavior.
- [ ] Check compact-window overflow, keyboard focus order, visible focus, screen-reader labels, and representative empty/loading/warning/error states.
- [ ] Obtain explicit approval before pushing, publishing a GitHub release, or deploying.
