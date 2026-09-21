const assert = require('node:assert/strict');
const { createMetadataService, toMedia, refreshDelay } = require('../atlas/metadata');
const { createMediaService } = require('../atlas/media');
const { createStagingServer } = require('../atlas/stagingServer');

const clone = value => value === undefined ? undefined : structuredClone(value);
const get = (value, path) => path.split('.').reduce((item, part) => item?.[part], value);
function set(value, path, item) { const parts = path.split('.'); const key = parts.pop(); let target = value; for (const part of parts) target = target[part] ||= {}; target[key] = clone(item); }
function matches(row, query) {
  return Object.entries(query).every(([key, value]) => {
    if (key === '$or') return value.some(option => matches(row, option));
    const actual = get(row, key);
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('$exists' in value && (actual !== undefined) !== value.$exists) return false;
      if ('$lte' in value && !(actual <= value.$lte)) return false;
      if ('$lt' in value && !(actual < value.$lt)) return false;
      if ('$gt' in value && !(actual > value.$gt)) return false;
      if ('$in' in value && !value.$in.includes(actual)) return false;
      if ('$regex' in value && !new RegExp(value.$regex, value.$options).test(actual || '')) return false;
      return true;
    }
    return actual === value;
  });
}
class Collection {
  rows = [];
  async findOne(query, options = {}) {
    let rows = this.rows.filter(row => matches(row, query));
    for (const [key, direction] of Object.entries(options.sort || {}).reverse()) rows.sort((a, b) => (get(a, key) > get(b, key) ? 1 : get(a, key) < get(b, key) ? -1 : 0) * direction);
    return clone(rows[0]) ?? null;
  }
  async findOneAndUpdate(query, update, options = {}) {
    let row = this.rows.find(row => matches(row, query));
    if (!row && !options.upsert) return null;
    if (!row) {
      if (query._id && this.rows.some(item => item._id === query._id)) throw Object.assign(new Error('Duplicate key'), { code: 11000 });
      row = { ...Object.fromEntries(Object.entries(query).filter(([key, value]) => !key.startsWith('$') && typeof value !== 'object')), ...clone(update.$setOnInsert || {}) };
      this.rows.push(row);
    }
    for (const [key, value] of Object.entries(update.$set || {})) set(row, key, value);
    for (const [key, value] of Object.entries(update.$inc || {})) set(row, key, (get(row, key) || 0) + value);
    for (const key of Object.keys(update.$unset || {})) delete row[key];
    return clone(row);
  }
  async updateOne(query, update) { return this.findOneAndUpdate(query, update); }
  async updateMany(query, update) {
    const rows = this.rows.filter(row => matches(row, query));
    for (const row of rows) await this.findOneAndUpdate({ _id: row._id }, update);
    return { modifiedCount: rows.length };
  }
  async deleteOne(query) {
    const index = this.rows.findIndex(row => matches(row, query));
    if (index < 0) return { deletedCount: 0 };
    this.rows.splice(index, 1); return { deletedCount: 1 };
  }
  find(query) {
    let rows = this.rows.filter(row => matches(row, query));
    return { sort() { rows = rows.sort((a, b) => a._id.localeCompare(b._id)); return this; }, limit(count) { rows = rows.slice(0, count); return this; }, async toArray() { return clone(rows); } };
  }
}

