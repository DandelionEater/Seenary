const assert = require('node:assert/strict');
const { Collection } = require('./atlas-metadata-smoke');
const { createMediaService } = require('../atlas/media');
const { createMetadataService } = require('../atlas/metadata');

async function main() {
  const repo = { media: new Collection(), mediaRedirects: new Collection() };
  const media = createMediaService({}, repo), queries = new Collection();
  let clock = Date.UTC(2026, 8, 26), calls = 0, release, started, offline = false;
  const began = new Promise(resolve => { started = resolve; });
  const catalog = label => ({ anime: { trending: [], shelves: [{ id: 'popular', title: label, items: [] }] }, manga: { trending: [], shelves: [] } });
  const provider = { discover: async () => {
    calls++;
    if (offline) throw new Error('Provider offline');
    if (calls === 2) { started(); await new Promise(resolve => { release = resolve; }); }
    return catalog(calls === 1 ? 'Saved picks' : 'Updated picks');
  } };
  const create = () => createMetadataService({ media, repo, queries, provider, now: () => clock, requestSpacingMs: 0 });
  let service = create();
  assert.equal((await service.query('getDiscoverMedia', [true])).anime.shelves[0].title, 'Saved picks');
  clock += 2 * 3600000;
  let timer;
  const saved = await Promise.race([
    service.query('getDiscoverMedia', [true]),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Discover waited for provider')), 1000); }),
  ]).finally(() => clearTimeout(timer));
  assert.equal(saved.anime.shelves[0].title, 'Saved picks');
  assert.equal(saved.cache.refreshing, true);
  assert.equal(saved.anime.shelves[0].warning, undefined);
  await began;
  for (let index = 0; index < 5; index++) assert.equal((await service.query('getDiscoverMedia', [true])).cache.refreshing, true);
  service = create();
  assert.equal((await service.query('getDiscoverMedia', [true])).anime.shelves[0].title, 'Saved picks');
  assert.equal(calls, 2, 'polls and separate services do not duplicate provider refreshes');
  release(); await new Promise(resolve => setImmediate(resolve));
  const refreshed = await service.query('getDiscoverMedia', [true]);
  assert.equal(refreshed.anime.shelves[0].title, 'Updated picks');
  assert.equal(refreshed.cache.stale, false);
  clock += 2 * 3600000; offline = true;
  const duringFailure = await service.query('getDiscoverMedia', [true]);
  assert.equal(duringFailure.anime.shelves[0].title, 'Updated picks');
  await new Promise(resolve => setImmediate(resolve));
  const afterFailure = await service.query('getDiscoverMedia', [true]);
  assert.equal(afterFailure.cache.refreshing, false);
  assert(afterFailure.anime.shelves[0].warning);
  assert.equal(calls, 3, 'failed refresh honors persisted backoff');
  console.log('PASS: Discover returns saved results before a blocked provider, updates its cache, coalesces refreshes across services, and retains data during outages.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
