const COLLECTIONS = ['sinceYouLikedFeedback', 'sinceYouLikedHidden', 'sinceYouLikedLifecycle'];
const validId = value => Number.isSafeInteger(value) && value !== 0;
const validType = value => value === 'ANIME' || value === 'MANGA';
const validPair = value => value && validId(value.sourceMediaId) && validId(value.recommendedMediaId)
  && value.sourceMediaId !== value.recommendedMediaId;
const pairKey = row => `${row.sourceMediaId}:${row.recommendedMediaId}`;

async function setupSinceYouLiked(db, prefix = '') {
  if (prefix && !/^batch1_test_[a-f0-9]+_$/.test(prefix)) throw new Error('Invalid test prefix.');
  const repo = Object.fromEntries(COLLECTIONS.map(name => [name, db.collection(prefix + name)]));
  for (const name of COLLECTIONS) {
    if (name === 'sinceYouLikedLifecycle') {
      const validator = { $jsonSchema: { bsonType: 'object', required: ['_id', 'userId', 'mediaType', 'sourceMediaId', 'recommendedMediaId', 'createdAt'], properties: {
        _id: { bsonType: 'string' }, userId: { bsonType: 'string' }, mediaType: { enum: ['ANIME', 'MANGA'] },
        sourceMediaId: { bsonType: 'number' }, recommendedMediaId: { bsonType: 'number' }, createdAt: { bsonType: 'date' },
        completedObservedAt: { bsonType: 'date' }, settledAt: { bsonType: 'date' },
      } } };
      try { await db.createCollection(prefix + name, { validator, validationLevel: 'strict', validationAction: 'error' }); }
      catch (error) { if (error.code !== 48) throw error; }
      continue;
    }
    const feedback = name === 'sinceYouLikedFeedback';
    const validator = { $jsonSchema: { bsonType: 'object', required: ['_id', 'userId', 'mediaType', 'createdAt',
      ...(feedback ? ['sourceMediaId', 'recommendedMediaId', 'feedback', 'updatedAt'] : ['mediaId'])], properties: {
      _id: { bsonType: 'string' }, userId: { bsonType: 'string' }, mediaType: { enum: ['ANIME', 'MANGA'] },
      createdAt: { bsonType: 'date' }, updatedAt: { bsonType: 'date' },
      sourceMediaId: { bsonType: 'number' }, recommendedMediaId: { bsonType: 'number' }, mediaId: { bsonType: 'number' },
      feedback: { enum: ['like', 'dislike'] },
    } } };
    try { await db.createCollection(prefix + name, { validator, validationLevel: 'strict', validationAction: 'error' }); }
    catch (error) {
      if (error.code !== 48) throw error;
      const existing = await db.listCollections({ name: prefix + name }).next();
      if (JSON.stringify(existing?.options?.validator) !== JSON.stringify(validator)) throw new Error('Recommendation schema requires explicit migration.');
    }
  }
  await repo.sinceYouLikedFeedback.createIndex({ userId: 1, mediaType: 1, sourceMediaId: 1, recommendedMediaId: 1 }, { unique: true });
  await repo.sinceYouLikedFeedback.createIndex({ mediaType: 1, sourceMediaId: 1, recommendedMediaId: 1 });
  await repo.sinceYouLikedHidden.createIndex({ userId: 1, mediaType: 1, mediaId: 1 }, { unique: true });
  await repo.sinceYouLikedLifecycle.createIndex({ userId: 1, mediaType: 1, sourceMediaId: 1, recommendedMediaId: 1 }, { unique: true });
  return repo;
}

