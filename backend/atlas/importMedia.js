const crypto = require('node:crypto');
const { BSON: { calculateObjectSize } } = require('mongodb');
const { validId, fillMissing } = require('./media');
const fingerprint = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function containsFields(actual, expected) {
  // Migration is append/refresh in place: an absent or null source value never erases richer saved metadata.
  if (expected == null) return true;
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    return actual && Object.entries(expected).every(([key, value]) => Object.hasOwn(actual, key) && containsFields(actual[key], value));
  }
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function readMediaData(filename) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    db.exec('BEGIN');
    if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('Invalid SQLite source.');
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
    const read = (name) => tables.has(name) ? db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all() : [];
    const anime = read('anime');
    const manga = read('manga');
    const extras = Object.fromEntries(['anime_tags', 'anime_staff', 'anime_characters'].map((name) => [name, read(name)]));
    const mappings = { ANIME: read('anime_external_ids'), MANGA: read('manga_external_ids') };
    const entries = [...anime.map((row) => ({ type: 'ANIME', row,
      extras: Object.fromEntries(Object.entries(extras).map(([name, rows]) => [name, rows.filter((item) => item.anime_id === row.id)])),
      mappings: mappings.ANIME.filter((item) => item.anime_id === row.id) })),
    ...manga.map((row) => ({ type: 'MANGA', row, extras: {}, mappings: mappings.MANGA.filter((item) => item.manga_id === row.id) }))];
    const ids = { ANIME: new Set(anime.map((row) => row.id)), MANGA: new Set(manga.map((row) => row.id)) };
    let orphanReferences = Object.entries(extras).reduce((n, [, rows]) => n + rows.filter((row) => !ids.ANIME.has(row.anime_id)).length, 0);
    for (const type of ['ANIME', 'MANGA']) orphanReferences += mappings[type].filter((row) => !ids[type].has(row[type === 'ANIME' ? 'anime_id' : 'manga_id'])).length;
    for (const type of ['ANIME', 'MANGA']) orphanReferences += read(type === 'ANIME' ? 'user_anime_lists' : 'user_manga_lists').filter((row) => !ids[type].has(row[type === 'ANIME' ? 'anime_id' : 'manga_id'])).length;
    return { entries, orphanReferences, missingOptionalMappingTables: ['anime_external_ids', 'manga_external_ids'].filter((name) => !tables.has(name)) };
  } finally { db.close(); }
}

function convertMedia(entry, source) {
  const { row, type } = entry;
  if (!validId(row.id) || !['ANIME', 'MANGA'].includes(type)) throw new Error('Invalid identity.');
  const details = row.details_json == null ? null : JSON.parse(row.details_json);
  if (details && (details.id !== row.id || details.type !== type)) throw new Error('Details identity mismatch.');
  const possibleMalIds = [];
  if (details?.idMal != null) possibleMalIds.push(details.idMal);
  for (const mapping of entry.mappings) {
    if (mapping.provider !== 'mal' || !/^\d+$/.test(mapping.external_id)) throw new Error('Unsupported legacy mapping.');
    possibleMalIds.push(Number(mapping.external_id));
  }
  if (possibleMalIds.some((id) => !validId(id)) || new Set(possibleMalIds).size > 1) throw new Error('Conflicting MAL mappings.');
  // Preserve all shared legacy fields. Keep source-specific scores outside metadata.
  const metadata = {};
  const metrics = {};
  const jsonColumns = new Set(['genres', 'synonyms', 'studios', 'relations', 'recommendations', 'external_links', 'streaming_episodes']);
  for (const [key, value] of Object.entries(row)) {
    if (['id', 'details_json', 'updated_at', 'cached_at'].includes(key)) continue;
    if (['average_score', 'mean_score', 'popularity', 'favourites'].includes(key)) { metrics[key] = value; continue; }
    metadata[key] = jsonColumns.has(key) && value != null ? JSON.parse(value) : value;
  }
  for (const [name, rows] of Object.entries(entry.extras)) metadata[name.slice('anime_'.length)] = rows.map(({ anime_id, ...item }) => item);
  // Rich manga response is retained as provider data; it cannot overwrite identities.
  const sources = { anilist: { metrics, legacyCachedAt: row.cached_at, legacyUpdatedAt: row.updated_at,
    completeness: 'legacy-unknown', ...(details ? { details } : {}) } };
  const now = new Date();
  const document = { _id: crypto.randomUUID(), type, anilistId: row.id, ...(possibleMalIds.length ? { malId: possibleMalIds[0] } : {}),
    metadata, sources, revision: 0, createdAt: now, updatedAt: now };
  const receipt = { _id: JSON.stringify([source, type, row.id]), mediaId: document._id,
    fingerprint: fingerprint(entry), snapshot: entry, source, type, legacyId: row.id, importedAt: now };
  if (calculateObjectSize(document) > 12 * 1024 * 1024 || calculateObjectSize(receipt) > 12 * 1024 * 1024) throw new Error('Record requires separate large-payload storage.');
  return { document, receipt };
}

