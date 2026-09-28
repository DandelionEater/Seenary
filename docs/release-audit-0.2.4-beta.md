# Seenary 0.2.4 Beta release audit

Date: 2026-09-28. Source and unpublished Windows audit build checked before the version bump. Backend package and lockfile remain at 0.2.3-beta; nothing was published or deployed.

## Findings and fixes

- The 0.2.3 fix for the packaged startup crash remains present: `desktop-main.js` imports Electron's `ipcMain` before registering the external-browser handler.
- The installer success button previously allowed `Process.Start` failures to escape its click handler. It now launches from the installation folder and handles failure by keeping the installer open with a retry message.
- Added the series-date SQLite cache table to the storage-ownership map. The ownership test now passes without weakening its schema assertions.
- Added the new local feature regression checks to release readiness, plus installer-artifact and packaged-startup checks before the Windows release workflow uploads artifacts.
- The next release notes now contain the exact tag line expected by the publishing workflow.

## Validation

- Expanded automated readiness: 37 passed, zero failed; the expected warning is the uncommitted working tree.
- Backend test suite: 15 passing tests, including retry safety, account isolation, tray navigation, and Linux startup.
- Frontend checks cover watch-order traversal and cancellation, franchise edits preserving personal data, detail caches, saved filters/scroll, durable cloud writes, lost acknowledgements, imports, and backups.
- Hidden Electron runtime check verifies cached library reads during blocked refresh, preservation of pending favorites after failure, privacy-safe diagnostics, and bounded background layers on a 100,000-pixel page.
- Actual packaged ASAR desktop entry and packaged preload booted in a hidden Electron window with an isolated profile. Diagnostics IPC responded, the tray bridge was present, and removed native shortcuts remained disabled. The renderer used a controlled local test page; this does not test hosted frontend availability.
- Built an unpublished Windows audit package and full custom installer in `release/audit-2026-09-28`. Compilation passed for the NSIS payload, custom uninstaller, and custom bootstrapper.
- Artifact verification passed: wrapped-installer SHA-512 and byte size match update metadata; blockmap exists; bundled frontend contains the production endpoint and production storage identity without the staging label.

## Remaining release gates

- Bump the package and lockfile together to 0.2.4-beta, finalize the draft notes, and build fresh versioned artifacts. The audit installer retains 0.2.3-beta solely because the version has not yet been bumped; do not publish it.
- Perform an actual installed-app upgrade and restart using the final 0.2.4 installer on a test Windows account or VM. No installer was run against the user's installation, registry, or profile during this audit. Packaged-code startup and compilation substantially reduce the prior risk but cannot guarantee every real Windows installation.
- The live staging provider integration could not run: configured database connectivity returned `ECONNREFUSED`. Local provider/retry tests passed, but live OAuth and provider pulls require staging connectivity or a separate final live check.
- Commit the reviewed changes and coordinate backend/frontend deployment with the desktop release. The audit does not itself publish or deploy.
