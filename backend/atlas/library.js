const crypto = require('node:crypto');
const { tokenHash } = require('./accounts');

const DEFAULT_FIELDS = { status: 'planned', isFavorite: false, progress: 0, volumeProgress: 0, score: null,
  notes: null, startedAt: null, completedAt: null, repeatCount: 0, isRepeating: false };
const SYNC_FIELDS = Object.keys(DEFAULT_FIELDS).filter((key) => key !== 'isFavorite');
const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pack = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
function unpack(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Invalid cursor.');
  const result = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid cursor.');
  return result;
}
function validatePatch(value, type) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid entry fields.');
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (!Object.hasOwn(DEFAULT_FIELDS, key)) throw new Error('Unknown library field.');
    const item = value[key];
    if (key === 'status' && !['planned', 'watching', 'completed', 'paused', 'dropped'].includes(item)) throw new Error('Invalid status.');
    if (['isFavorite', 'isRepeating'].includes(key) && typeof item !== 'boolean') throw new Error('Invalid flag.');
    if (['progress', 'volumeProgress', 'repeatCount'].includes(key) && (!Number.isSafeInteger(item) || item < 0 || item > 100000000)) throw new Error('Invalid progress.');
    if (key === 'volumeProgress' && type === 'ANIME' && item !== 0) throw new Error('Volumes are only valid for manga.');
    if (key === 'score' && item !== null && (typeof item !== 'number' || !Number.isFinite(item) || item < 0 || item > 100)) throw new Error('Invalid score.');
    if (key === 'notes' && item !== null && (typeof item !== 'string' || item.length > 10000)) throw new Error('Invalid notes.');
    if (['startedAt', 'completedAt'].includes(key) && item !== null) {
      if (typeof item !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(item) || Number.isNaN(Date.parse(item)) || new Date(item).toISOString().slice(0, 10) !== item) throw new Error('Invalid date.');
    }
    result[key] = item;
  }
  return result;
}
const entryKey = (userId, mediaId) => JSON.stringify([userId, mediaId]);
const changeCursor = (state, sequence = state.sequence, type = null) => pack({ kind: 'changes', epoch: state.epoch, sequence, type });
function publicEntry(entry) {
  if (!entry) return null;
  const { userId, _id, ...result } = entry;
  return result;
}
function toRecommendationSeed(entry, media) {
  return { mediaId: media._id, type: media.type, anilistId: media.anilistId ?? null, malId: media.malId ?? null,
    ...(media.type === 'ANIME' ? { anime_id: media.anilistId ?? null } : { manga_id: media.anilistId ?? null }),
    is_favorite: entry.isFavorite, status: entry.status, score: entry.score,
    needsAniListMapping: !media.anilistId,
    recommendations: media.metadata.recommendations ?? media.sources.anilist?.details?.recommendations?.nodes ?? [],
  };
}
async function allocateSequence(repo, userId, session, count = 1) {
  return repo.libraryState.findOneAndUpdate({ _id: userId }, { $inc: { sequence: count },
    $setOnInsert: { epoch: crypto.randomUUID(), retainedFrom: 0 } }, { upsert: true, returnDocument: 'after', session });
}