async function main() {
  const hour = 3600000; const day = 24 * hour; const policyNow = Date.UTC(2026, 8, 21);
  assert.equal(refreshDelay('RELEASING', { type: 'ANIME', nextAiringEpisode: { airingAt: (policyNow + 7 * day) / 1000 } }, policyNow), 6 * day);
  assert.equal(refreshDelay('RELEASING', { type: 'ANIME', nextAiringEpisode: { airingAt: (policyNow + day) / 1000 } }, policyNow), 12 * hour);
  assert.equal(refreshDelay('RELEASING', { type: 'ANIME', nextAiringEpisode: { airingAt: (policyNow + 12 * hour) / 1000 } }, policyNow), 6 * hour);
  assert.equal(refreshDelay('RELEASING', { type: 'ANIME', nextAiringEpisode: { airingAt: (policyNow + 5 * hour) / 1000 } }, policyNow), hour);
  assert.equal(refreshDelay('RELEASING', { type: 'MANGA' }, policyNow), 6 * hour);
  assert.equal(refreshDelay('NOT_YET_RELEASED', {}, policyNow), day);
  assert.equal(refreshDelay('FINISHED', { endDate: { year: 2026, month: 9, day: 1 } }, policyNow), day);
  assert.equal(refreshDelay('FINISHED', { endDate: { year: 2020, month: 1, day: 1 } }, policyNow), 30 * day);
  assert.equal(refreshDelay('HIATUS', {}, policyNow), 7 * day);
  const repo = { media: new Collection(), mediaRedirects: new Collection() };
  const queries = new Collection();
  const media = createMediaService({}, repo);
  let clock = 1700000000000, calls = 0, offline = false, partial = false;
  const raw = { id: 1, type: 'ANIME', title: { romaji: 'Saved title', english: 'Saved English' }, coverImage: { large: 'cover', extraLarge: 'large' }, status: 'RELEASING',
    isAdult: false, averageScore: 87, description: 'Full description', genres: ['Drama'], staff: { edges: [{ node: { id: 3, name: { full: 'Person' } } }] },
    characters: { edges: [] }, relations: { edges: [] }, recommendations: { nodes: [{ mediaRecommendation: { id: 2 } }] } };
  const provider = {
    async details() { calls++; if (offline) throw Object.assign(new Error('Provider disabled'), { status: 429, retryAfter: 900 }); return partial ? { id: 2, title: { romaji: 'Partial title' } } : clone(raw); },
    async search() { calls++; if (offline) throw new Error('Provider disabled'); return { anime: [{ id: 1, type: 'ANIME', title: { romaji: 'New name' }, isAdult: false, averageScore: 90 }], manga: [], characters: [], studios: [] }; },
    async discover() { calls++; if (offline) throw new Error('Provider disabled'); return { anime: { trending: [clone(raw)], shelves: [] }, manga: { trending: [], shelves: [] } }; },
    async studio(id) { calls++; if (offline) throw new Error('Provider disabled'); return { studio: { id, name: 'Studio' }, items: [{ media: clone(raw) }], pageInfo: { currentPage: 1, hasNextPage: false } }; },
    async artistAssociations() { calls++; if (offline) throw new Error('AnimeThemes disabled'); return { artist: { id: 501, name: 'Artist name' }, items: [{ anilistId: 1,
      artist: { id: 501, name: 'Artist name' }, song: { id: 44 }, theme: { id: 55 }, media: { id: 999, type: 'ANIME', title: { romaji: 'Not trusted AniList metadata' } } }], pageInfo: { currentPage: 1, hasNextPage: false } }; },
    async cards() { calls++; if (offline) throw new Error('AniList disabled'); return [clone(raw)]; },
    async collection(type) { calls++; const entry = { media: { ...clone(raw), type }, status: 'REPEATING', score: 3, notes: 'PRIVATE_IMPORT_NOTE', progress: 25, progressVolumes: 2, repeat: 1,
      startedAt: { year: 2020 }, completedAt: { year: 2020, month: 6, day: 7 } }; return { lists: [{ entries: [entry] }, { entries: [entry] }] }; },
  };
  const create = () => createMetadataService({ media, repo, queries, provider, now: () => clock, requestSpacingMs: 0 });
  let service = create();
  const concurrent = await Promise.all([service.details('ANIME', 1), service.details('ANIME', 1)]);
  assert.equal(calls, 1, 'same-key refreshes coalesce');
  assert.equal(concurrent[0].averageScore, 87);
  const original = await media.byProvider('ANIME', 'anilist', 1);
  const detailsClock = original.sources.anilist.groups.details.fetchedAt;
  await service.details('ANIME', 1); assert.equal(calls, 1, 'fresh details skip provider');
  clock += 1000;
  await service.query('searchMedia', ['New name', true]);
  const afterCard = await media.byProvider('ANIME', 'anilist', 1);
  assert.equal(afterCard._id, original._id);
  assert.equal(afterCard.sources.anilist.details.description, 'Full description');
  assert.equal(afterCard.sources.anilist.details.coverImage.extraLarge, 'large');
  assert.deepEqual(afterCard.sources.anilist.groups.details.fetchedAt, detailsClock, 'search never renews details freshness');
  assert.equal(afterCard.sources.anilist.metrics.average_score, 90);
  assert.equal(afterCard.metadata.average_score, undefined, 'provider score stays outside shared metadata');
  assert.equal(toMedia(afterCard).averageScore, 90);
  await service.ingest({ ...raw, title: { romaji: 'Old response' } }, 'ANIME', 'details', clock - 500);
  assert.equal((await media.byProvider('ANIME', 'anilist', 1)).metadata.title_romaji, 'New name', 'older details cannot overwrite a newer card title');
  await repo.media.updateOne({ _id: original._id }, { $set: { 'sources.mal': { fetchedAt: new Date(clock), metrics: { mean: 8 } } } });
  await service.ingest({ id: 1, title: { romaji: null }, description: null }, 'ANIME', 'card', clock + 1000);
  assert.equal((await media.byProvider('ANIME', 'anilist', 1)).metadata.description, 'Full description');
  assert.equal((await media.byProvider('ANIME', 'anilist', 1)).sources.mal.metrics.mean, 8);

  clock += 8 * 3600000; offline = true;
  const stale = await service.details('ANIME', 1);
  assert.equal(stale.cache.stale, true);
  assert.equal(stale.title.romaji, 'New name');
  const attempts = calls;
  service = create(); // Persistent retry state survives service restart.
  await service.details('ANIME', 1); assert.equal(calls, attempts);
  const search = await service.query('searchMedia', ['New name', true]);
  assert.equal(search.anime.length, 1); assert(search.warnings.length);
  const savedOnly = await service.query('searchMedia', ['Saved English', true]);
  assert.equal(savedOnly.anime[0].seenaryId, original._id);
  await service.ingest({ id: 9, title: { romaji: 'Saved English adult' }, isAdult: true }, 'ANIME', 'card', clock);
  const filtered = await service.query('searchMedia', ['English', true]);
  assert.equal(filtered.anime.length, 1, 'saved search excludes adult titles');
  const escaped = await service.query('searchMedia', ['.*', false]);
  assert.equal(escaped.anime.length, 0, 'search text is literal, not executable regex');
  const catalog = await service.query('getDiscoverMedia', [true]);
  assert.equal(catalog.cache.fallback, 'saved-catalog'); assert.equal(catalog.anime.shelves[0].items.length, 1);

  clock += 24 * 3600000; offline = false; partial = true;
  const incomplete = await service.details('ANIME', 2);
  assert.equal(incomplete.cache.stale, true);
  assert.equal((await media.byProvider('ANIME', 'anilist', 2)).sources.anilist.groups.details, undefined);
  await assert.rejects(service.details('ANIME', 3), /unavailable/);
  assert.equal(await media.byProvider('ANIME', 'anilist', 3), null, 'wrong identity cannot poison requested title');
  assert.equal(repo.media.rows.length, 3, 'refreshes never duplicate canonical entries');
  const queryCount = queries.rows.length;
  const imported = await service.previewImport('ExampleUser');
  assert.equal(imported.preview.totalFound, 2, 'custom list duplicates are removed per media type');
  const personal = imported.preview.groups[0].items[0];
  assert.equal(personal.notes, 'PRIVATE_IMPORT_NOTE'); assert.equal(personal.score, 3);
  assert.equal(personal.startedAt, undefined, 'partial dates are not invented');
  assert.equal(personal.completedAt, '2020-06-07'); assert.equal(personal.isRepeating, true);
  assert.equal(queries.rows.length, queryCount, 'personal collection is never query-cached');
  assert(!JSON.stringify(repo.media.rows).includes('PRIVATE_IMPORT_NOTE'));
  assert(!JSON.stringify(queries.rows).includes('PRIVATE_IMPORT_NOTE'));
  assert.equal((await media.byProvider('ANIME', 'anilist', 1)).sources.anilist.metrics.average_score, 87, 'personal score never overwrites public score');
  const artist = await service.query('getArtistMedia', ['example-artist', 1, true]);
  assert.equal(artist.items[0].artist.name, 'Artist name');
  assert.equal(artist.items[0].media.title.romaji, 'Saved title');
  assert.equal(await media.byProvider('ANIME', 'anilist', 999), null, 'AnimeThemes payload cannot impersonate AniList metadata');
  clock += 2 * 24 * 3600000; offline = true;
  const artistFallback = await service.query('getArtistMedia', ['example-artist', 1, true]);
  assert.equal(artistFallback.items.length, 1); assert(artistFallback.warning);
  offline = false;
  const missingShelf = await service.query('getDiscoverShelfAnime', ['seasonal', 2, true, 'ANIME']);
  assert.equal(missingShelf.items.length, 0); assert(missingShelf.warning);
  assert.equal(missingShelf.pageInfo.currentPage, 2, 'uncached page never substitutes a different ranking');
  const server = createStagingServer({ getSession: async token => ({ authenticated: token === 'test-token', user: token === 'test-token' ? { id: 'alice' } : null }) }, null, null, null, service);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/rpc`;
    const request = (method, args, authenticated = true) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Cookie: 'seenary_atlas_staging=test-token' } : {}) }, body: JSON.stringify({ method, args }) });
    assert.equal((await request('searchMedia', ['title'], false)).status, 401);
    assert.equal((await request('previewAniListImport', ['ExampleUser'], false)).status, 401);
    assert.equal((await (await request('previewAniListImport', ['ExampleUser'])).json()).preview.totalFound, 2);
    assert.equal((await (await request('getArtistMedia', ['example-artist', 1, true])).json()).items.length, 1);
    const response = await request('getMediaDetails', ['ANIME', 1]);
    assert.equal(response.status, 200); assert.equal((await response.json()).seenaryId, original._id);
    assert(Array.isArray((await (await request('searchMedia', ['English', true])).json()).anime));
    assert((await (await request('getDiscoverShelfAnime', ['seasonal', 2, true, 'ANIME'])).json()).warning);
  } finally { await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); }); }
  const studio = await service.query('getStudioMedia', [10, 1, true]);
  assert.equal(studio.items.length, 1);
  const studioCalls = calls;
  await service.query('getStudioMedia', [10, 1, true]); assert.equal(calls, studioCalls);
  clock += 2 * 3600000;
  let started, release;
  const startSignal = new Promise(resolve => { started = resolve; });
  provider.studio = async () => { calls++; started(); await new Promise(resolve => { release = resolve; }); return studio; };
  const firstProcess = service.query('getStudioMedia', [10, 1, true]);
  await startSignal;
  const secondProcess = await create().query('getStudioMedia', [10, 1, true]);
  assert(secondProcess.warning, 'a second service serves cached data while the lease owner refreshes');
  assert.equal(calls, studioCalls + 1, 'persisted lease prevents duplicate cross-service provider requests');
  release(); await firstProcess;
  console.log('PASS: shared cache, single-flight, freshness groups, merge preservation, CAS identity, separate metrics, stale reads, persistent retry, literal/adult-filtered saved search, discovery fallback, partial/wrong-ID responses.');
  console.log('PASS: authenticated staging metadata HTTP routes and uncached discovery-page fallback.');
  console.log('PASS: studio cache and cross-service refresh lease contention.');
  console.log('PASS: artist provider separation/outage fallback and import metadata ingestion without shared personal data.');
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { Collection };