async function importMedia({ client, repo, data, source, apply = false, verify = false, refresh = false, progress = () => {} }) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(source || '')) throw new Error('Stable source name required.');
  const report = { mode: verify ? 'verify' : apply ? 'apply' : 'dry-run', total: data.entries.length,
    anime: data.entries.filter((entry) => entry.type === 'ANIME').length, manga: data.entries.filter((entry) => entry.type === 'MANGA').length,
    withMalId: 0, ready: 0, imported: 0, refreshed: 0, unchanged: 0, verified: 0, conflicts: [],
    missingOptionalMappingTables: data.missingOptionalMappingTables };
  if (data.orphanReferences) report.conflicts.push({ reason: 'Orphan source references', count: data.orphanReferences });
  const existing = await repo.media.find({}).toArray();
  const receipts = new Map((await repo.mediaMigrationReceipts.find({ source }).toArray()).map((row) => [row._id, row]));
  const byId = new Map(existing.map((row) => [row._id, row]));
  const byAl = new Map(existing.filter((row) => row.anilistId).map((row) => [`${row.type}:${row.anilistId}`, row]));
  const byMal = new Map(existing.filter((row) => row.malId).map((row) => [`${row.type}:${row.malId}`, row]));
  const seen = new Set();
  const seenMal = new Set();
  const pending = [];
  for (const entry of data.entries) {
    try {
      const item = convertMedia(entry, source);
      const { document, receipt } = item;
      if (document.malId) report.withMalId++;
      if (seen.has(receipt._id)) throw new Error('Duplicate legacy identity.');
      seen.add(receipt._id);
      if (document.malId) {
        const key = `${document.type}:${document.malId}`;
        if (seenMal.has(key)) throw new Error('Duplicate MAL mapping.');
        seenMal.add(key);
      }
      const previous = receipts.get(receipt._id);
      if (previous) {
        if (previous.fingerprint !== receipt.fingerprint && !refresh) throw new Error('Source changed since import.');
        if (verify) {
          const current = byId.get(previous.mediaId);
          if (!current || current.type !== document.type || current.anilistId !== document.anilistId
              || document.malId && current.malId !== document.malId || fingerprint(previous.snapshot) !== receipt.fingerprint) throw new Error('Identity or snapshot mismatch.');
          if (!containsFields(current.metadata, document.metadata) || !containsFields(current.sources, document.sources)) throw new Error('Imported metadata mismatch.');
          report.verified++;
        } else if (previous.fingerprint !== receipt.fingerprint) {
          const current = byId.get(previous.mediaId);
          if (!current || current.type !== document.type || current.anilistId !== document.anilistId
              || document.malId && current.malId && current.malId !== document.malId) throw new Error('Identity changed during refresh.');
          document._id = current._id; receipt.mediaId = current._id;
          document.metadata = fillMissing(document.metadata, current.metadata);
          document.sources = fillMissing(document.sources, current.sources);
          pending.push({ document, receipt, refresh: true, existingRevision: current.revision, previousFingerprint: previous.fingerprint });
        } else report.unchanged++;
        continue;
      }
      if (verify) throw new Error('Missing migration receipt.');
      const al = byAl.get(`${document.type}:${document.anilistId}`);
      const mal = document.malId ? byMal.get(`${document.type}:${document.malId}`) : null;
      if (mal && mal._id !== al?._id) throw new Error('Existing MAL identity requires explicit reconciliation.');
      if (al?.malId && document.malId && al.malId !== document.malId) throw new Error('Conflicting provider mapping.');
      if (al) {
        document._id = al._id; receipt.mediaId = al._id;
        document.metadata = fillMissing(al.metadata, document.metadata);
        document.sources = fillMissing(al.sources, document.sources);
        item.existingRevision = al.revision;
      }
      pending.push(item);
    } catch (error) { report.conflicts.push({ type: entry.type, legacyId: entry.row.id, reason: error.message }); }
  }
  report.ready = pending.length;
  if (apply && !verify && !report.conflicts.length) {
    for (let offset = 0; offset < pending.length; offset += 40) {
      const batch = pending.slice(offset, offset + 40);
      const session = client.startSession();
      try {
        const count = await session.withTransaction(async () => {
          let written = 0;
          for (const item of batch) {
            const previous = await repo.mediaMigrationReceipts.findOne({ _id: item.receipt._id }, { session });
            if (previous) {
              if (item.refresh && previous.fingerprint === item.previousFingerprint) {
                const { metadata, sources, malId } = item.document;
                const changed = await repo.media.updateOne({ _id: item.document._id, revision: item.existingRevision }, {
                  $set: { metadata, sources, ...(malId ? { malId } : {}), updatedAt: new Date() }, $inc: { revision: 1 },
                }, { session });
                if (!changed.matchedCount) throw new Error('Media changed during refresh.');
                const receipt = await repo.mediaMigrationReceipts.replaceOne({ _id: item.receipt._id, fingerprint: item.previousFingerprint }, item.receipt, { session });
                if (!receipt.modifiedCount) throw new Error('Media receipt changed during refresh.');
                written++; item.wasRefreshed = true; continue;
              }
              if (previous.fingerprint !== item.receipt.fingerprint) throw new Error('Concurrent source conflict.');
              continue;
            }
            if (item.existingRevision != null) {
              const { metadata, sources, malId } = item.document;
              const result = await repo.media.updateOne({ _id: item.document._id, revision: item.existingRevision }, {
                $set: { metadata, sources, ...(malId ? { malId } : {}), updatedAt: new Date() }, $inc: { revision: 1 },
              }, { session });
              if (!result.matchedCount) throw new Error('Media changed during import; rerun preflight.');
            } else await repo.media.insertOne(item.document, { session });
            await repo.mediaMigrationReceipts.insertOne(item.receipt, { session });
            written++;
          }
          return written;
        });
        const refreshed = batch.filter(item => item.wasRefreshed).length; report.refreshed += refreshed;
        report.imported += count - refreshed; report.unchanged += batch.length - count;
        progress({ processed: Math.min(offset + 40, pending.length), total: pending.length });
      } finally { await session.endSession(); }
    }
  }
  return report;
}
module.exports = { readMediaData, convertMedia, importMedia };
