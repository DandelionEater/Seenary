const assert = require('node:assert/strict');
const { Collection } = require('./atlas-metadata-smoke');
const { createMediaService } = require('../atlas/media');
const { createMetadataService } = require('../atlas/metadata');

async function main() {
  const repo = { media: new Collection(), mediaRedirects: new Collection() };
  const media = createMediaService({}, repo), queries = new Collection();
  let clock = Date.UTC(2026, 8, 26), calls = 0, release, started;
  const began = new Promise(resolve => { started = resolve; });
  const raw = { id: 1, type: 'ANIME', title: { romaji: 'Saved title' }, status: 'RELEASING',
    description: 'Saved description', genres: [], staff: { edges: [] }, characters: { edges: [] },
    relations: { edges: [] }, recommendations: { nodes: [] } };
  const service = createMetadataService({ media, repo, queries, now: () => clock, requestSpacingMs: 0,
    provider: { details: async () => {
      calls++; started(); await new Promise(resolve => { release = resolve; });
      return { ...raw, description: 'Refreshed description' };
    } } });
  await service.ingest(raw, 'ANIME', 'details');
  clock += 8 * 3600000;
  let timer;
  const immediate = await Promise.race([
    service.details('ANIME', 1),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Saved page waited for provider')), 1000); }),
  ]).finally(() => clearTimeout(timer));
  assert.equal(immediate.description, 'Saved description');
  assert.equal(immediate.cache.refreshing, true);
  assert.equal(immediate.warning, undefined, 'background refresh is not an outage warning');
  await began;
  const repeats = await Promise.all(Array.from({ length: 10 }, () => service.details('ANIME', 1)));
  assert(repeats.every(page => page.description === 'Saved description'));
  assert.equal(calls, 1, 'repeated pages share one provider refresh');
  const completed = service.details('ANIME', 1, { waitForRefresh: true });
  release(); await completed;
  assert.equal((await service.details('ANIME', 1)).description, 'Refreshed description');
  assert.equal(calls, 1);
  console.log('PASS: stale Atlas page returns before a blocked provider, refreshes coalesce, and refreshed data is saved.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