function createSinceYouLikedService({ repo, accounts, libraryRepo = null, mediaRepo = null, now = () => Date.now(), env = process.env }) {
  const weight = (key, fallback, min, max) => {
    const value = env[key] === undefined ? fallback : Number(env[key]);
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  };
  const likeWeight = weight('SINCE_LIKED_LIKE_WEIGHT', 2, 0, 20);
  const dislikeWeight = weight('SINCE_LIKED_DISLIKE_WEIGHT', -2, -20, 0);
  const maxAdjustment = weight('SINCE_LIKED_MAX_ADJUSTMENT', 10, 0, 100);
  const invalid = { ok: false, message: 'Invalid recommendation feedback request.' };
  async function lifecycle(user, type, pairs, track) {
    if (!repo.sinceYouLikedLifecycle || !libraryRepo || !mediaRepo) return { retainedMediaIds: [], resolvedMediaIds: [] };
    const collection = repo.sinceYouLikedLifecycle;
    if (track) for (const pair of pairs) {
      const _id = `${user._id}:${type}:${pairKey(pair)}`;
      try { await collection.updateOne({ _id }, { $setOnInsert: { userId: user._id, mediaType: type, ...pair, createdAt: new Date(now()) } }, { upsert: true }); }
      catch (error) { if (error.code !== 11000) throw error; }
    }
    const rows = await collection.find({ userId: user._id, mediaType: type }).toArray();
    const active = rows.filter(row => !row.settledAt);
    const ids = active.map(row => row.recommendedMediaId);
    const documents = ids.length ? await mediaRepo.media.find({ type, $or: [{ anilistId: { $in: ids.filter(id => id > 0) } }, { malId: { $in: ids.filter(id => id < 0).map(id => -id) } }] }).toArray() : [];
    const byId = new Map(documents.flatMap(doc => [[doc.anilistId, doc._id], [-doc.malId, doc._id]]));
    const entries = documents.length ? await libraryRepo.libraryEntries.find({ userId: user._id, type, mediaId: { $in: documents.map(doc => doc._id) }, deleted: false }).toArray() : [];
    const byMedia = new Map(entries.map(entry => [entry.mediaId, entry]));
    const hidden = new Set((await repo.sinceYouLikedHidden.find({ userId: user._id, mediaType: type }).toArray()).map(row => row.mediaId));
    for (const row of active) {
      if (hidden.has(row.recommendedMediaId)) {
        if (row.completedObservedAt) await collection.updateOne({ _id: row._id }, { $unset: { completedObservedAt: '' } });
        continue;
      }
      const entry = byMedia.get(byId.get(row.recommendedMediaId));
      if (row.restoredWhileDropped && entry?.status === 'dropped') continue;
      if (row.restoredWhileDropped) await collection.updateOne({ _id: row._id }, { $unset: { restoredWhileDropped: '' } });
      const feedbackId = `${user._id}:${type}:${row.sourceMediaId}:${row.recommendedMediaId}`;
      const existing = await repo.sinceYouLikedFeedback.findOne({ _id: feedbackId });
      let settled = Boolean(existing);
      if (!settled && entry?.status === 'dropped') {
        const _id = `${user._id}:${type}:${row.recommendedMediaId}`;
        await repo.sinceYouLikedHidden.updateOne({ _id }, { $setOnInsert: { userId: user._id, mediaType: type, mediaId: row.recommendedMediaId, createdAt: new Date(now()) } }, { upsert: true });
        settled = true;
      } else if (!settled && entry?.status === 'completed') {
        const statusChanged = new Date(entry.statusChangedAt || 0).getTime();
        if (!row.completedObservedAt || statusChanged > new Date(row.completedObservedAt).getTime()) {
          const completedAt = new Date(Math.max(new Date(row.createdAt).getTime(), Math.min(now(), statusChanged || now())));
          await collection.updateOne({ _id: row._id }, { $set: { completedObservedAt: completedAt } });
          row.completedObservedAt = completedAt;
        }
        if (now() - new Date(row.completedObservedAt).getTime() >= 86400000) {
          // Insert only: never overwrite an existing explicit reaction.
          await repo.sinceYouLikedFeedback.updateOne({ _id: feedbackId }, { $setOnInsert: { userId: user._id, mediaType: type, sourceMediaId: row.sourceMediaId, recommendedMediaId: row.recommendedMediaId, feedback: 'like', createdAt: new Date(now()), updatedAt: new Date(now()) } }, { upsert: true });
          settled = true;
        }
      } else if (!settled && row.completedObservedAt) {
        await collection.updateOne({ _id: row._id }, { $unset: { completedObservedAt: '' } });
      }
      if (settled) { await collection.updateOne({ _id: row._id }, { $set: { settledAt: new Date(now()) } }); row.settledAt = new Date(now()); }
    }
    return { retainedMediaIds: [...new Set(rows.filter(row => !row.settledAt).map(row => row.recommendedMediaId))], resolvedMediaIds: [...new Set(rows.filter(row => row.settledAt).map(row => row.recommendedMediaId))] };
  }
  return {
    async preferences(token, payload = {}) {
      const user = await accounts.getAuthenticatedUser(token);
      if (!user) return { ok: false, message: 'Sign in first.' };
      const page = payload?.page ?? 0;
      if (!['hidden', 'dislikes'].includes(payload?.kind) || !Number.isSafeInteger(page) || page < 0 || page > 10000) return invalid;
      const [hidden, dislikes] = await Promise.all([
        repo.sinceYouLikedHidden.countDocuments({ userId: user._id }),
        repo.sinceYouLikedFeedback.countDocuments({ userId: user._id, feedback: 'dislike' }),
      ]);
      const collection = payload.kind === 'hidden' ? repo.sinceYouLikedHidden : repo.sinceYouLikedFeedback;
      const rows = await collection.find({ userId: user._id, ...(payload.kind === 'dislikes' ? { feedback: 'dislike' } : {}) }).sort({ _id: 1 }).skip(page * 20).limit(20).toArray();
      return { ok: true, totals: { hidden, dislikes }, hasMore: (page + 1) * 20 < (payload.kind === 'hidden' ? hidden : dislikes),
        items: rows.map(row => ({ mediaType: row.mediaType, mediaId: row.mediaId ?? row.recommendedMediaId, ...(payload.kind === 'dislikes' ? { sourceMediaId: row.sourceMediaId } : {}) })) };
    },
    async community(token, payload = {}) {
      if (!(await accounts.getAuthenticatedUser(token))) return { ok: false, message: 'Sign in first.' };
      if (!validType(payload?.mediaType) || !validId(payload?.sourceMediaId)) return invalid;
      const rows = await repo.sinceYouLikedFeedback.aggregate([
        { $match: { mediaType: payload.mediaType, sourceMediaId: payload.sourceMediaId } },
        { $group: { _id: { recommendedMediaId: '$recommendedMediaId' },
          recommendations: { $sum: { $cond: [{ $eq: ['$feedback', 'like'] }, 1, 0] } },
          dislikes: { $sum: { $cond: [{ $eq: ['$feedback', 'dislike'] }, 1, 0] } } } },
        { $match: { recommendations: { $gt: 0 } } },
        { $sort: { recommendations: -1, '_id.recommendedMediaId': 1 } },
        { $limit: 24 },
      ]).toArray();
      return { ok: true, items: rows.filter(row => row.recommendations > 0 && row._id.recommendedMediaId !== payload.sourceMediaId)
        .map(row => ({ mediaId: row._id.recommendedMediaId, recommendations: row.recommendations, dislikes: row.dislikes }))
        .sort((a, b) => b.recommendations - a.recommendations || a.mediaId - b.mediaId).slice(0, 24) };
    },
    async state(token, payload = {}) {
      const user = await accounts.getAuthenticatedUser(token);
      if (!user) return { ok: false, message: 'Sign in first.' };
      if (!validType(payload?.mediaType) || !Array.isArray(payload.pairs) || payload.pairs.length > 80 || !payload.pairs.every(validPair)) return invalid;
      const pairs = payload.pairs.map(({ sourceMediaId, recommendedMediaId }) => ({ sourceMediaId, recommendedMediaId }));
      const lifecycleState = await lifecycle(user, payload.mediaType, pairs, payload.track === true);
      const match = { mediaType: payload.mediaType, $or: pairs };
      const [totals, personal, hidden] = await Promise.all([
        pairs.length ? repo.sinceYouLikedFeedback.aggregate([
          { $match: match },
          { $group: { _id: { sourceMediaId: '$sourceMediaId', recommendedMediaId: '$recommendedMediaId' },
            likes: { $sum: { $cond: [{ $eq: ['$feedback', 'like'] }, 1, 0] } },
            dislikes: { $sum: { $cond: [{ $eq: ['$feedback', 'dislike'] }, 1, 0] } } } },
        ]).toArray() : [],
        pairs.length ? repo.sinceYouLikedFeedback.find({ ...match, userId: user._id }).toArray() : [],
        repo.sinceYouLikedHidden.find({ userId: user._id, mediaType: payload.mediaType }).toArray(),
      ]);
      const votes = new Map(personal.map(row => [pairKey(row), row.feedback]));
      const adjustments = new Map(totals.map(row => [pairKey(row._id),
        Math.max(-maxAdjustment, Math.min(maxAdjustment, row.likes * likeWeight + row.dislikes * dislikeWeight))]));
      return { ok: true, ...lifecycleState, hiddenMediaIds: hidden.map(row => row.mediaId), pairs: pairs.map(pair => ({ ...pair,
        feedbackAdjustment: adjustments.get(pairKey(pair)) ?? 0, sinceYouLikedFeedback: votes.get(pairKey(pair)) ?? null })) };
    },
    async feedback(token, payload = {}) {
      const user = await accounts.getAuthenticatedUser(token);
      if (!user) return { ok: false, message: 'Sign in first.' };
      if (!validType(payload?.mediaType) || !validPair(payload) || !['like', 'dislike', null].includes(payload.feedback)) return invalid;
      const { mediaType, sourceMediaId, recommendedMediaId, feedback } = payload;
      const _id = `${user._id}:${mediaType}:${sourceMediaId}:${recommendedMediaId}`;
      if (feedback === null) await repo.sinceYouLikedFeedback.deleteOne({ _id });
      else {
        const update = { $set: { feedback, updatedAt: new Date() },
          $setOnInsert: { userId: user._id, mediaType, sourceMediaId, recommendedMediaId, createdAt: new Date() } };
        try { await repo.sinceYouLikedFeedback.updateOne({ _id }, update, { upsert: true }); }
        catch (error) { if (error.code !== 11000) throw error; await repo.sinceYouLikedFeedback.updateOne({ _id }, update); }
      }
      if (repo.sinceYouLikedLifecycle) await repo.sinceYouLikedLifecycle.updateOne({ _id }, feedback === null ? {
        $set: { createdAt: new Date(now()) }, $unset: { settledAt: '', completedObservedAt: '' },
        $setOnInsert: { userId: user._id, mediaType, sourceMediaId, recommendedMediaId },
      } : {
        $set: { settledAt: new Date(now()) },
        $setOnInsert: { userId: user._id, mediaType, sourceMediaId, recommendedMediaId, createdAt: new Date(now()) },
      }, { upsert: true });
      return { ok: true };
    },
    async hide(token, payload = {}) {
      const user = await accounts.getAuthenticatedUser(token);
      if (!user) return { ok: false, message: 'Sign in first.' };
      if (!validType(payload?.mediaType) || !validId(payload.mediaId) || typeof payload.hidden !== 'boolean') return invalid;
      const { mediaType, mediaId, hidden } = payload;
      const _id = `${user._id}:${mediaType}:${mediaId}`;
      if (!hidden) {
        await repo.sinceYouLikedHidden.deleteOne({ _id });
        if (repo.sinceYouLikedLifecycle) await repo.sinceYouLikedLifecycle.updateMany({ userId: user._id, mediaType, recommendedMediaId: mediaId }, {
          $unset: { settledAt: '', completedObservedAt: '' }, $set: { createdAt: new Date(now()), restoredWhileDropped: true },
        });
      }
      else {
        try { await repo.sinceYouLikedHidden.updateOne({ _id }, { $setOnInsert: { userId: user._id, mediaType, mediaId, createdAt: new Date() } }, { upsert: true }); }
        catch (error) { if (error.code !== 11000) throw error; }
      }
      return { ok: true };
    },
  };
}

module.exports = { setupSinceYouLiked, createSinceYouLikedService, COLLECTIONS };
