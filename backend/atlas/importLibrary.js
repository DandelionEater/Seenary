const crypto = require('node:crypto');
const { DEFAULT_FIELDS, validatePatch, entryKey, allocateSequence, digest } = require('./library');

function readLibraryData(filename) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    db.exec('BEGIN');
    if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('Invalid SQLite source.');
    return ['ANIME', 'MANGA'].flatMap((type) => db.prepare(`SELECT * FROM user_${type === 'ANIME' ? 'anime' : 'manga'}_lists ORDER BY user_id, id`).all().map((row) => ({ type, row })));
  } finally { db.close(); }
}
function date(value, optional = false) {
  if (value == null && optional) return null;
  if (typeof value !== 'string') throw new Error('Missing timestamp.');
  const result = new Date(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value) ? value.replace(' ', 'T') + 'Z' : value);
  if (Number.isNaN(result.getTime())) throw new Error('Invalid timestamp.');
  return result;
}
function convertLibraryRow({ type, row }) {
  if (!['ANIME', 'MANGA'].includes(type) || ![row.id, row.user_id, row[type === 'ANIME' ? 'anime_id' : 'manga_id']].every((id) => Number.isSafeInteger(id) && id > 0)) throw new Error('Invalid source identity.');
  const repeating = row[type === 'ANIME' ? 'is_rewatching' : 'is_rereading'] ?? 0;
  if (![0, 1].includes(row.is_favorite) || ![0, 1].includes(repeating)) throw new Error('Invalid source flags.');
  const fields = validatePatch({ status: row.status, isFavorite: row.is_favorite === 1,
    progress: row.progress, volumeProgress: type === 'MANGA' ? row.volume_progress ?? 0 : 0,
    score: row.score ?? null, notes: row.notes ?? null, startedAt: row.started_at ?? null, completedAt: row.completed_at ?? null,
    repeatCount: row.repeat_count ?? 0, isRepeating: repeating === 1 }, type);
  return { ...fields, createdAt: date(row.created_at), updatedAt: date(row.updated_at), localUpdatedAt: date(row.local_updated_at, true) };
}

async function importLibrary({ client, repo, data, source, apply = false, verify = false, progress = () => {} }) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(source || '')) throw new Error('Stable source required.');
  const report = { mode: verify ? 'verify' : apply ? 'apply' : 'dry-run', total: data.length,
    anime: data.filter((row) => row.type === 'ANIME').length, manga: data.filter((row) => row.type === 'MANGA').length,
    favorites: data.filter(({ row }) => row.is_favorite === 1).length, ready: 0, imported: 0, unchanged: 0, verified: 0, conflicts: [] };
  const users = new Map((await repo.users.find({ status: { $ne: 'deleted' } }).toArray()).map((row) => [row.legacyKey, row]));
  const mediaMappings = new Map((await repo.mediaMigrationReceipts.find({ source }).toArray()).map((row) => [row._id, row]));
  const media = new Map((await repo.media.find({}).toArray()).map((row) => [row._id, row]));
  const receipts = new Map((await repo.libraryMigrationReceipts.find({ source }).toArray()).map((row) => [row._id, row]));
  const entries = new Map((await repo.libraryEntries.find({}).toArray()).map((row) => [row._id, row]));
  const pending = []; const seen = new Set();
  for (const record of data) {
    try {
      const fields = convertLibraryRow(record);
      const { type, row } = record;
      const user = users.get(JSON.stringify([source, row.user_id]));
      if (!user) throw new Error('Account missing or deleted.');
      const mapping = mediaMappings.get(JSON.stringify([source, type, row[type === 'ANIME' ? 'anime_id' : 'manga_id']]));
      const canonical = mapping && media.get(mapping.mediaId);
      if (!canonical || canonical.type !== type) throw new Error('Media mapping missing.');
      const key = entryKey(user._id, canonical._id);
      if (seen.has(key)) throw new Error('Multiple entries map to one title; reconciliation required.');
      seen.add(key);
      const receiptId = JSON.stringify([source, type, row.id]);
      const fingerprint = digest(record);
      const previous = receipts.get(receiptId);
      const current = entries.get(key);
      if (previous) {
        if (previous.fingerprint !== fingerprint || previous.userId !== user._id || previous.mediaId !== canonical._id) throw new Error('Source or mapping changed since import.');
        if (verify) {
          if (!current || current.deleted || digest(previous.snapshot) !== fingerprint) throw new Error('Missing imported entry.');
          for (const [field, value] of Object.entries(fields)) if (JSON.stringify(current[field]) !== JSON.stringify(value)) throw new Error('Imported field differs.');
          report.verified++;
        } else report.unchanged++;
        continue;
      }
      if (verify) throw new Error('Missing import receipt.');
      if (current) throw new Error('Cloud entry already exists; review instead of overwriting.');
      pending.push({ entry: { _id: key, userId: user._id, mediaId: canonical._id, type, ...DEFAULT_FIELDS, ...fields, deleted: false, revision: 1 },
        receipt: { _id: receiptId, source, userId: user._id, mediaId: canonical._id, fingerprint, snapshot: record, importedAt: new Date() } });
    } catch (error) { report.conflicts.push({ type: record.type, legacyEntryId: record.row.id, reason: error.message }); }
  }
  report.ready = pending.length;
  if (apply && !verify && !report.conflicts.length) {
    const userIds = [...new Set(pending.map((item) => item.entry.userId))];
    let processed = 0;
    for (const userId of userIds) {
      const items = pending.filter((item) => item.entry.userId === userId);
      for (let offset = 0; offset < items.length; offset += 40) {
        const batch = items.slice(offset, offset + 40);
        const session = client.startSession();
        try {
          const inserted = await session.withTransaction(async () => {
            const user = await repo.users.updateOne({ _id: userId, status: { $ne: 'deleted' } }, { $inc: { lifecycleRevision: 1 } }, { session });
            if (!user.matchedCount) throw new Error('Account changed during import.');
            const committed = new Map((await repo.libraryMigrationReceipts.find({ _id: { $in: batch.map((item) => item.receipt._id) } }, { session }).toArray()).map((row) => [row._id, row]));
            const remaining = batch.filter((item) => {
              const prior = committed.get(item.receipt._id);
              if (prior && prior.fingerprint !== item.receipt.fingerprint) throw new Error('Concurrent import conflict.');
              return !prior;
            });
            if (!remaining.length) return 0;
            const touched = await repo.media.updateMany({ _id: { $in: remaining.map((item) => item.entry.mediaId) } }, { $inc: { libraryReferenceRevision: 1 } }, { session });
            if (touched.matchedCount !== remaining.length) throw new Error('Media changed during import; rerun.');
            const state = await allocateSequence(repo, userId, session, remaining.length);
            const documents = remaining.map((item, index) => ({ ...item.entry, sequence: state.sequence - remaining.length + index + 1 }));
            await repo.libraryEntries.insertMany(documents, { session });
            await repo.libraryChanges.insertMany(documents.map((entry) => ({ _id: crypto.randomUUID(), userId, mediaId: entry.mediaId,
              epoch: state.epoch, sequence: entry.sequence, entry, createdAt: new Date(), origin: 'migration' })), { session });
            await repo.libraryMigrationReceipts.insertMany(remaining.map((item) => item.receipt), { session });
            // Importing historical data must never echo writes to live providers.
            return documents.length;
          });
          report.imported += inserted; report.unchanged += batch.length - inserted;
          processed += batch.length; progress({ processed, total: pending.length });
        } finally { await session.endSession(); }
      }
    }
  }
  return report;
}
module.exports = { readLibraryData, convertLibraryRow, importLibrary };
