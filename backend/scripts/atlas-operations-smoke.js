require('../env');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectStaging, reportError } = require('../atlas/connection');
const { setupRestore, createBackup, restoreBackup, BACKUP_COLLECTIONS } = require('../atlas/backup');
const { validateDeployment, healthReport } = require('../atlas/operations');
async function main() {
  const connection = await connectStaging(); const source = `batch1_test_${crypto.randomBytes(10).toString('hex')}_`;
  const target = `batch1_test_${crypto.randomBytes(10).toString('hex')}_`; const backupKey = Buffer.alloc(32, 11).toString('base64');
  const oldTotal = process.env.ATLAS_TOTAL_STORAGE_BYTE_BUDGET; const oldQuery = process.env.ATLAS_QUERY_CACHE_BYTE_BUDGET;
  try {
    await setupRestore(connection.db, source); const now = new Date();
    await connection.db.collection(source + 'users').insertOne({ _id: 'user', username: 'BackupUser', username_normalized: 'backupuser',
      password_hash: 'PRIVATE_PASSWORD_HASH', authVersion: 0, schemaVersion: 1, local_credentials_confirmed: true, tutorial_dismissed: false,
      created_at: now, updated_at: now, last_login_at: now });
    await connection.db.collection(source + 'media').insertOne({ _id: 'media', type: 'ANIME', anilistId: 1, metadata: { title_romaji: 'Public title' }, sources: {}, revision: 0 });
    await connection.db.collection(source + 'accountSettings').insertOne({ _id: 'user', autoSyncEnabled: false, needsDeviceReconciliation: false });
    await connection.db.collection(source + 'metadataQueries').insertOne({ _id: 'query', kind: 'search', createdAt: now, lastAccessAt: now, accessRevision: 0,
      payload: { value: 'cached' }, retryAt: new Date(0) });
    const backup = await createBackup(connection.db, backupKey, source); assert.equal(backup.manifest.users.count, 1); assert.equal(backup.manifest.media.count, 1);
    const envelope = backup.blob.toString('utf8'); assert(!envelope.includes('PRIVATE_PASSWORD_HASH')); assert(!envelope.includes('Public title'));
    await assert.rejects(restoreBackup(connection.db, Buffer.alloc(32, 12).toString('base64'), backup.blob, target));
    const restored = await restoreBackup(connection.db, backupKey, backup.blob, target); assert.equal(restored.totalDocuments, 4);
    assert.equal((await connection.db.collection(target + 'users').findOne({ _id: 'user' })).password_hash, 'PRIVATE_PASSWORD_HASH');
    await assert.rejects(restoreBackup(connection.db, backupKey, backup.blob, ''), /disposable test prefix/);
    await assert.rejects(restoreBackup(connection.db, backupKey, backup.blob, target), /not empty/);

    process.env.ATLAS_TOTAL_STORAGE_BYTE_BUDGET = String(10 ** 12); process.env.ATLAS_QUERY_CACHE_BYTE_BUDGET = String(10 ** 9);
    const health = await healthReport(connection.db, Date.now(), target); assert.equal(health.ok, true); assert.equal(health.queryCache.documents, 1);
    assert(!JSON.stringify(health).includes('BackupUser')); assert(!JSON.stringify(health).includes('Public title'));
    const baseEnv = { MONGODB_URI: 'mongodb+srv://example.invalid', MONGODB_DATABASE: 'seenary_staging', MONGODB_USERNAME: 'user', MONGODB_PASSWORD: 'password',
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'), ATLAS_BACKUP_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString('base64'),
      ANALYTICS_HMAC_SECRET: 'a'.repeat(32), ATLAS_QUERY_CACHE_BYTE_BUDGET: '1000', ATLAS_TOTAL_STORAGE_BYTE_BUDGET: '10000',
      ANILIST_CLIENT_ID: 'id', ANILIST_CLIENT_SECRET: 'secret', MAL_CLIENT_ID: 'id', MAL_CLIENT_SECRET: 'secret' };
    assert.equal(validateDeployment(baseEnv, 'staging').ok, true);
    assert.equal(validateDeployment({ ...baseEnv, TOKEN_ENCRYPTION_KEY: baseEnv.ATLAS_BACKUP_ENCRYPTION_KEY }, 'staging').ok, false);
    assert.equal(validateDeployment({ ...baseEnv, MONGODB_DATABASE: 'seenary', API_PUBLIC_ORIGIN: 'https://api.seenary.app',
      ANILIST_REDIRECT_URI: 'https://api.seenary.app/auth/anilist/callback', MAL_REDIRECT_URI: 'https://api.seenary.app/auth/mal/callback', WEB_ORIGINS: 'https://seenary.app' }, 'production').ok, true);
    assert.equal(validateDeployment({ ...baseEnv, MONGODB_DATABASE: 'seenary', API_PUBLIC_ORIGIN: 'http://api.seenary.app' }, 'production').ok, false);
    console.log('PASS: encrypted complete backup, wrong-key rejection, prefix-only isolated restore, checksum/count verification, safe health metrics, storage thresholds, and staging/production deployment preflight.');
  } finally {
    if (oldTotal === undefined) delete process.env.ATLAS_TOTAL_STORAGE_BYTE_BUDGET; else process.env.ATLAS_TOTAL_STORAGE_BYTE_BUDGET = oldTotal;
    if (oldQuery === undefined) delete process.env.ATLAS_QUERY_CACHE_BYTE_BUDGET; else process.env.ATLAS_QUERY_CACHE_BYTE_BUDGET = oldQuery;
    try { for (const prefix of [source, target]) for (const name of BACKUP_COLLECTIONS) await connection.db.collection(prefix + name).drop().catch(error => { if (error.code !== 26) throw error; }); }
    finally { await connection.close(); }
  }
}
if (require.main === module) main().catch(error => { reportError(error); process.exitCode = 1; });
module.exports = { main };
