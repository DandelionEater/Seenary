const assert = require('node:assert/strict');
const { Collection } = require('./atlas-metadata-smoke');
const { createMediaService } = require('../atlas/media');
const { createMetadataService } = require('../atlas/metadata');

async function main() {
  const repo = { media: new Collection(), mediaRedirects: new Collection() };
  const queries = new Collection(), media = createMediaService({}, repo), calls = [];
  let clock = Date.UTC(2026, 8, 26);
  const section = name => ({ trending: [], shelves: [{ id: 'popular', title: name, items: [] }] });
  const service = createMetadataService({ media, repo, queries, now: () => clock, requestSpacingMs: 0,
    provider: { discover: async (safe, type) => {
      calls.push([safe, type]);
      return { anime: section('Anime'), manga: section('Manga') };
    } } });
  const anime = await service.query('getDiscoverMedia', [true, 'ANIME']);
  assert.equal(anime.anime.shelves[0].title, 'Anime');
  assert.equal(anime.manga.shelves.length, 0);
  const manga = await service.query('getDiscoverMedia', [true, 'MANGA']);
  assert.equal(manga.manga.shelves[0].title, 'Manga');
  assert.equal(manga.anime.shelves.length, 0);
  assert.deepEqual(calls, [[true, 'ANIME'], [true, 'MANGA']]);
  await service.query('getDiscoverMedia', [true, 'ANIME']);
  await service.query('getDiscoverMedia', [true, 'MANGA']);
  assert.equal(calls.length, 2, 'switching back reuses the correct independent cache');
  await service.query('getDiscoverMedia', [false, 'ANIME']);
  assert.equal(calls.length, 3, 'adult visibility has a separate cache');
  await assert.rejects(service.query('getDiscoverMedia', [true, 'TV']), /Invalid/);

  // Verify the real AniList adapter omits the unselected media's resolvers.
  const fetchPath = require.resolve('node-fetch');
  const previous = require.cache[fetchPath];
  const requests = [];
  require.cache[fetchPath] = { exports: async (_url, options) => {
    const request = JSON.parse(options.body); requests.push(request);
    const data = {};
    for (const alias of request.variables.includeAnime ? ['trendingAnime', 'seasonal', 'upcoming', 'popular', 'highlyRated'] : []) data[alias] = { media: [] };
    for (const alias of request.variables.includeManga ? ['trendingManga', 'publishingManga', 'newManga', 'popularManga', 'highlyRatedManga'] : []) data[alias] = { media: [] };
    return { ok: true, status: 200, json: async () => ({ data }) };
  } };
  delete require.cache[require.resolve('../anilist')];
  try {
    const anilist = require('../anilist');
    await anilist.getDiscoverMedia({ mediaType: 'ANIME' });
    await anilist.getDiscoverMedia({ mediaType: 'MANGA' });
    assert.equal(requests[0].variables.includeManga, false);
    assert.equal(requests[1].variables.includeAnime, false);
    assert.equal((requests[0].query.match(/@include\(if: \$includeAnime\)/g) || []).length, 5);
    assert.equal((requests[0].query.match(/@include\(if: \$includeManga\)/g) || []).length, 5);
  } finally {
    if (previous) require.cache[fetchPath] = previous; else delete require.cache[fetchPath];
  }
  console.log('PASS: separate discovery catalogs, cache reuse when switching, adult-filter isolation, and provider queries skipping the unselected medium.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
