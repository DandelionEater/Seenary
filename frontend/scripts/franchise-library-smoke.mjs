import assert from 'node:assert/strict';
import { franchiseStatusPayload } from '../src/utils/franchiseLibrary.ts';
const entry = { status: 'paused', progress: 8, score: 9, notes: 'Keep this', is_favorite: 1,
  repeat_count: 2, is_rewatching: true, started_at: '2025-01-01', completed_at: '2025-02-01', volume_progress: 3, is_rereading: true };
const saved = franchiseStatusPayload('ANIME', 'watching', entry);
assert.equal(saved.status, 'watching');
for (const field of ['progress', 'score', 'notes']) assert.equal(saved[field], entry[field]);
assert.equal(saved.isFavorite, true); assert.equal(saved.repeatCount, 2); assert.equal(saved.isRewatching, true);
assert.equal(saved.startedAt, entry.started_at); assert.equal(saved.completedAt, entry.completed_at);
assert.equal(entry.status, 'paused', 'building the edit never mutates the displayed entry');
assert.deepEqual(franchiseStatusPayload('ANIME', 'planned', null), { status: 'planned' });
const manga = franchiseStatusPayload('MANGA', 'dropped', entry);
assert.equal(manga.volumeProgress, 3); assert.equal(manga.isRereading, true);
assert.equal(manga.isRewatching, undefined);
console.log('PASS: franchise status changes preserve personal fields for anime and manga, and new entries use the requested status.');
