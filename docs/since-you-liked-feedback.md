# Since You Liked feedback

Feedback is independent of library favorites, ratings, and analytics consent. Like and Dislike are explicit shared feedback on a directed source → recommendation relationship. Not Interested is a private filter used only by Since You Liked.

## Storage and API

Atlas creates `sinceYouLikedFeedback` and `sinceYouLikedHidden` on application startup. Unique indexes enforce one reaction per account, medium, and pair, and one hidden record per account, medium, and title. IDs follow the renderer's existing convention: positive AniList IDs and negative MAL-only IDs, qualified by `ANIME` or `MANGA`.

The authenticated `/rpc` methods are:

- `getSinceYouLikedState({ mediaType, pairs })`: accepts up to 80 `{ sourceMediaId, recommendedMediaId }` pairs per request; returns each pair's `feedbackAdjustment` and the current account's `sinceYouLikedFeedback`, plus `hiddenMediaIds`.
- `setSinceYouLikedFeedback({ mediaType, sourceMediaId, recommendedMediaId, feedback })`: accepts `like`, `dislike`, or `null` to clear the reaction.
- `setSinceYouLikedHidden({ mediaType, mediaId, hidden })`: accepts `true` to hide or `false` to undo.

The session supplies identity; request bodies cannot select another user. Shared results contain aggregate adjustments, never other users' identities or individual reactions. Account exports, account deletion, and encrypted server backups include both collections. Deleting an account also removes its contribution to future aggregate scores.

## Scoring

For each source/candidate pair, the existing similarity strength receives this server-calculated adjustment:

```text
clamp(likes × LIKE_WEIGHT + dislikes × DISLIKE_WEIGHT,
      -MAX_ADJUSTMENT, MAX_ADJUSTMENT)
```

The initial defaults are `+2` per Like, `-2` per Dislike, capped at `±10`. Configure `SINCE_LIKED_LIKE_WEIGHT`, `SINCE_LIKED_DISLIKE_WEIGHT`, and `SINCE_LIKED_MAX_ADJUSTMENT` in the server environment and restart the API to tune them. No client rebuild or stored-data migration is needed. Unvoted pairs retain their baseline score.

Library and hidden-title exclusions apply before selecting the visible mix. Removing a suggestion selects from the full remaining candidate pool. Reactions update immediately and roll back on failed saves. Reacted cards are replaced; saved dislikes can be cleared from Recommendation preferences in Settings. Add uses the existing library API with Planned status and preserves entries already present in the library.

Deploy the API changes before the frontend so the new RPC methods are available. No release version is changed by this feature.

## Local regression checks

From `backend`, run `npm run test:since-you-liked` and `npm run test:since-you-liked:browser`. The browser check builds a fixture from the production React components, starts hidden Chromium, and writes screenshots/results under `backend/node_modules/.cache/since-liked-browser`.

These tests use synthetic accounts and an in-memory repository. They exercise service and RPC behavior, scoring, reload persistence, optimistic rollback, hiding/undo, library addition, account/medium isolation, hover layout, keyboard focus, and touch controls. They do not connect to a live Atlas database.

## Recommendation retention

Visible suggestions are enrolled in account-scoped sinceYouLikedLifecycle records. They remain when added or marked planned, watching/reading, or paused. A completed entry starts a 24-hour grace period using the backend status transition timestamp; older entries without that timestamp use first observation. Explicit feedback settles the suggestion immediately. An unreacted completion inserts a like after the deadline, at the next state refresh (the open section refreshes every minute). Existing explicit feedback is never overwritten. Dropped titles create Not Interested records without dislikes. Manual Not Interested suppresses automatic likes and can still be undone. Previously completed titles that were never displayed are not enrolled. Lifecycle data is included in account export, backups, and account deletion.

## Managing saved preferences

Settings > Recommendation preferences lists account-owned Not Interested entries and disliked source/suggestion pairs, including Anime and Manga. getRecommendationPreferences returns counts and twenty entries per page, with bounded shared-catalog metadata lookups. Metadata hidden by the content filter or absent from the cache uses an identity placeholder, so the choice remains reversible. Restore removes the private hidden marker. Remove dislike clears that pair vote. Both reset eligible lifecycle records and grant a fresh completion buffer; they never change library fields. Restored dropped titles remain excluded by library status, without immediately recreating the hidden marker. A later new drop may hide them again.
