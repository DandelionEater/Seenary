const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { EJSON } = require('bson');
const { setupAccounts } = require('./accounts');
const { setupProviders } = require('./providerSchema');
const { setupMedia } = require('./media');
const { setupLibrary, LIBRARY_COLLECTIONS } = require('./librarySchema');
const { setupMetadata } = require('./metadata');
const { setupAnalytics } = require('./analytics');

const BACKUP_COLLECTIONS = ['users', 'sessions', 'providerAccounts', 'oauthFlows', 'accountSettings', 'providerMigrationReceipts',
  'media', 'mediaRedirects', 'mediaMigrationReceipts', ...LIBRARY_COLLECTIONS, 'metadataQueries', 'analyticsDaily', 'analyticsMonthly'];
const uniqueCollections = [...new Set(BACKUP_COLLECTIONS)];
function key(value) { const text = String(value || '').trim(); const result = /^[a-f0-9]{64}$/i.test(text) ? Buffer.from(text, 'hex') : Buffer.from(text, 'base64');
  if (result.length !== 32) throw new Error('A separate 32-byte backup encryption key is required.'); return result; }
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function encrypt(payload, encodedKey) { const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key(encodedKey), iv);
  const encrypted = Buffer.concat([cipher.update(zlib.gzipSync(payload, { level: 9 })), cipher.final()]);
  return Buffer.from(JSON.stringify({ format: 'seenary.atlas-backup-encrypted', version: 1, algorithm: 'aes-256-gcm+gzip',
    iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), data: encrypted.toString('base64url') })); }
function decrypt(blob, encodedKey) { const envelope = JSON.parse(Buffer.from(blob).toString('utf8'));
  if (envelope.format !== 'seenary.atlas-backup-encrypted' || envelope.version !== 1 || envelope.algorithm !== 'aes-256-gcm+gzip') throw new Error('Unsupported backup.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(encodedKey), Buffer.from(envelope.iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
  return zlib.gunzipSync(Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64url')), decipher.final()])); }
async function createBackup(db, encodedKey, prefix = '') {
  const collections = {}; const manifest = {};
  for (const name of uniqueCollections) { const rows = await db.collection(prefix + name).find({}).sort({ _id: 1 }).toArray();
    const serialized = Buffer.from(EJSON.stringify(rows, { relaxed: false })); collections[name] = serialized.toString('base64');
    manifest[name] = { count: rows.length, sha256: digest(serialized) }; }
  const payload = Buffer.from(JSON.stringify({ format: 'seenary.atlas-logical-backup', version: 1, createdAt: new Date().toISOString(), manifest, collections }));
  return { blob: encrypt(payload, encodedKey), manifest };
}
async function setupRestore(db, prefix) {
  if (!/^batch1_test_[a-f0-9]+_$/.test(prefix || '')) throw new Error('Restore requires a disposable test prefix.');
  await setupAccounts(db, prefix); await setupProviders(db, prefix); await setupMedia(db, prefix); await setupLibrary(db, prefix);
  await setupMetadata(db, prefix); await setupAnalytics(db, prefix);
}
async function restoreBackup(db, encodedKey, blob, prefix) {
  if (!/^batch1_test_[a-f0-9]+_$/.test(prefix || '')) throw new Error('Restore requires a disposable test prefix.');
  const parsed = JSON.parse(decrypt(blob, encodedKey).toString('utf8'));
  if (parsed.format !== 'seenary.atlas-logical-backup' || parsed.version !== 1) throw new Error('Unsupported logical backup.');
  await setupRestore(db, prefix);
  for (const name of uniqueCollections) if (await db.collection(prefix + name).countDocuments({}) !== 0) throw new Error('Restore target is not empty.');
  const restored = {};
  for (const name of uniqueCollections) {
    const serialized = Buffer.from(parsed.collections[name] || '', 'base64'); const expected = parsed.manifest[name];
    if (!expected || digest(serialized) !== expected.sha256) throw new Error('Backup checksum failed.');
    const rows = EJSON.parse(serialized.toString('utf8'), { relaxed: false }); if (!Array.isArray(rows) || rows.length !== expected.count) throw new Error('Backup count failed.');
    if (rows.length) await db.collection(prefix + name).insertMany(rows, { ordered: true });
    const verified = await db.collection(prefix + name).find({}).sort({ _id: 1 }).toArray(); const verifyBytes = Buffer.from(EJSON.stringify(verified, { relaxed: false }));
    if (verified.length !== expected.count || digest(verifyBytes) !== expected.sha256) throw new Error('Restored collection verification failed.');
    restored[name] = verified.length;
  }
  return { format: parsed.format, version: parsed.version, collections: restored,
    totalDocuments: Object.values(restored).reduce((sum, count) => sum + count, 0) };
}
module.exports = { createBackup, restoreBackup, setupRestore, BACKUP_COLLECTIONS, encrypt, decrypt };
