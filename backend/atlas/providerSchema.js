async function setupProviders(db, prefix = '') {
  if (prefix && !/^batch1_test_[a-f0-9]+_$/.test(prefix)) throw new Error('Invalid test prefix.');
  const definitions = {
    providerAccounts: {
      required: ['_id', 'userId', 'provider', 'providerUserId', 'username', 'accessToken', 'revision', 'createdAt', 'updatedAt'],
      properties: { _id: { bsonType: 'string' }, userId: { bsonType: 'string' }, provider: { enum: ['anilist', 'mal'] },
        providerUserId: { bsonType: 'string' }, username: { bsonType: 'string', minLength: 1, maxLength: 100 },
        accessToken: { bsonType: 'string', pattern: '^seenary:v1:' },
        refreshToken: { bsonType: ['string', 'null'], pattern: '^seenary:v1:' },
        expiresAt: { bsonType: ['date', 'null'] }, revision: { bsonType: 'number', minimum: 0 },
        createdAt: { bsonType: 'date' }, updatedAt: { bsonType: 'date' },
      },
    },
    oauthFlows: { required: ['_id', 'provider', 'bindingHash', 'expiresAt'], properties: {
      _id: { bsonType: 'string' }, provider: { enum: ['anilist', 'mal'] }, bindingHash: { bsonType: 'string' },
      expiresAt: { bsonType: 'date' }, verifier: { bsonType: ['string', 'null'], pattern: '^seenary:v1:' },
    } },
    accountSettings: { required: ['_id', 'autoSyncEnabled', 'needsDeviceReconciliation'], properties: {
      _id: { bsonType: 'string' }, autoSyncEnabled: { bsonType: 'bool' }, needsDeviceReconciliation: { bsonType: 'bool' },
    } },
    providerMigrationReceipts: { required: ['_id', 'fingerprint', 'userId'], properties: {
      _id: { bsonType: 'string' }, fingerprint: { bsonType: 'string' }, userId: { bsonType: 'string' },
    } },
  };
  const repo = {};
  for (const [name, schema] of Object.entries(definitions)) {
    repo[name] = db.collection(prefix + name);
    const validator = { $jsonSchema: { bsonType: 'object', ...schema } };
    try { await db.createCollection(prefix + name, { validator, validationLevel: 'strict', validationAction: 'error' }); }
    catch (error) {
      if (error.code !== 48) throw error;
      const existing = await db.listCollections({ name: prefix + name }).next();
      if (JSON.stringify(existing?.options?.validator) !== JSON.stringify(validator)
          || existing.options.validationLevel !== 'strict' || existing.options.validationAction !== 'error') {
        throw new Error('Provider schema differs; explicit migration required.');
      }
    }
  }
  // Preserve the current single-active-provider policy and global ownership.
  await repo.providerAccounts.createIndex({ userId: 1 }, { unique: true });
  await repo.providerAccounts.createIndex({ provider: 1, providerUserId: 1 }, { unique: true });
  await repo.oauthFlows.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await repo.oauthFlows.createIndex({ userId: 1 });
  return { ...repo, users: db.collection(prefix + 'users'), sessions: db.collection(prefix + 'sessions'), jobs: db.collection(prefix + 'jobs'), jobLocks: db.collection(prefix + 'jobLocks'),
    providerRefreshStates: db.collection(prefix + 'providerRefreshStates'),
    analyticsDaily: db.collection(prefix + 'analyticsDaily'), analyticsMonthly: db.collection(prefix + 'analyticsMonthly'),
    ...Object.fromEntries(['libraryEntries', 'libraryChanges', 'libraryState', 'librarySnapshots', 'mutationReceipts', 'libraryMigrationReceipts', 'media'].map((name) => [name, db.collection(prefix + name)])) };
}

function providerCollections(db, prefix = '') {
  return Object.fromEntries(['providerAccounts', 'oauthFlows', 'accountSettings', 'providerMigrationReceipts', 'users', 'sessions', 'jobs', 'jobLocks']
    .map((name) => [name, db.collection(prefix + name)]));
}

module.exports = { setupProviders, providerCollections };
