const { createProviderCache } = require('./providerCache');
const { calculateObjectSize } = require('bson');
const { validId, fillMissing } = require('./media');

const HOUR = 3600000;
const DAY = 24 * HOUR;
const CARD_FIELDS = ['title', 'coverImage', 'bannerImage', 'isAdult', 'episodes', 'chapters', 'volumes', 'format', 'status', 'season', 'seasonYear', 'duration', 'source', 'countryOfOrigin', 'startDate', 'endDate', 'nextAiringEpisode', 'genres', 'description'];
const DETAIL_FIELDS = [...CARD_FIELDS, 'synonyms', 'studios', 'tags', 'staff', 'characters', 'relations', 'recommendations', 'externalLinks', 'streamingEpisodes', 'trailer', 'siteUrl'];
const METRICS = { averageScore: 'average_score', meanScore: 'mean_score', popularity: 'popularity', favourites: 'favourites' };
const COLUMNS = { bannerImage: 'banner_image', isAdult: 'is_adult', seasonYear: 'season_year', countryOfOrigin: 'country_of_origin', startDate: 'start_date', endDate: 'end_date', externalLinks: 'external_links', streamingEpisodes: 'streaming_episodes', siteUrl: 'site_url' };

function mergePresent(previous, incoming) {
  const result = structuredClone(previous || {});
  for (const [key, value] of Object.entries(incoming || {})) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Invalid metadata key.');
    if (value === null || value === undefined) continue;
    // Provider connection arrays may be capped. Empty/short partial connections cannot erase richer cached edges.
    if (Array.isArray(value)) {
      result[key] = Array.isArray(result[key]) && result[key].length > value.length ? result[key] : structuredClone(value);
    } else if (typeof value === 'object') result[key] = mergePresent(result[key], value);
    else result[key] = value;
  }
  return result;
}
function fuzzyDateTime(value) {
  if (!value) return 0;
  if (typeof value === 'string') return Date.parse(value) || 0;
  if (!value.year || !value.month || !value.day) return 0;
  return Date.UTC(value.year, value.month - 1, value.day);
}
function refreshDelay(status, media = {}, observedAt = Date.now()) {
  if (status === 'RELEASING') {
    const airingAt = Number(media.nextAiringEpisode?.airingAt) * 1000;
    if (media.type === 'ANIME' && Number.isFinite(airingAt) && airingAt > observedAt) {
      const remaining = airingAt - observedAt;
      if (remaining > DAY) return Math.min(6 * DAY, remaining - DAY);
      if (remaining > 12 * HOUR) return remaining - 12 * HOUR;
      if (remaining > 6 * HOUR) return remaining - 6 * HOUR;
      return Math.min(HOUR, remaining);
    }
    return 6 * HOUR;
  }
  if (status === 'NOT_YET_RELEASED') return DAY;
  if (status === 'FINISHED') {
    const endedAt = fuzzyDateTime(media.endDate);
    return endedAt && observedAt - endedAt <= 30 * DAY ? DAY : 30 * DAY;
  }
  if (['HIATUS', 'CANCELLED'].includes(status)) return 7 * DAY;
  return 7 * DAY;
}
function toMedia(document, cache = {}) {
  const meta = document.metadata;
  const legacy = { id: document.anilistId ?? -document.malId, idMal: document.malId ?? null, type: document.type,
    title: { romaji: meta.title_romaji, english: meta.title_english, native: meta.title_native, userPreferred: meta.title_preferred || meta.title_english || meta.title_romaji },
    coverImage: { large: meta.cover_image_large, extraLarge: meta.cover_image_extra_large },
    status: meta.anime_status ?? meta.manga_status, episodes: meta.episodes, chapters: meta.chapters, volumes: meta.volumes,
    format: meta.format, duration: meta.duration, genres: meta.genres, description: meta.description, synonyms: meta.synonyms,
    recommendations: meta.recommendations ? { nodes: meta.recommendations } : undefined };
  for (const [camel, column] of Object.entries(COLUMNS)) if (meta[column] !== undefined) legacy[camel] = meta[column];
  for (const [camel, column] of Object.entries(METRICS)) if (document.sources.anilist?.metrics?.[column] !== undefined) legacy[camel] = document.sources.anilist.metrics[column];
  const present = Object.fromEntries(Object.entries(legacy).filter(([, value]) => value !== undefined));
  const result = { ...fillMissing(present, document.sources.anilist?.details || {}), id: legacy.id, idMal: legacy.idMal, type: document.type,
    seenaryId: document._id, cache: { provider: 'anilist', ...cache } };
  if (result.cache.provider === 'mal') result.warning = 'AniList is unavailable. Showing MyAnimeList information while Seenary retries in the background.';
  else if (result.cache.stale) result.warning = 'Live title information is unavailable. Showing the latest details saved by Seenary.';
  result.providerMetrics = { anilist: document.sources.anilist?.metrics || {}, mal: document.sources.mal?.metrics || {} };
  for (const [camel, column] of Object.entries(METRICS)) if (document.sources.anilist?.metrics?.[column] !== undefined) result[camel] = document.sources.anilist.metrics[column];
  return result;
}
async function setupMetadata(db, prefix = '') {
  if (prefix && !/^batch1_test_[a-f0-9]+_$/.test(prefix)) throw new Error('Invalid test prefix.');
  const queries = db.collection(`${prefix}metadataQueries`);
  await queries.createIndex({ retryAt: 1 });
  await queries.createIndex({ kind: 1, lastAccessAt: 1 });
  // No TTL: expired provider responses remain useful during outages.
  return queries;
}
function createMetadataService({ media, repo, queries, provider, malCache = null, malMapping = null, malImport = null, now = () => Date.now(), requestSpacingMs = 1500 }) {
  const { fetchCached, schedule } = createProviderCache({ queries, now, requestSpacingMs });
  async function ingest(raw, type, group = 'card', observedAt = now()) {
    if (!raw || !validId(raw.id) || !['ANIME', 'MANGA'].includes(type) || raw.type && raw.type !== type || !raw.title) throw new Error('Invalid AniList media response.');
    let document = await media.ensure(type, 'anilist', raw.id);
    if (validId(raw.idMal) && document.malId !== raw.idMal) {
      try { document = await media.attachVerifiedMapping(document._id, { kind: 'anilist-idMal', type, anilistId: raw.id, malId: raw.idMal }); }
      catch { /* Personal-entry reconciliation belongs to the mapping workflow; metadata can still refresh. */ }
    }
    for (let attempt = 0; attempt < 8; attempt++) {
      document = await media.resolve(document._id);
      if (!document) throw new Error('Media identity changed.');
      const source = document.sources.anilist || {};
      if (new Date(source.groups?.[group]?.fetchedAt || 0).getTime() > observedAt) return document;
      const newerCard = new Date(source.observedAt || 0).getTime() > observedAt;
      if (newerCard && group === 'card') return document;
      const allowed = group === 'details' ? DETAIL_FIELDS.filter(key => !newerCard || !CARD_FIELDS.includes(key)) : CARD_FIELDS;
      const selected = Object.fromEntries(allowed.filter(key => raw[key] !== undefined).map(key => [key, raw[key]]));
      const details = mergePresent(source.details, selected);
      const metadata = { ...document.metadata };
      for (const [camel, value] of Object.entries(selected)) {
        if (value === null || value === undefined) continue;
        if (camel === 'title') {
          for (const [key, column] of Object.entries({ romaji: 'title_romaji', english: 'title_english', native: 'title_native', userPreferred: 'title_preferred' })) if (value[key]) metadata[column] = value[key];
        } else if (camel === 'coverImage') {
          if (value.large) metadata.cover_image_large = value.large;
          if (value.extraLarge) metadata.cover_image_extra_large = value.extraLarge;
        } else if (camel === 'status') metadata[type === 'ANIME' ? 'anime_status' : 'manga_status'] = value;
        else if (camel === 'recommendations') metadata.recommendations = details.recommendations?.nodes ?? metadata.recommendations;
        else if (!['staff', 'characters', 'relations', 'studios'].includes(camel)) metadata[COLUMNS[camel] || camel] = details[camel];
      }
      const metrics = { ...(source.metrics || {}) };
      for (const [camel, column] of Object.entries(METRICS)) if (!newerCard && typeof raw[camel] === 'number' && Number.isFinite(raw[camel])) metrics[column] = raw[camel];
      const groups = { ...(source.groups || {}) };
      // A card response never renews the details clock.
      const complete = group === 'card' || ['description', 'genres', 'staff', 'characters', 'relations', 'recommendations'].every(key => Object.hasOwn(raw, key));
      if (complete) groups[group] = { fetchedAt: new Date(observedAt), freshUntil: new Date(observedAt + refreshDelay(raw.status, { ...raw, type }, observedAt)) };
      const nextSource = { ...source, details, metrics, groups, observedAt: new Date(Math.max(observedAt, new Date(source.observedAt || 0).getTime())) };
      if (calculateObjectSize({ ...document, metadata, sources: { ...document.sources, anilist: nextSource } }) > 12 * 1024 * 1024) throw new Error('Metadata exceeds storage limit.');
      const updated = await repo.media.findOneAndUpdate({ _id: document._id, revision: document.revision }, { $set: { metadata,
        'sources.anilist': nextSource, updatedAt: new Date(now()) }, $inc: { revision: 1 } }, { returnDocument: 'after' });
      if (updated) return updated;
    }
    throw new Error('Metadata changed concurrently.');
  }
  async function ingestTree(value, hint, observedAt) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const item of value) await ingestTree(item, hint, observedAt); return; }
    const type = value.type || hint;
    if (validId(value.id) && value.title && ['ANIME', 'MANGA'].includes(type)) { await ingest(value, type, 'card', observedAt); return; }
    for (const [key, item] of Object.entries(value)) await ingestTree(item, key === 'anime' ? 'ANIME' : key === 'manga' ? 'MANGA' : hint, observedAt);
  }
  async function savedSearch(text, hideAdultContent) {
    const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const filter = { $or: ['title_preferred', 'title_english', 'title_romaji', 'title_native'].map(key => ({ [`metadata.${key}`]: { $regex: escaped, $options: 'i' } })),
      ...(hideAdultContent ? { 'metadata.is_adult': { $in: [false, 0] } } : {}) };
    const documents = await repo.media.find(filter).sort({ _id: 1 }).limit(40).toArray();
    return { anime: documents.filter(item => item.type === 'ANIME').map(item => toMedia(item, { stale: true })),
      manga: documents.filter(item => item.type === 'MANGA').map(item => toMedia(item, { stale: true })), characters: [], studios: [],
      warnings: [{ provider: 'anilist', message: 'AniList is unavailable. Showing matches from the saved catalog.' }] };
  }
  return {
    ingest,
    async previewMalImport(username) {
      if (!malImport) throw new Error('MAL imports are unavailable.');
      return malImport.preview(username);
    },
    async previewImport(username) {
      if (typeof username !== 'string' || !username.trim() || username.length > 80) throw new Error('Invalid AniList username.');
      const groups = [];
      const statuses = { CURRENT: 'watching', REPEATING: 'watching', PLANNING: 'planned', COMPLETED: 'completed', PAUSED: 'paused', DROPPED: 'dropped' };
      const date = value => {
        if (!value?.year || !value.month || !value.day) return undefined;
        const text = `${value.year}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`;
        return Number.isFinite(Date.parse(text)) && new Date(text).toISOString().slice(0, 10) === text ? text : undefined;
      };
      for (const type of ['ANIME', 'MANGA']) {
        // Personal collection responses are never persisted in the shared query cache.
        const observedAt = now();
        const collection = await schedule(() => provider.collection(type, username.trim()));
        if (!Array.isArray(collection?.lists)) throw new Error('Invalid AniList collection.');
        const seen = new Set();
        const items = [];
        for (const list of collection.lists) for (const entry of list.entries || []) {
          const raw = entry.media;
          const status = statuses[entry.status];
          if (!validId(raw?.id) || !status || seen.has(raw.id)) continue;
          seen.add(raw.id);
          // Ingest only the whitelisted public media object, never personal scores, notes, or progress.
          await ingest(raw, type, 'card', observedAt);
          items.push({ animeId: raw.id, ...(type === 'MANGA' ? { mangaId: raw.id } : {}), mediaId: raw.id, mediaType: type,
            status, progress: entry.progress, volumeProgress: entry.progressVolumes, score: entry.score, notes: entry.notes,
            startedAt: date(entry.startedAt), completedAt: date(entry.completedAt), repeatCount: entry.repeat,
            isRepeating: entry.status === 'REPEATING', title: raw.title, coverImage: raw.coverImage, episodes: raw.episodes,
            chapters: raw.chapters, volumes: raw.volumes, format: raw.format, media: raw });
        }
        for (const status of ['watching', 'planned', 'completed', 'paused', 'dropped']) {
          const selected = items.filter(item => item.status === status);
          if (selected.length) groups.push({ status, mediaType: type, items: selected });
        }
      }
      const count = type => groups.filter(group => group.mediaType === type).reduce((sum, group) => sum + group.items.length, 0);
      return { ok: true, username: username.trim(), preview: { groups, totalFound: count('ANIME') + count('MANGA'), animeFound: count('ANIME'), mangaFound: count('MANGA') } };
    },
    async details(type, id) {
      if (malCache && Number.isSafeInteger(id) && id < 0 && ['ANIME', 'MANGA'].includes(type)) {
        const mapped = await media.byProvider(type, 'mal', -id);
        if (mapped?.anilistId) return this.details(type, mapped.anilistId);
        let saved;
        try { saved = await malCache.details(type, -id); }
        catch (error) {
          const mapping = malMapping ? await malMapping.resolve(type, -id) : null;
          if (mapping?.status === 'mapped') return this.details(type, mapping.anilistId);
          throw error;
        }
        const mapping = malMapping ? await malMapping.resolve(type, -id) : null;
        if (mapping?.status === 'mapped') return this.details(type, mapping.anilistId);
        return { ...saved, ...(mapping ? { mapping, ...(mapping.status === 'review-required' ? {
          warning: 'This title has conflicting linked records. Your entries are preserved; mapping needs review.' } : {}) } : {}) };
      }
      if (!['ANIME', 'MANGA'].includes(type) || !validId(id)) throw new Error('Invalid media identity.');
      let document = await media.byProvider(type, 'anilist', id);
      if (document && new Date(document.sources.anilist?.groups?.details?.freshUntil || 0).getTime() > now()) return toMedia(document, { stale: false });
      try {
        const result = await fetchCached(`details:${type}:${id}`, () => provider.details(type, id), 6 * HOUR, async (raw, observedAt) => {
          if (raw?.id !== id) throw new Error('AniList returned another title.');
          await ingest(raw, type, 'details', observedAt);
          if (!['description', 'genres', 'staff', 'characters', 'relations', 'recommendations'].every(key => Object.hasOwn(raw, key))) throw new Error('Partial details response.');
        });
        document = await media.byProvider(type, 'anilist', id);
        if (result.stale && document?.malId && malCache) {
          try { return await malCache.details(type, document.malId); } catch { /* Preserve AL saved fallback. */ }
        }
        return toMedia(document, { stale: result.stale });
      } catch (error) {
        document = await media.byProvider(type, 'anilist', id);
        if (document?.malId && malCache) {
          try { return await malCache.details(type, document.malId); } catch { /* Preserve AL saved fallback. */ }
        }
        if (document && (document.metadata.title_romaji || document.metadata.title_english || document.sources.anilist?.details?.title)) return toMedia(document, { stale: true, fallback: 'saved-catalog' });
        throw error;
      }
    },
    async query(method, args) {
      if (method === 'getArtistMedia') {
        const [slug, page = 1, hideAdult = true] = args;
        if (typeof slug !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(slug) || !Number.isInteger(page) || page < 1 || page > 100) throw new Error('Invalid artist page.');
        // Cache AnimeThemes associations separately, with their own source identity and clock.
        const associations = await fetchCached(JSON.stringify(['animethemes:artist', slug, page]), () => provider.artistAssociations(slug, page), 24 * HOUR, async payload => {
          if (!payload?.artist || !Array.isArray(payload.items)) throw new Error('Invalid AnimeThemes artist response.');
        });
        const ids = [...new Set(associations.payload.items.map(item => item.anilistId).filter(validId))].sort((a, b) => a - b);
        if (ids.length > 200) throw new Error('Artist page exceeds media lookup limit.');
        let stale = associations.stale;
        if (ids.length) {
          try {
            const cards = await fetchCached(JSON.stringify(['anilist:artist-cards', ids, hideAdult !== false]), () => provider.cards(ids, hideAdult !== false), HOUR, async (payload, time) => {
              if (!Array.isArray(payload) || payload.some(item => !ids.includes(item.id))) throw new Error('Invalid AniList card response.');
              for (const item of payload) await ingest(item, 'ANIME', 'card', time);
            });
            stale ||= cards.stale;
          } catch { stale = true; }
        }
        const documents = ids.length ? await repo.media.find({ type: 'ANIME', anilistId: { $in: ids }, ...(hideAdult !== false ? { 'metadata.is_adult': { $in: [false, 0] } } : {}) }).toArray() : [];
        const byId = new Map(documents.map(document => [document.anilistId, toMedia(document, { stale })]));
        return { artist: associations.payload.artist, pageInfo: associations.payload.pageInfo,
          items: associations.payload.items.flatMap(item => byId.has(item.anilistId) ? [{ artist: item.artist, creditedAs: item.creditedAs, song: item.song, theme: item.theme,
            previewUrl: item.previewUrl, media: byId.get(item.anilistId) }] : []),
          ...(stale ? { warning: 'Some artist or title information is being served from the saved cache.' } : {}) };
      }
      if (method === 'getCharacterDetails' || method === 'getStaffDetails') {
        const id = Number(args[0]);
        const kind = method === 'getCharacterDetails' ? 'character' : 'staff';
        if (!validId(id)) throw new Error('Invalid person identity.');
        const result = await fetchCached(`${kind}:${id}`, () => provider.person(kind, id), 7 * 24 * HOUR, payload => {
          if (payload?.id !== id || !payload.name || typeof payload.name !== 'object') throw new Error('Invalid person response.');
        });
        return { ...result.payload, ...(result.stale ? { warning: 'Showing a saved profile while AniList is unavailable.' } : {}) };
      }
      if (method === 'getAnimeThemeMusic') {
        const id = Number(args[0]);
        const titles = Array.isArray(args[1]) ? args[1].filter(value => typeof value === 'string' && value.trim()).slice(0, 20).map(value => value.trim().slice(0, 300)) : [];
        if (!validId(id)) throw new Error('Invalid Anime identity.');
        const result = await fetchCached(JSON.stringify(['animethemes:title', id, titles]), () => provider.themes(id, titles), 24 * HOUR, payload => {
          if (!Array.isArray(payload) || payload.length > 500) throw new Error('Invalid AnimeThemes response.');
        });
        return result.stale ? result.payload.map(item => ({ ...item, cache: { stale: true } })) : result.payload;
      }
      if (method === 'searchMedia') {
        const text = String(args[0] || '').trim();
        if (text.length < 2 || text.length > 150) return { anime: [], manga: [], characters: [], studios: [] };
        const hideAdultContent = args[1] !== false;
        try {
          const result = await fetchCached(JSON.stringify([method, text.toLowerCase(), hideAdultContent]), () => provider.search(text, hideAdultContent), HOUR, (payload, time) => {
            if (!Array.isArray(payload?.anime) || !Array.isArray(payload?.manga)) throw new Error('Invalid search response.');
            return ingestTree(payload, null, time);
          });
          return { ...result.payload, ...(result.stale ? { warnings: [{ provider: 'anilist', message: 'Showing a saved search while AniList is unavailable.' }] } : {}) };
        } catch { return savedSearch(text, hideAdultContent); }
      }
      if (method === 'getDiscoverMedia') {
        const hideAdultContent = args[0] !== false;
        try {
          const result = await fetchCached(JSON.stringify([method, hideAdultContent]), () => provider.discover(hideAdultContent), HOUR, (payload, time) => {
            if (!Array.isArray(payload?.anime?.shelves) || !Array.isArray(payload?.manga?.shelves)) throw new Error('Invalid discovery response.');
            return ingestTree(payload, null, time);
          });
          const payload = structuredClone(result.payload);
          if (result.stale) for (const type of ['anime', 'manga']) {
            if (Array.isArray(payload[type]?.shelves)) payload[type].shelves = payload[type].shelves.map(shelf => ({ ...shelf, warning: shelf.warning || 'Showing saved discovery results while AniList is unavailable.' }));
          }
          return { ...payload, cache: { stale: result.stale } };
        } catch {
          const documents = await repo.media.find(hideAdultContent ? { 'metadata.is_adult': { $in: [false, 0] } } : {}).sort({ _id: 1 }).limit(80).toArray();
          const section = type => ({ trending: [], shelves: [{ id: 'saved-catalog', title: 'Saved catalog', description: 'AniList is unavailable. These titles are saved in Seenary.',
            items: documents.filter(item => item.type === type).map(item => toMedia(item, { stale: true })), warning: 'Live discovery is unavailable.' }] });
          return { anime: section('ANIME'), manga: section('MANGA'), cache: { stale: true, fallback: 'saved-catalog' } };
        }
      }
      if (method === 'getDiscoverShelfAnime') {
        const [shelfId, inputPage = 1, hideAdult = true, type = 'ANIME'] = args;
        if (typeof shelfId !== 'string' || !/^[a-z0-9-]{1,60}$/.test(shelfId) || !Number.isInteger(inputPage) || inputPage < 1 || inputPage > 100 || !['ANIME', 'MANGA'].includes(type)) throw new Error('Invalid discovery page.');
        const hideAdultContent = hideAdult !== false;
        try {
          const result = await fetchCached(JSON.stringify([method, shelfId, inputPage, hideAdultContent, type]), () => provider.shelf(shelfId, inputPage, hideAdultContent, type), HOUR, (payload, time) => {
            if (!Array.isArray(payload?.items)) throw new Error('Invalid shelf response.');
            return ingestTree(payload.items, type, time);
          });
          return { ...result.payload, ...(result.stale ? { warning: 'Showing a saved page while AniList is unavailable.' } : {}) };
        } catch {
          // Do not pretend arbitrary saved titles are the requested ranking/page.
          return { id: shelfId, items: [], pageInfo: { currentPage: inputPage, lastPage: inputPage, hasNextPage: false }, warning: 'This discovery page is not cached and AniList is unavailable.' };
        }
      }
      if (method === 'getStudioMedia') {
        const [id, page = 1, hideAdult = true] = args;
        if (!validId(id) || !Number.isInteger(page) || page < 1 || page > 100) throw new Error('Invalid studio page.');
        const result = await fetchCached(JSON.stringify([method, id, page, hideAdult !== false]), () => provider.studio(id, page, hideAdult !== false), HOUR, (payload, time) => {
          if (payload?.studio?.id !== id || !Array.isArray(payload.items)) throw new Error('Invalid studio response.');
          return ingestTree(payload.items, 'ANIME', time);
        });
        return { ...result.payload, ...(result.stale ? { warning: 'Showing a saved studio page while AniList is unavailable.' } : {}) };
      }
      throw new Error('Unsupported metadata query.');
    },
  };
}
module.exports = { createMetadataService, setupMetadata, mergePresent, toMedia, refreshDelay };
