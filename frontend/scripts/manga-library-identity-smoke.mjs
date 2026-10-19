import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/cloud/rendererAdapter.ts', import.meta.url), 'utf8');
const rowStart = source.indexOf('  const numericId =');
const rowEnd = source.indexOf('  function overlay(', rowStart);
const detailsStart = source.indexOf('  async function fetchDetails(');
const detailsEnd = source.indexOf('  async function linkStatus(', detailsStart);
assert(rowStart >= 0 && rowEnd > rowStart && detailsStart >= 0 && detailsEnd > detailsStart);
const code = ts.transpileModule(`${source.slice(rowStart, rowEnd)}\n${source.slice(detailsStart, detailsEnd)}\n({ row, fetchDetails });`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

let state;
let offline = false;
let cacheFailure = false;
let notifications = 0;
const calls = [];
const { row, fetchDetails } = vm.runInNewContext(code, {
  user: { id: 'test-user' },
  load: async () => state,
  operate: async task => task({ userId: 'test-user', read: async () => state }),
  storage: { write: async (_id, updated) => { if (cacheFailure) throw Error('Disk unavailable'); state = updated; } },
  notify: () => { notifications++; },
  rpc: async (method, args) => {
    calls.push({ method, args: [...args] });
    if (offline) throw Error('Provider unavailable');
    return { id: args[1], type: args[0], title: { romaji: 'Existing AniList manga' }, status: 'FINISHED', nextAiringEpisode: null };
  },
});

for (const [type, anilistId, malId] of [['MANGA', 30013, 13], ['MANGA', undefined, 42], ['ANIME', 1, 1]]) {
  const media = { _id: 'canonical-media', type, anilistId, malId, metadata: { title_romaji: 'Saved library title', [type === 'MANGA' ? 'manga_status' : 'anime_status']: 'RELEASING', next_airing_episode: 13, next_airing_at: 1700000000 } };
  const entry = { mediaId: media._id, type, status: 'watching', progress: 12, volumeProgress: 2, score: 80 };
  state = { media: { [media._id]: media }, entries: { [media._id]: entry }, pending: [{ request: { mediaId: media._id, operationId: 'pending-edit', patch: { progress: 15 } } }] };
  const rendered = row(entry, state);
  const expectedId = anilistId ?? -malId;
  assert.equal(rendered.anime_id, expectedId, 'shared cards and editor receive the provider ID');
  assert.equal(rendered.media_type, type);
  if (type === 'MANGA') assert.equal(rendered.manga_id, expectedId, 'manga-specific views retain their ID');
  assert.equal(rendered.progress, 12);
  assert.equal(rendered.volume_progress, 2);
  assert.equal(rendered.anime_status, 'RELEASING');
  offline = false;
  const before = notifications;
  await fetchDetails(type, rendered.anime_id);
  assert.equal(calls.at(-1).method, 'getMediaDetails');
  assert.deepEqual(calls.at(-1).args, [type, expectedId], 'card ID reaches the typed details request');
  const refreshed = row(entry, state);
  assert.equal(refreshed.anime_status, 'FINISHED', 'fresh details correct the stale library badge');
  assert.equal(state.media[media._id].metadata.next_airing_episode, null, 'remove obsolete next-episode data');
  assert.equal(notifications, before + 1, 'library views are notified after durable metadata update');
  assert.equal(state.pending[0].request.patch.progress, 15, 'metadata refresh preserves queued progress edits');
  assert.equal(state.entries[media._id].status, 'watching', 'public airing status does not overwrite personal list status');
  offline = true;
  const cached = await fetchDetails(type, rendered.anime_id);
  assert.equal(cached.id, expectedId);
  assert.equal(cached.title.romaji, 'Existing AniList manga', 'latest saved title remains available during provider outages');
  assert.equal(cached.status, 'FINISHED');
  offline = false; cacheFailure = true;
  assert.equal((await fetchDetails(type, rendered.anime_id)).status, 'FINISHED', 'local storage failure does not hide a valid details page');
  cacheFailure = false;
}
console.log('PASS: manga/anime identities, typed details, airing-status refresh and notification, cached fallback, queued edit preservation, and storage failures.');