function createLibraryService({ client, repo, accounts, media }) {
  async function withUser(token, operation) {
    const user = await accounts.getAuthenticatedUser(token);
    if (!user) return { ok: false, code: 'UNAUTHENTICATED' };
    const session = client.startSession();
    try {
      return await session.withTransaction(async () => {
        if (!await repo.sessions.findOne({ _id: tokenHash(token), userId: user._id, expiresAt: { $gt: new Date() } }, { session })) return { ok: false, code: 'UNAUTHENTICATED' };
        const current = await repo.users.findOneAndUpdate({ _id: user._id, authVersion: user.authVersion, status: { $ne: 'deleted' } },
          { $inc: { lifecycleRevision: 1 } }, { session, returnDocument: 'after' });
        if (!current) return { ok: false, code: 'UNAUTHENTICATED' };
        return operation(current, session);
      });
    } finally { await session.endSession(); }
  }
  async function readContext(token) {
    return withUser(token, async (user, session) => ({ ok: true, userId: user._id, state: await allocateSequence(repo, user._id, session, 0) }));
  }
  function pageOptions(options, allowed) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some((key) => !allowed.includes(key))) throw new Error('Invalid page options.');
    if (options.type != null && !['ANIME', 'MANGA'].includes(options.type)) throw new Error('Invalid media type.');
    const limit = options.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('Invalid page size.');
    return limit;
  }
  return {
    async mutate(token, request) {
      if (!request || typeof request !== 'object' || Array.isArray(request)
          || Object.keys(request).some((key) => !['operationId', 'mediaId', 'expectedRevision', 'action', 'patch', 'restore'].includes(key))
          || typeof request.operationId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(request.operationId)
          || typeof request.mediaId !== 'string' || request.mediaId.length > 100
          || !Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0
          || !['upsert', 'delete'].includes(request.action) || request.restore != null && typeof request.restore !== 'boolean') {
        return { ok: false, code: 'INVALID_MUTATION' };
      }
      let patch;
      try { patch = validatePatch(request.patch ?? {}, null); } catch { return { ok: false, code: 'INVALID_FIELDS' }; }
      if (request.action === 'delete' && (Object.keys(patch).length || request.restore)) return { ok: false, code: 'INVALID_MUTATION' };
      const fingerprint = digest({ mediaId: request.mediaId, expectedRevision: request.expectedRevision, action: request.action, patch, restore: Boolean(request.restore) });
      return withUser(token, async (user, session) => {
        const receiptId = entryKey(user._id, request.operationId);
        const receipt = await repo.mutationReceipts.findOne({ _id: receiptId }, { session });
        if (receipt) return receipt.fingerprint === fingerprint ? receipt.result : { ok: false, code: 'OPERATION_ID_REUSED' };
        const canonical = await media.resolve(request.mediaId, session);
        if (!canonical) return { ok: false, code: 'MEDIA_NOT_FOUND' };
        try { validatePatch(patch, canonical.type); } catch { return { ok: false, code: 'INVALID_FIELDS' }; }
        // Serialize against media consolidation so no list entry points at a disappearing identity.
        await repo.media.updateOne({ _id: canonical._id }, { $inc: { libraryReferenceRevision: 1 } }, { session });
        const id = entryKey(user._id, canonical._id);
        const current = await repo.libraryEntries.findOne({ _id: id }, { session });
        if ((current?.revision || 0) !== request.expectedRevision) return { ok: false, code: 'REVISION_CONFLICT', current: publicEntry(current) };
        if (current?.deleted && request.action === 'upsert' && !request.restore) return { ok: false, code: 'ENTRY_DELETED', current: publicEntry(current) };
        const deleted = request.action === 'delete';
        const fields = { ...DEFAULT_FIELDS, ...Object.fromEntries(Object.keys(DEFAULT_FIELDS).filter((key) => current && Object.hasOwn(current, key)).map((key) => [key, current[key]])), ...patch };
        const changed = !current || current.deleted !== deleted || Object.keys(DEFAULT_FIELDS).some((key) => current[key] !== fields[key]);
        let result;
        if (!changed) result = { ok: true, entry: publicEntry(current), providerSync: 'unchanged' };
        else {
          const state = await allocateSequence(repo, user._id, session);
          const now = new Date();
          const entry = { _id: id, userId: user._id, mediaId: canonical._id, type: canonical.type, ...fields, deleted,
            revision: (current?.revision || 0) + 1, sequence: state.sequence, createdAt: current?.createdAt || now, updatedAt: now, localUpdatedAt: now };
          await repo.libraryEntries.replaceOne({ _id: id }, entry, { upsert: true, session });
          await repo.libraryChanges.insertOne({ _id: crypto.randomUUID(), userId: user._id, mediaId: canonical._id,
            epoch: state.epoch, sequence: state.sequence, entry, createdAt: now }, { session });
          let providerSync = 'not_queued';
          const syncChanged = !current || current.deleted !== deleted || SYNC_FIELDS.some((key) => current[key] !== fields[key]);
          const policy = await repo.accountSettings.findOne({ _id: user._id }, { session });
          if (syncChanged && policy?.autoSyncEnabled === true) {
            const link = await repo.providerAccounts.findOne({ userId: user._id }, { session });
            if (link) {
              const providerMediaId = canonical[link.provider === 'anilist' ? 'anilistId' : 'malId'] ?? null;
              providerSync = providerMediaId ? 'pending' : 'blocked_mapping';
              await repo.jobs.insertOne({ _id: crypto.randomUUID(), kind: 'provider-library', userId: user._id, mediaId: canonical._id,
                provider: link.provider, providerLinkId: link._id, providerLinkRevision: link.revision, providerMediaId,
                libraryRevision: entry.revision, operation: deleted ? 'delete' : 'upsert', status: providerSync,
                payload: Object.fromEntries(SYNC_FIELDS.map((key) => [key, entry[key]])), mediaType: entry.type, createdAt: now }, { session });
            }
          }
          result = { ok: true, entry: publicEntry(entry), providerSync };
        }
        await repo.mutationReceipts.insertOne({ _id: receiptId, userId: user._id, fingerprint, result, createdAt: new Date() }, { session });
        return result;
      });
    },
    async get(token, mediaId) {
      if (typeof mediaId !== 'string' || mediaId.length > 100) return { ok: false, code: 'INVALID_MEDIA' };
      const context = await readContext(token);
      if (!context.ok) return context;
      const canonical = await media.resolve(mediaId);
      return { ok: true, entry: canonical ? publicEntry(await repo.libraryEntries.findOne({ userId: context.userId, mediaId: canonical._id })) : null };
    },
    async snapshot(token, options = {}) {
      let limit;
      try {
        limit = pageOptions(options, ['cursor', 'limit', 'type', 'includeDeleted']);
        if (options.includeDeleted !== undefined && typeof options.includeDeleted !== 'boolean') throw new Error('Invalid deletion filter.');
      } catch { return { ok: false, code: 'INVALID_PAGE' }; }
      const context = await readContext(token);
      if (!context.ok) return context;
      let snapshot; let after = ''; let snapshotToken;
      if (options.cursor) {
        try {
          const cursor = unpack(options.cursor);
          if (cursor.kind !== 'snapshot' || typeof cursor.token !== 'string' || !/^[a-f0-9]{64}$/.test(cursor.token)
              || typeof cursor.after !== 'string' || cursor.after.length > 100) throw new Error('Invalid cursor.');
          snapshotToken = cursor.token; after = cursor.after;
          snapshot = await repo.librarySnapshots.findOne({ _id: tokenHash(snapshotToken), userId: context.userId, expiresAt: { $gt: new Date() } });
        } catch { return { ok: false, code: 'FULL_SNAPSHOT_REQUIRED' }; }
        if (!snapshot || snapshot.epoch !== context.state.epoch || options.type !== undefined && options.type !== snapshot.type
          || options.includeDeleted !== undefined && options.includeDeleted !== Boolean(snapshot.includeDeleted)) return { ok: false, code: 'FULL_SNAPSHOT_REQUIRED' };
      } else {
        snapshotToken = crypto.randomBytes(32).toString('hex');
        const captured = await withUser(token, async (user, session) => {
          const state = await allocateSequence(repo, user._id, session, 0);
          const value = { _id: tokenHash(snapshotToken), userId: user._id, epoch: state.epoch,
            watermark: state.sequence, type: options.type ?? null, includeDeleted: options.includeDeleted ?? false, expiresAt: new Date(Date.now() + 30 * 60000) };
          // Store only a watermark: immutable change history reconstructs the frozen view.
          await repo.librarySnapshots.insertOne(value, { session });
          return { ok: true, snapshot: value };
        });
        if (!captured.ok) return captured;
        snapshot = captured.snapshot;
      }
      const entries = await repo.libraryChanges.aggregate([
        { $match: { userId: context.userId, epoch: snapshot.epoch, sequence: { $lte: snapshot.watermark } } },
        { $sort: { sequence: -1 } }, { $group: { _id: '$mediaId', entry: { $first: '$entry' } } },
        { $match: { _id: { $gt: after }, ...(snapshot.includeDeleted ? {} : { 'entry.deleted': false }), ...(snapshot.type ? { 'entry.type': snapshot.type } : {}) } },
        { $sort: { _id: 1 } }, { $limit: limit + 1 },
      ]).toArray();
      const more = entries.length > limit;
      const page = entries.slice(0, limit);
      return { ok: true, entries: page.map((row) => publicEntry(row.entry)),
        nextCursor: more ? pack({ kind: 'snapshot', token: snapshotToken, after: page.at(-1)._id }) : null,
        changeCursor: changeCursor(context.state, snapshot.watermark, snapshot.type) };
    },
    async changes(token, options = {}) {
      let limit; let cursor;
      try { limit = pageOptions(options, ['cursor', 'limit']); cursor = unpack(options.cursor); } catch { return { ok: false, code: 'FULL_SNAPSHOT_REQUIRED' }; }
      const context = await readContext(token);
      if (!context.ok) return context;
      const state = context.state;
      if (cursor.kind !== 'changes' || cursor.epoch !== state.epoch || !Number.isSafeInteger(cursor.sequence)
          || cursor.type != null && !['ANIME', 'MANGA'].includes(cursor.type)
          || cursor.sequence < state.retainedFrom || cursor.sequence > state.sequence) return { ok: false, code: 'FULL_SNAPSHOT_REQUIRED' };
      const rows = await repo.libraryChanges.find({ userId: context.userId, epoch: state.epoch,
        sequence: { $gt: cursor.sequence, $lte: state.sequence }, ...(cursor.type ? { 'entry.type': cursor.type } : {}) }).sort({ sequence: 1 }).limit(limit + 1).toArray();
      const more = rows.length > limit;
      const page = rows.slice(0, limit);
      return { ok: true, changes: page.map((row) => ({ sequence: row.sequence, entry: publicEntry(row.entry) })),
        nextCursor: changeCursor(state, more ? page.at(-1).sequence : state.sequence, cursor.type ?? null), hasMore: more };
    },
    async favoriteSeeds(token, options = {}) {
      let limit;
      try {
        limit = pageOptions(options, ['type', 'limit', 'after']);
        if (options.after != null && (typeof options.after !== 'string' || options.after.length > 100)) throw new Error('Invalid key.');
      } catch { return { ok: false, code: 'INVALID_PAGE' }; }
      const context = await readContext(token);
      if (!context.ok) return context;
      const rows = await repo.libraryEntries.find({ userId: context.userId, deleted: false, isFavorite: true,
        status: { $ne: 'dropped' }, ...(options.type ? { type: options.type } : {}), mediaId: { $gt: options.after || '' } }).sort({ mediaId: 1 }).limit(limit + 1).toArray();
      const page = rows.slice(0, limit);
      const seeds = [];
      for (const entry of page) {
        const canonical = await media.resolve(entry.mediaId);
        if (canonical) seeds.push(toRecommendationSeed(entry, canonical));
      }
      return { ok: true, seeds, nextAfter: rows.length > limit ? page.at(-1).mediaId : null };
    },
  };
}
module.exports = { createLibraryService, DEFAULT_FIELDS, validatePatch, entryKey, allocateSequence, publicEntry, toRecommendationSeed, digest };
