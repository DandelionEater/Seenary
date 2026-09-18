const crypto = require('node:crypto');

function mediaCollections(db, prefix = '') {
  if (prefix && !/^batch1_test_[a-f0-9]+_$/.test(prefix)) throw new Error('Invalid test prefix.');
  return Object.fromEntries(['media', 'mediaRedirects', 'mediaMigrationReceipts', 'libraryEntries'].map((name) => [name, db.collection(prefix + name)]));
}
async function setupMedia(db, prefix = '') {
  const repo = mediaCollections(db, prefix);
  const schemas = {
    media: { required: ['_id', 'type', 'metadata', 'sources', 'revision'], properties: {
      _id: { bsonType: 'string' }, type: { enum: ['ANIME', 'MANGA'] }, metadata: { bsonType: 'object' }, sources: { bsonType: 'object' },
      anilistId: { bsonType: 'number', minimum: 1 }, malId: { bsonType: 'number', minimum: 1 }, revision: { bsonType: 'number', minimum: 0 },
    } },
    mediaRedirects: { required: ['_id', 'targetId', 'type'], properties: {
      _id: { bsonType: 'string' }, targetId: { bsonType: 'string' }, type: { enum: ['ANIME', 'MANGA'] },
    } },
    mediaMigrationReceipts: { required: ['_id', 'mediaId', 'fingerprint', 'snapshot'], properties: {
      _id: { bsonType: 'string' }, mediaId: { bsonType: 'string' }, fingerprint: { bsonType: 'string' }, snapshot: { bsonType: 'object' },
    } },
  };
  for (const [name, schema] of Object.entries(schemas)) {
    const validator = { $jsonSchema: { bsonType: 'object', ...schema } };
    try { await db.createCollection(repo[name].collectionName, { validator, validationLevel: 'strict', validationAction: 'error' }); }
    catch (error) {
      if (error.code !== 48) throw error;
      const existing = await db.listCollections({ name: repo[name].collectionName }).next();
      if (JSON.stringify(existing?.options?.validator) !== JSON.stringify(validator)
          || existing.options.validationLevel !== 'strict' || existing.options.validationAction !== 'error') throw new Error('Media schema requires explicit migration.');
    }
  }
  for (const key of ['anilistId', 'malId']) {
    await repo.media.createIndex({ type: 1, [key]: 1 }, { unique: true, partialFilterExpression: { [key]: { $type: 'number' } } });
  }
  await repo.mediaRedirects.createIndex({ targetId: 1 });
  await repo.mediaMigrationReceipts.createIndex({ mediaId: 1 });
  return repo;
}
function validId(id) { return Number.isSafeInteger(id) && id > 0; }
function fillMissing(preferred, fallback) {
  const result = structuredClone(preferred);
  for (const [key, value] of Object.entries(fallback)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Invalid metadata key.');
    if (!Object.hasOwn(result, key) || result[key] == null) result[key] = structuredClone(value);
    else if (value && result[key] && typeof value === 'object' && typeof result[key] === 'object'
        && !Array.isArray(value) && !Array.isArray(result[key]) && !(value instanceof Date) && !(result[key] instanceof Date)) result[key] = fillMissing(result[key], value);
  }
  return result;
}
function createMediaService(client, repo) {
  async function resolve(id, session) {
    const seen = new Set();
    for (let n = 0; n < 64; n++) {
      if (seen.has(id)) throw new Error('Cyclic media redirect.');
      seen.add(id);
      const media = await repo.media.findOne({ _id: id }, { session });
      if (media) return media;
      const redirect = await repo.mediaRedirects.findOne({ _id: id }, { session });
      if (!redirect) return null;
      id = redirect.targetId;
    }
    throw new Error('Media redirect chain too long.');
  }
  return {
    resolve,
    async byProvider(type, provider, id) {
      if (!['ANIME', 'MANGA'].includes(type) || !['anilist', 'mal'].includes(provider) || !validId(id)) throw new Error('Invalid media identity.');
      return repo.media.findOne({ type, [provider === 'anilist' ? 'anilistId' : 'malId']: id });
    },
    async ensure(type, provider, id) {
      if (!['ANIME', 'MANGA'].includes(type) || !['anilist', 'mal'].includes(provider) || !validId(id)) throw new Error('Invalid media identity.');
      const identity = { type, [provider === 'anilist' ? 'anilistId' : 'malId']: id };
      const now = new Date();
      try {
        return await repo.media.findOneAndUpdate(identity, { $setOnInsert: { _id: crypto.randomUUID(), ...identity,
          metadata: {}, sources: {}, revision: 0, createdAt: now, updatedAt: now } }, { upsert: true, returnDocument: 'after' });
      } catch (error) {
        if (error.code !== 11000) throw error;
        const existing = await repo.media.findOne(identity);
        if (!existing) throw error;
        return existing;
      }
    },
    // Internal backend API only. Evidence must come from a trusted provider response,
    // never a browser-provided mapping or title similarity.
    async attachVerifiedMapping(seenaryId, evidence) {
      if (evidence?.kind !== 'anilist-idMal' || !['ANIME', 'MANGA'].includes(evidence.type)
          || !validId(evidence.anilistId) || !validId(evidence.malId)) throw new Error('Verified AniList mapping required.');
      const session = client.startSession();
      try {
        return await session.withTransaction(async () => {
          const winner = await resolve(seenaryId, session);
          if (!winner || winner.type !== evidence.type) throw new Error('Media type mismatch.');
          const others = await repo.media.find({ type: evidence.type, $or: [{ anilistId: evidence.anilistId }, { malId: evidence.malId }] }, { session }).toArray();
          const records = [winner, ...others.filter((row) => row._id !== winner._id)];
          if (records.length > 1) {
            if (await repo.libraryEntries.findOne({ mediaId: { $in: records.slice(1).map((row) => row._id) } }, { session })) {
              throw Object.assign(new Error('Library-bearing duplicates require personal-entry reconciliation.'), { code: 'MAPPING_REVIEW_REQUIRED' });
            }
          }
          for (const row of records) {
            if (row.anilistId != null && row.anilistId !== evidence.anilistId || row.malId != null && row.malId !== evidence.malId) throw Object.assign(new Error('Conflicting media mapping.'), { code: 'MAPPING_CONFLICT' });
          }
          let metadata = winner.metadata;
          let sources = winner.sources;
          for (const loser of records.slice(1)) {
            metadata = loser.anilistId && !winner.anilistId ? fillMissing(loser.metadata, metadata) : fillMissing(metadata, loser.metadata);
            sources = fillMissing(sources, loser.sources);
            await repo.media.deleteOne({ _id: loser._id }, { session });
            await repo.mediaRedirects.updateMany({ targetId: loser._id }, { $set: { targetId: winner._id } }, { session });
            await repo.mediaRedirects.insertOne({ _id: loser._id, targetId: winner._id, type: winner.type, snapshot: loser, createdAt: new Date() }, { session });
            await repo.mediaMigrationReceipts.updateMany({ mediaId: loser._id }, { $set: { mediaId: winner._id } }, { session });
          }
          return repo.media.findOneAndUpdate({ _id: winner._id }, { $set: { anilistId: evidence.anilistId, malId: evidence.malId,
            metadata, sources, mappingEvidence: evidence, updatedAt: new Date() }, $inc: { revision: 1 } }, { session, returnDocument: 'after' });
        });
      } finally { await session.endSession(); }
    },
  };
}
module.exports = { setupMedia, mediaCollections, createMediaService, validId, fillMissing };
