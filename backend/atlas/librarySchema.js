const LIBRARY_COLLECTIONS = ['libraryEntries', 'libraryChanges', 'libraryState', 'librarySnapshots', 'mutationReceipts', 'libraryMigrationReceipts', 'jobs', 'jobLocks', 'providerBudgets', 'providerRefreshStates'];
function libraryCollections(db, prefix = '') {
  if (prefix && !/^batch1_test_[a-f0-9]+_$/.test(prefix)) throw new Error('Invalid test prefix.');
  return Object.fromEntries([...LIBRARY_COLLECTIONS, 'users', 'sessions', 'providerAccounts', 'accountSettings', 'media', 'mediaRedirects', 'mediaMigrationReceipts']
    .map((name) => [name, db.collection(prefix + name)]));
}
async function setupLibrary(db, prefix = '') {
  const repo = libraryCollections(db, prefix);
  const schemas = {
    libraryEntries: { required: ['_id', 'userId', 'mediaId', 'type', 'revision', 'sequence', 'deleted', 'isFavorite', 'status', 'progress'], properties: {
      _id: { bsonType: 'string' }, userId: { bsonType: 'string' }, mediaId: { bsonType: 'string' }, type: { enum: ['ANIME', 'MANGA'] },
      revision: { bsonType: 'number', minimum: 1 }, sequence: { bsonType: 'number', minimum: 1 },
      deleted: { bsonType: 'bool' }, isFavorite: { bsonType: 'bool' }, status: { enum: ['planned', 'watching', 'completed', 'paused', 'dropped'] },
      progress: { bsonType: 'number', minimum: 0 }, volumeProgress: { bsonType: 'number', minimum: 0 },
      repeatCount: { bsonType: 'number', minimum: 0 }, isRepeating: { bsonType: 'bool' },
      score: { bsonType: ['number', 'null'] }, notes: { bsonType: ['string', 'null'], maxLength: 10000 },
    } },
    libraryChanges: { required: ['_id', 'userId', 'mediaId', 'epoch', 'sequence', 'entry'], properties: {
      userId: { bsonType: 'string' }, mediaId: { bsonType: 'string' }, epoch: { bsonType: 'string' },
      sequence: { bsonType: 'number', minimum: 1 }, entry: { bsonType: 'object' },
    } },
    libraryState: { required: ['_id', 'epoch', 'sequence', 'retainedFrom'], properties: {
      _id: { bsonType: 'string' }, epoch: { bsonType: 'string' }, sequence: { bsonType: 'number', minimum: 0 }, retainedFrom: { bsonType: 'number', minimum: 0 },
    } },
    librarySnapshots: { required: ['_id', 'userId', 'epoch', 'watermark', 'expiresAt'], properties: {
      _id: { bsonType: 'string' }, userId: { bsonType: 'string' }, epoch: { bsonType: 'string' }, watermark: { bsonType: 'number' }, expiresAt: { bsonType: 'date' },
    } },
    mutationReceipts: { required: ['_id', 'userId', 'fingerprint', 'result'], properties: {
      _id: { bsonType: 'string' }, userId: { bsonType: 'string' }, fingerprint: { bsonType: 'string' }, result: { bsonType: 'object' },
    } },
    libraryMigrationReceipts: { required: ['_id', 'userId', 'mediaId', 'fingerprint', 'snapshot'], properties: {
      _id: { bsonType: 'string' }, userId: { bsonType: 'string' }, mediaId: { bsonType: 'string' }, fingerprint: { bsonType: 'string' }, snapshot: { bsonType: 'object' },
    } },
    jobs: { required: ['_id', 'kind', 'userId', 'mediaId', 'provider', 'providerLinkId', 'libraryRevision', 'status', 'createdAt'], properties: {
      _id: { bsonType: 'string' }, kind: { enum: ['provider-library'] }, userId: { bsonType: 'string' }, mediaId: { bsonType: 'string' },
      provider: { enum: ['anilist', 'mal'] }, providerLinkId: { bsonType: 'string' }, libraryRevision: { bsonType: 'number' },
      status: { enum: ['pending', 'blocked_mapping', 'running', 'retry', 'succeeded', 'failed', 'cancelled'] }, createdAt: { bsonType: 'date' },
    } },
    jobLocks: { required: ['_id', 'userId', 'provider', 'mediaId', 'owner', 'leaseUntil', 'updatedAt'], properties: {
      _id: { bsonType: 'string' }, userId: { bsonType: 'string' }, provider: { enum: ['anilist', 'mal'] }, mediaId: { bsonType: 'string' },
      owner: { bsonType: 'string' }, leaseUntil: { bsonType: 'date' }, updatedAt: { bsonType: 'date' },
    } },
    providerBudgets: { required: ['_id', 'revision', 'nextAllowedAt', 'updatedAt'], properties: {
      _id: { enum: ['anilist', 'mal'] }, revision: { bsonType: 'number', minimum: 0 },
      nextAllowedAt: { bsonType: 'date' }, updatedAt: { bsonType: 'date' },
    } },
    providerRefreshStates: { required: ['_id', 'userId', 'provider', 'linkRevision', 'revision', 'nextAttemptAt'], properties: {
      _id: { bsonType: 'string' }, userId: { bsonType: 'string' }, provider: { enum: ['anilist', 'mal'] },
      linkRevision: { bsonType: 'number', minimum: 0 }, revision: { bsonType: 'number', minimum: 0 }, nextAttemptAt: { bsonType: 'date' },
    } },
  };
  for (const [name, schema] of Object.entries(schemas)) {
    const validator = { $jsonSchema: { bsonType: 'object', ...schema } };
    try { await db.createCollection(repo[name].collectionName, { validator, validationLevel: 'strict', validationAction: 'error' }); }
    catch (error) {
      if (error.code !== 48) throw error;
      const existing = await db.listCollections({ name: repo[name].collectionName }).next();
      if (JSON.stringify(existing?.options?.validator) !== JSON.stringify(validator)
          || existing.options.validationLevel !== 'strict' || existing.options.validationAction !== 'error') throw new Error('Library schema requires explicit migration.');
    }
  }
  await repo.libraryEntries.createIndex({ userId: 1, mediaId: 1 }, { unique: true });
  await repo.libraryEntries.createIndex({ userId: 1, type: 1, deleted: 1, isFavorite: 1, mediaId: 1 });
  await repo.libraryChanges.createIndex({ userId: 1, epoch: 1, sequence: 1 }, { unique: true });
  await repo.librarySnapshots.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  for (const name of ['librarySnapshots', 'mutationReceipts', 'libraryMigrationReceipts', 'jobs']) await repo[name].createIndex({ userId: 1 });
  await repo.jobs.createIndex({ userId: 1, provider: 1, mediaId: 1, libraryRevision: 1 }, { unique: true });
  await repo.jobs.createIndex({ status: 1, nextAttemptAt: 1, createdAt: 1 });
  await repo.jobs.createIndex({ userId: 1, provider: 1, mediaId: 1, status: 1, libraryRevision: -1 });
  await repo.jobLocks.createIndex({ leaseUntil: 1 });
  await repo.jobLocks.createIndex({ userId: 1, provider: 1 });
  await repo.providerRefreshStates.createIndex({ nextAttemptAt: 1, leaseUntil: 1 });
  await repo.providerRefreshStates.createIndex({ userId: 1, provider: 1 });
  return repo;
}
module.exports = { setupLibrary, libraryCollections, LIBRARY_COLLECTIONS };
