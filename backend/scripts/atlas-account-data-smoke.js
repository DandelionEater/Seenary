require('../env');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectStaging, reportError } = require('../atlas/connection');
const { setupAccounts, createAccountService } = require('../atlas/accounts');
const { setupProviders } = require('../atlas/providerSchema');
const { setupLibrary, LIBRARY_COLLECTIONS } = require('../atlas/librarySchema');
const { setupMedia } = require('../atlas/media');
const { createProviderService } = require('../atlas/providers');
const { createTokenCipher } = require('../atlas/tokenCipher');
const { USER_ID_COLLECTIONS, USER_KEY_COLLECTIONS, EXPORT_COLLECTIONS } = require('../atlas/accountData');

async function main() {
  const connection = await connectStaging(); const prefix = `batch1_test_${crypto.randomBytes(10).toString('hex')}_`;
  try {
    const accountsRepo = await setupAccounts(connection.db, prefix); const library = await setupLibrary(connection.db, prefix);
    const providersRepo = await setupProviders(connection.db, prefix); const mediaRepo = await setupMedia(connection.db, prefix);
    const repo = { ...accountsRepo, ...library, ...providersRepo, ...mediaRepo, providerRefreshStates: library.providerRefreshStates };
    const accounts = await createAccountService(repo); const registered = await accounts.register('ExportAlice', 'alice-password');
    const userId = registered.user.id; const now = new Date(); const cipher = createTokenCipher(Buffer.alloc(32, 5).toString('base64'));
    await repo.users.updateOne({ _id: userId }, { $set: { legacyKey: '["fixture",1]', sourceFingerprint: 'source-secret', legacy: { source: 'fixture', userId: 1 } } });
    await repo.providerAccounts.insertOne({ _id: 'link', userId, provider: 'mal', providerUserId: '77', username: 'MALAlice',
      accessToken: cipher.encrypt('PRIVATE_ACCESS'), refreshToken: cipher.encrypt('PRIVATE_REFRESH'), expiresAt: null, revision: 1, createdAt: now, updatedAt: now });
    await repo.oauthFlows.insertOne({ _id: 'flow', provider: 'mal', bindingHash: 'PRIVATE_BINDING', userId, verifier: cipher.encrypt('PRIVATE_VERIFIER'), expiresAt: new Date(now.getTime() + 60000) });
    await repo.accountSettings.insertOne({ _id: userId, autoSyncEnabled: true, needsDeviceReconciliation: false });
    await repo.providerMigrationReceipts.insertOne({ _id: 'provider-receipt', fingerprint: 'PRIVATE_FINGERPRINT', userId });
    await repo.media.insertOne({ _id: 'media', type: 'ANIME', anilistId: 1, metadata: { title_romaji: 'Public title' }, sources: {}, revision: 0 });
    const entry = { _id: JSON.stringify([userId, 'media']), userId, mediaId: 'media', type: 'ANIME', revision: 1, sequence: 1, deleted: false,
      isFavorite: true, status: 'watching', progress: 3, volumeProgress: 0, repeatCount: 0, isRepeating: false, score: 90,
      notes: 'PRIVATE_NOTE', startedAt: null, completedAt: null, createdAt: now, updatedAt: now };
    await repo.libraryEntries.insertOne(entry);
    await repo.libraryChanges.insertOne({ _id: 'change', userId, mediaId: 'media', epoch: 'epoch', sequence: 1, entry, createdAt: now });
    await repo.libraryState.insertOne({ _id: userId, epoch: 'epoch', sequence: 1, retainedFrom: 0 });
    await repo.librarySnapshots.insertOne({ _id: 'snapshot', userId, epoch: 'epoch', watermark: 1, expiresAt: new Date(now.getTime() + 60000) });
    await repo.mutationReceipts.insertOne({ _id: 'mutation', userId, fingerprint: 'mutation-fingerprint', result: { ok: true, entry } });
    await repo.libraryMigrationReceipts.insertOne({ _id: 'migration', userId, mediaId: 'media', fingerprint: 'migration-fingerprint', snapshot: entry });
    await repo.jobs.insertOne({ _id: 'job', kind: 'provider-library', userId, mediaId: 'media', provider: 'mal', providerLinkId: 'link',
      providerLinkRevision: 1, providerMediaId: 2, libraryRevision: 1, operation: 'upsert', status: 'pending', payload: { notes: 'PRIVATE_JOB_NOTE' }, mediaType: 'ANIME', createdAt: now });
    await repo.jobLocks.insertOne({ _id: 'lock', userId, provider: 'mal', mediaId: 'media', owner: 'PRIVATE_OWNER', leaseUntil: new Date(now.getTime() + 60000), updatedAt: now });
    await repo.providerRefreshStates.insertOne({ _id: 'link', userId, provider: 'mal', linkRevision: 1, revision: 0, nextAttemptAt: now, leaseOwner: 'PRIVATE_LEASE' });
    const service = createProviderService({ client: connection.client, repo, accounts, cipher, adapters: {} });
    const exported = await service.exportAccount(registered.token); assert.equal(exported.ok, true);
    assert.deepEqual(Object.keys(exported.export.data).sort(), [...EXPORT_COLLECTIONS].sort());
    const json = JSON.stringify(exported.export);
    assert(json.includes('PRIVATE_NOTE')); assert(json.includes('PRIVATE_JOB_NOTE')); assert(json.includes('Public title') === false);
    for (const secret of ['PRIVATE_ACCESS', 'PRIVATE_REFRESH', 'PRIVATE_BINDING', 'PRIVATE_VERIFIER', 'PRIVATE_OWNER', 'PRIVATE_LEASE', 'source-secret']) assert(!json.includes(secret));
    assert(!json.includes('password_hash')); assert(!json.includes('accessToken')); assert(!json.includes('refreshToken'));
    assert.equal((await service.exportAccount('invalid')).ok, false);

    assert.equal((await service.deleteAccount(registered.token, 'ExportAlice', 'wrong-password')).ok, false);
    assert.equal((await service.deleteAccount(registered.token, 'ExportAlice', 'alice-password')).ok, true);
    for (const name of USER_ID_COLLECTIONS) assert.equal(await repo[name].countDocuments({ userId }), 0, `${name} erased`);
    for (const name of USER_KEY_COLLECTIONS) assert.equal(await repo[name].countDocuments({ _id: userId }), 0, `${name} erased`);
    const tombstone = await repo.users.findOne({ _id: userId });
    assert.equal(tombstone.status, 'deleted'); assert.equal(tombstone.password_hash, ''); assert.equal(tombstone.last_login_at, null);
    assert.equal(tombstone.sourceFingerprint, undefined); assert.equal(tombstone.legacy, undefined); assert.equal(tombstone.legacyKey, undefined);
    assert.match(tombstone.migrationBlockHash, /^[a-f0-9]{64}$/);
    assert.equal(await repo.media.countDocuments({ _id: 'media' }), 1, 'shared canonical media survives account erasure');
    assert.equal((await service.exportAccount(registered.token)).ok, false);
    console.log('PASS: complete portable account export, secret exclusion, authenticated erasure across every user collection, non-resurrection tombstone, and canonical media preservation.');
  } finally {
    const names = new Set([...LIBRARY_COLLECTIONS, 'users', 'sessions', 'providerAccounts', 'oauthFlows', 'accountSettings', 'providerMigrationReceipts', 'media', 'mediaRedirects', 'mediaMigrationReceipts']);
    try { for (const name of names) await connection.db.collection(prefix + name).drop().catch(error => { if (error.code !== 26) throw error; }); }
    finally { await connection.close(); }
  }
}
if (require.main === module) main().catch(error => { reportError(error); process.exitCode = 1; });
module.exports = { main };
