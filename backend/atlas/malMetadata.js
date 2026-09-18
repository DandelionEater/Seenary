const { calculateObjectSize } = require('bson');
const { validId, fillMissing } = require('./media');
const { mergePresent, refreshDelay } = require('./metadata');

const STATUS = { currently_airing: 'RELEASING', currently_publishing: 'RELEASING', finished_airing: 'FINISHED',
  finished: 'FINISHED', not_yet_aired: 'NOT_YET_RELEASED', not_yet_published: 'NOT_YET_RELEASED',
  on_hiatus: 'HIATUS', discontinued: 'CANCELLED' };
const CARD = ['title', 'main_picture', 'alternative_titles', 'start_date', 'end_date', 'media_type', 'status', 'nsfw',
  'num_episodes', 'num_chapters', 'num_volumes'];
const DETAILS = [...CARD, 'synopsis', 'genres', 'studios', 'source', 'rating', 'average_episode_duration'];
const METRICS = ['mean', 'rank', 'popularity', 'num_list_users', 'num_scoring_users'];

// Project nested fields too: personal list state and arbitrary provider additions never enter shared storage.
function publicFields(raw, fields) {
  const selected = {};
  for (const key of fields) {
    const value = raw[key];
    if (value == null) continue;
    if (key === 'main_picture') {
      const picture = Object.fromEntries(['medium', 'large'].filter(k => typeof value[k] === 'string').map(k => [k, value[k]]));
      if (Object.keys(picture).length) selected[key] = picture;
    } else if (key === 'alternative_titles') {
      selected[key] = Object.fromEntries(['en', 'ja'].filter(k => typeof value[k] === 'string').map(k => [k, value[k]]));
      if (Array.isArray(value.synonyms)) selected[key].synonyms = value.synonyms.filter(item => typeof item === 'string');
    } else if (['genres', 'studios'].includes(key)) {
      if (Array.isArray(value)) selected[key] = value.filter(item => validId(item?.id) && typeof item.name === 'string').map(({ id, name }) => ({ id, name }));
    } else if (key.startsWith('num_') || key === 'average_episode_duration') {
      if (Number.isSafeInteger(value) && value >= 0) selected[key] = value;
    } else if (typeof value === 'string') selected[key] = value;
  }
  return selected;
}
function canonical(details, type) {
  const result = { title_romaji: details.title };
  const map = { synopsis: 'description', num_episodes: 'episodes', num_chapters: 'chapters', num_volumes: 'volumes' };
  for (const [key, column] of Object.entries(map)) if (details[key] !== undefined) result[column] = details[key];
  if (details.main_picture?.large || details.main_picture?.medium) result.cover_image_large = details.main_picture.large || details.main_picture.medium;
  if (details.alternative_titles?.en) result.title_english = details.alternative_titles.en;
  if (details.alternative_titles?.ja) result.title_native = details.alternative_titles.ja;
  if (details.alternative_titles?.synonyms) result.synonyms = details.alternative_titles.synonyms;
  if (details.genres) result.genres = details.genres.map(item => item.name);
  if (STATUS[details.status]) result[type === 'ANIME' ? 'anime_status' : 'manga_status'] = STATUS[details.status];
  if (['white', 'gray', 'black'].includes(details.nsfw)) result.is_adult = details.nsfw !== 'white';
  return Object.fromEntries(Object.entries(result).filter(([, value]) => value !== undefined));
}
function createMalMetadataService({ media, repo, now = () => Date.now() }) {
  return {
    async promoteFallback(id) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const document = await media.resolve(id);
        if (!document?.sources.mal?.details) return document;
        const al = document.sources.anilist || {};
        const mal = document.sources.mal;
        const detailFresh = new Date(al.groups?.details?.freshUntil || 0).getTime() > now();
        const cardFresh = new Date(al.groups?.card?.freshUntil || 0).getTime() > now();
        let metadata = structuredClone(document.metadata);
        for (const [key, value] of Object.entries(canonical(mal.details, document.type))) {
          // A new MAL card/partial response must not make an old synopsis look newer than AL.
          const fieldTime = mal.fieldObservedAt?.[key] || mal.groups?.details?.fetchedAt || 0;
          const alNewer = new Date(al.observedAt || 0).getTime() > new Date(fieldTime).getTime();
          const protectedField = alNewer || detailFresh || cardFresh && !['description', 'genres'].includes(key);
          metadata = protectedField ? fillMissing(metadata, { [key]: value }) : mergePresent(metadata, { [key]: value });
        }
        if (JSON.stringify(metadata) === JSON.stringify(document.metadata)) return document;
        if (calculateObjectSize({ ...document, metadata }) > 12 * 1024 * 1024) throw new Error('MAL metadata exceeds storage limit.');
        const updated = await repo.media.findOneAndUpdate({ _id: document._id, revision: document.revision },
          { $set: { metadata, updatedAt: new Date(now()) }, $inc: { revision: 1 } }, { returnDocument: 'after' });
        if (updated) return updated;
      }
      throw new Error('MAL fallback changed concurrently.');
    },
    async ingest(raw, type, group = 'card', observedAt = now()) {
      if (!raw || !validId(raw.id) || !['ANIME', 'MANGA'].includes(type) || !['card', 'details'].includes(group)
        || typeof raw.title !== 'string' || !raw.title.trim() || !Number.isFinite(observedAt) || observedAt < 0
        || !Number.isFinite(new Date(observedAt).getTime())) throw new Error('Invalid MAL metadata.');
      const fields = group === 'details' ? DETAILS : CARD;
      const projected = publicFields(raw, fields);
      if (calculateObjectSize(projected) > 12 * 1024 * 1024) throw new Error('MAL metadata exceeds storage limit.');
      let document = await media.ensure(type, 'mal', raw.id);
      for (let attempt = 0; attempt < 8; attempt++) {
        document = await media.resolve(document._id);
        if (!document || document.type !== type || document.malId !== raw.id) throw new Error('MAL identity changed.');
        const source = document.sources.mal || {};
        if (new Date(source.groupObservedAt?.[group] || 0).getTime() > observedAt) return document;
        const newer = new Date(source.observedAt || 0).getTime() > observedAt;
        if (newer && group === 'card') return document;
        const selected = newer ? Object.fromEntries(Object.entries(projected).filter(([key]) => !CARD.includes(key))) : projected;
        const details = mergePresent(source.details, selected);
        const metrics = { ...(source.metrics || {}) };
        if (!newer) for (const key of METRICS) if (typeof raw[key] === 'number' && Number.isFinite(raw[key]) && raw[key] >= 0
          && (key !== 'mean' || raw[key] <= 10)) metrics[key] = raw[key];
        const groups = { ...(source.groups || {}) };
        const complete = group === 'card' || ['synopsis', 'genres', 'status', type === 'ANIME' ? 'num_episodes' : 'num_chapters',
          ...(type === 'MANGA' ? ['num_volumes'] : [])].every(key => Object.hasOwn(projected, key));
        if (complete) groups[group] = { fetchedAt: new Date(observedAt), freshUntil: new Date(observedAt + refreshDelay(STATUS[raw.status])) };
        const fieldObservedAt = { ...source.fieldObservedAt };
        for (const key of Object.keys(canonical(selected, type))) fieldObservedAt[key] = new Date(observedAt);
        const nextSource = { ...source, details, metrics, groups, fieldObservedAt,
          groupObservedAt: { ...source.groupObservedAt, [group]: new Date(observedAt) },
          observedAt: new Date(Math.max(observedAt, new Date(source.observedAt || 0).getTime())) };
        // Checkpoint 1 only fills holes. AL-first overwrite/fallback policy follows in checkpoint 2.
        const metadata = fillMissing(document.metadata, canonical(details, type));
        if (calculateObjectSize({ ...document, metadata, sources: { ...document.sources, mal: nextSource } }) > 12 * 1024 * 1024) throw new Error('MAL metadata exceeds storage limit.');
        const updated = await repo.media.findOneAndUpdate({ _id: document._id, revision: document.revision },
          { $set: { metadata, 'sources.mal': nextSource, updatedAt: new Date(now()) }, $inc: { revision: 1 } }, { returnDocument: 'after' });
        if (updated) return updated;
      }
      throw new Error('MAL metadata changed concurrently.');
    },
  };
}
module.exports = { createMalMetadataService };
